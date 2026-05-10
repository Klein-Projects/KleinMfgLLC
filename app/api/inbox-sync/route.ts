import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// POST /api/inbox-sync — Phase 2
//
// Cowork-facing write endpoint. Hit by the 7am LinkedIn DM scraper
// task with a batch of proposals derived from walking Sean's DM
// inbox. Every proposal lands in review_queue with status='pending'
// — never auto-applied. Sean approves from /portal/review-queue.
//
// Body shape:
// {
//   observed_at: string (ISO datetime),
//   proposals: [
//     {
//       kind: "new_lead" | "new_activity" | "stage_change"
//           | "update_contact" | "set_wake_up",
//       lead_id?:            string | null,    // optional — endpoint resolves
//       linkedin_thread_id?: string | null,
//       linkedin_url?:       string | null,    // for matching when lead_id absent
//       payload:             Record<string, unknown>,
//     },
//     ...
//   ]
// }
//
// Reconciliation (the headline Phase 2 behaviour):
//   1. For every proposal, try to resolve a target lead. Match order:
//      lead_id → linkedin_thread_id (lead-level) → linkedin_url
//      (lead-level) → linkedin_url (contact-level).
//   2. When a proposal of kind 'new_lead' or 'new_activity' resolves
//      to a lead with status='invited', the endpoint synthesizes an
//      additional kind='stage_change' proposal advancing the lead
//      from 'invited' to 'contacted' (when the first DM message is
//      outbound from us, treat as still contacted) or 'engaged' (when
//      the first DM message is inbound from the prospect — they
//      replied, that's engagement).
//   3. When a 'new_lead' proposal resolves to an existing non-invited
//      lead, demote it to a 'new_activity' proposal so we don't
//      double-create. The original payload is preserved on the row.
//
// Dedupe: skip pending proposals that already exist for the same
// (kind, linkedin_thread_id) tuple, or for new_lead by linkedin_url
// when no thread_id is available.
//
// Side effect: bumps leads.last_inbox_sync_at on every resolved lead
// so the next scrape can fetch incrementally.
//
// Auth: Bearer token (COWORK_API_TOKEN env var). Service-role
// Supabase client; bypasses RLS.
//
// Returns 200 with { observed_at, total, inserted, skipped:
// { existing_proposal, no_match_for_thread_only_kind, invalid },
// inserted_ids[], reconciled[] }.

type ProposalKind =
  | "new_lead"
  | "new_activity"
  | "stage_change"
  | "update_contact"
  | "set_wake_up";

const VALID_KINDS: readonly ProposalKind[] = [
  "new_lead",
  "new_activity",
  "stage_change",
  "update_contact",
  "set_wake_up",
];

interface ProposalInput {
  kind: ProposalKind;
  lead_id?: string | null;
  linkedin_thread_id?: string | null;
  linkedin_url?: string | null;
  payload: Record<string, unknown>;
}

interface RowToInsert {
  kind: ProposalKind;
  source: string;
  payload: Record<string, unknown>;
  lead_id: string | null;
  linkedin_thread_id: string | null;
}

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function normalizeLinkedinUrl(raw: string): string {
  let s = raw.trim();
  if (s.endsWith("/")) s = s.slice(0, -1);
  try {
    const u = new URL(s);
    u.hostname = u.hostname.toLowerCase();
    let out = u.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return s;
  }
}

function asStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function validateProposal(
  raw: unknown,
  index: number,
): { ok: true; value: ProposalInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, error: `proposal[${index}] is not an object` };
  }
  const o = raw as Record<string, unknown>;
  const kind = asStr(o.kind);
  if (!kind || !VALID_KINDS.includes(kind as ProposalKind)) {
    return {
      ok: false,
      error: `proposal[${index}].kind must be one of ${VALID_KINDS.join(", ")}`,
    };
  }
  const payload = o.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      error: `proposal[${index}].payload must be an object`,
    };
  }
  const leadIdRaw = o.lead_id;
  const leadId =
    typeof leadIdRaw === "string" && leadIdRaw.trim() ? leadIdRaw.trim() : null;
  const threadIdRaw = o.linkedin_thread_id ?? (payload as Record<string, unknown>).linkedin_thread_id;
  const linkedinThreadId = asStr(threadIdRaw);
  const linkedinUrlRaw = o.linkedin_url ?? (payload as Record<string, unknown>).linkedin_url;
  const linkedinUrl = asStr(linkedinUrlRaw);

  // Per-kind required fields. Lightweight — we want flexibility in payload
  // shape for the scraper, but a stage_change with no target is useless.
  if (kind === "stage_change") {
    const toStatus = asStr((payload as Record<string, unknown>).to_status);
    if (!toStatus) {
      return {
        ok: false,
        error: `proposal[${index}].payload.to_status is required for stage_change`,
      };
    }
    if (!leadId && !linkedinThreadId && !linkedinUrl) {
      return {
        ok: false,
        error: `proposal[${index}] stage_change needs lead_id, linkedin_thread_id, or linkedin_url`,
      };
    }
  }
  if (kind === "new_activity") {
    if (!leadId && !linkedinThreadId && !linkedinUrl) {
      return {
        ok: false,
        error: `proposal[${index}] new_activity needs lead_id, linkedin_thread_id, or linkedin_url`,
      };
    }
  }
  if (kind === "new_lead") {
    if (!linkedinUrl && !linkedinThreadId) {
      return {
        ok: false,
        error: `proposal[${index}] new_lead needs linkedin_url or linkedin_thread_id`,
      };
    }
  }
  if (kind === "set_wake_up") {
    if (!leadId && !linkedinThreadId && !linkedinUrl) {
      return {
        ok: false,
        error: `proposal[${index}] set_wake_up needs lead_id, linkedin_thread_id, or linkedin_url`,
      };
    }
    // Used by the deep historical sweep to park long-cold leads. The
    // payload must spell out the wake-up target so a reviewer can
    // see at a glance how long the proposal would shelve the lead.
    const rawWake = (payload as Record<string, unknown>).wake_up_at;
    if (rawWake === null) {
      // Explicit unpark proposal — fine.
    } else if (typeof rawWake !== "string" || !rawWake.trim()) {
      return {
        ok: false,
        error: `proposal[${index}] set_wake_up payload must include wake_up_at (ISO date or null)`,
      };
    } else {
      const w = rawWake.trim();
      const d = /^\d{4}-\d{2}-\d{2}$/.test(w)
        ? new Date(w + "T00:00:00.000Z")
        : new Date(w);
      if (Number.isNaN(d.getTime())) {
        return {
          ok: false,
          error: `proposal[${index}] set_wake_up wake_up_at is not a valid ISO date/datetime`,
        };
      }
    }
  }
  if (kind === "update_contact") {
    if (!leadId && !linkedinThreadId && !linkedinUrl) {
      return {
        ok: false,
        error: `proposal[${index}] update_contact needs lead_id, linkedin_thread_id, or linkedin_url`,
      };
    }
  }

  return {
    ok: true,
    value: {
      kind: kind as ProposalKind,
      lead_id: leadId,
      linkedin_thread_id: linkedinThreadId,
      linkedin_url: linkedinUrl ? normalizeLinkedinUrl(linkedinUrl) : null,
      payload: payload as Record<string, unknown>,
    },
  };
}

// Decide which to_status a stage_change should propose when the
// scraper finds an invited lead's thread in DMs. Inbound first
// message means the prospect actually replied → 'engaged'; outbound
// means we sent them a follow-up after they accepted but they
// haven't said anything back yet → 'contacted'.
function reconcileTargetStatus(payload: Record<string, unknown>): "contacted" | "engaged" {
  const dir = asStr(payload.first_message_direction);
  if (dir === "inbound") return "engaged";
  return "contacted";
}

export async function POST(req: NextRequest) {
  // ── Auth ──
  const expected = process.env.COWORK_API_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Server not configured (COWORK_API_TOKEN unset)" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  const token = match ? match[1].trim() : "";
  if (!token || !safeEqualString(token, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Parse / validate ──
  const body = await req.json().catch(() => ({}));
  const observedAt = asStr(body?.observed_at);
  const rawProposals = Array.isArray(body?.proposals)
    ? (body.proposals as unknown[])
    : null;

  if (!observedAt) {
    return NextResponse.json(
      { error: "observed_at is required (ISO datetime)" },
      { status: 400 },
    );
  }
  if (!rawProposals) {
    return NextResponse.json(
      { error: "proposals[] is required" },
      { status: 400 },
    );
  }

  const proposals: ProposalInput[] = [];
  const validationErrors: { index: number; error: string }[] = [];
  rawProposals.forEach((raw, i) => {
    const v = validateProposal(raw, i);
    if (v.ok) proposals.push(v.value);
    else validationErrors.push({ index: i, error: v.error });
  });

  if (validationErrors.length > 0) {
    return NextResponse.json(
      { error: "validation failed", details: validationErrors },
      { status: 400 },
    );
  }

  // ── Supabase service client ──
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (Supabase env vars missing)" },
      { status: 500 },
    );
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (proposals.length === 0) {
    return NextResponse.json({
      observed_at: observedAt,
      total: 0,
      inserted: 0,
      skipped: { existing_proposal: 0, no_match: 0, invalid: 0 },
      inserted_ids: [],
      reconciled: [],
    });
  }

  // ── Resolve target leads in bulk ──
  // Collect every key the scraper could match against and look up each
  // in one query. We intentionally trust lead_id when set (the scraper
  // knows from a previous run); otherwise we walk thread_id then URL.
  const threadIds = Array.from(
    new Set(
      proposals
        .map((p) => p.linkedin_thread_id)
        .filter((s): s is string => !!s),
    ),
  );
  const urls = Array.from(
    new Set(
      proposals.map((p) => p.linkedin_url).filter((s): s is string => !!s),
    ),
  );
  const explicitLeadIds = Array.from(
    new Set(
      proposals.map((p) => p.lead_id).filter((s): s is string => !!s),
    ),
  );

  type LeadRow = {
    id: string;
    status: string;
    linkedin_url: string | null;
    linkedin_thread_id: string | null;
    contact_id: string | null;
  };

  const leadsByThread = new Map<string, LeadRow>();
  const leadsByUrl = new Map<string, LeadRow>();
  const leadsById = new Map<string, LeadRow>();

  // 1) explicit lead_ids
  if (explicitLeadIds.length > 0) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, status, linkedin_url, linkedin_thread_id, contact_id")
      .in("id", explicitLeadIds);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    for (const r of (data ?? []) as LeadRow[]) {
      leadsById.set(r.id, r);
      if (r.linkedin_thread_id) leadsByThread.set(r.linkedin_thread_id, r);
      if (r.linkedin_url) leadsByUrl.set(r.linkedin_url, r);
    }
  }

  // 2) thread_ids
  if (threadIds.length > 0) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, status, linkedin_url, linkedin_thread_id, contact_id")
      .in("linkedin_thread_id", threadIds);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    for (const r of (data ?? []) as LeadRow[]) {
      leadsById.set(r.id, r);
      if (r.linkedin_thread_id) leadsByThread.set(r.linkedin_thread_id, r);
      if (r.linkedin_url) leadsByUrl.set(r.linkedin_url, r);
    }
  }

  // 3) lead-level URLs
  if (urls.length > 0) {
    const { data, error } = await supabase
      .from("leads")
      .select("id, status, linkedin_url, linkedin_thread_id, contact_id")
      .in("linkedin_url", urls);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    for (const r of (data ?? []) as LeadRow[]) {
      leadsById.set(r.id, r);
      if (r.linkedin_url && !leadsByUrl.has(r.linkedin_url)) {
        leadsByUrl.set(r.linkedin_url, r);
      }
      if (r.linkedin_thread_id && !leadsByThread.has(r.linkedin_thread_id)) {
        leadsByThread.set(r.linkedin_thread_id, r);
      }
    }
  }

  // 4) contact-level URLs (fallback for leads where the URL only lives on contacts)
  if (urls.length > 0) {
    const { data, error } = await supabase
      .from("contacts")
      .select(
        "id, linkedin_url, leads:leads(id, status, linkedin_url, linkedin_thread_id, contact_id)",
      )
      .in("linkedin_url", urls);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    for (const c of (data ?? []) as Array<{
      id: string;
      linkedin_url: string | null;
      leads: Array<LeadRow> | LeadRow | null;
    }>) {
      const row = Array.isArray(c.leads) ? c.leads[0] : c.leads;
      if (!row || !c.linkedin_url) continue;
      if (!leadsByUrl.has(c.linkedin_url)) leadsByUrl.set(c.linkedin_url, row);
      if (!leadsById.has(row.id)) leadsById.set(row.id, row);
    }
  }

  function resolveLead(p: ProposalInput): LeadRow | null {
    if (p.lead_id) {
      const r = leadsById.get(p.lead_id);
      if (r) return r;
    }
    if (p.linkedin_thread_id) {
      const r = leadsByThread.get(p.linkedin_thread_id);
      if (r) return r;
    }
    if (p.linkedin_url) {
      const r = leadsByUrl.get(p.linkedin_url);
      if (r) return r;
    }
    return null;
  }

  // ── Existing pending proposals (dedupe) ──
  const { data: existingPending, error: pendingErr } = await supabase
    .from("review_queue")
    .select("id, kind, linkedin_thread_id, payload")
    .eq("status", "pending");
  if (pendingErr) {
    return NextResponse.json({ error: pendingErr.message }, { status: 500 });
  }
  const dedupeKeys = new Set<string>();
  for (const r of (existingPending ?? []) as Array<{
    kind: string;
    linkedin_thread_id: string | null;
    payload: Record<string, unknown> | null;
  }>) {
    const url = (r.payload?.linkedin_url ?? null) as string | null;
    if (r.linkedin_thread_id) dedupeKeys.add(`${r.kind}::tid::${r.linkedin_thread_id}`);
    if (url) dedupeKeys.add(`${r.kind}::url::${url}`);
  }

  // ── Build inserts + reconciliation ──
  const rowsToInsert: RowToInsert[] = [];
  const reconciled: Array<{
    source_kind: ProposalKind;
    lead_id: string;
    from_status: string;
    to_status: string;
  }> = [];
  let skippedExistingProposal = 0;

  for (const p of proposals) {
    const lead = resolveLead(p);
    const resolvedLeadId = lead?.id ?? null;

    // Effective payload: merge identifying fields back into payload so
    // reviewers see everything in one place.
    const effectivePayload: Record<string, unknown> = {
      ...p.payload,
      observed_at: observedAt,
    };
    if (p.linkedin_url && !effectivePayload.linkedin_url) {
      effectivePayload.linkedin_url = p.linkedin_url;
    }
    if (p.linkedin_thread_id && !effectivePayload.linkedin_thread_id) {
      effectivePayload.linkedin_thread_id = p.linkedin_thread_id;
    }
    if (lead?.status) effectivePayload.matched_lead_status = lead.status;

    let effectiveKind: ProposalKind = p.kind;

    // Demote new_lead → new_activity when the lead already exists and
    // is past the invited stage. The scraper didn't know there was a
    // matching lead; we do, so we don't double-create.
    if (effectiveKind === "new_lead" && lead) {
      effectiveKind = "new_activity";
      effectivePayload.demoted_from = "new_lead";
    }

    // Dedupe key (per-kind, scoped by thread_id when available, else URL).
    const dedupeTid = p.linkedin_thread_id;
    const dedupeUrl = p.linkedin_url;
    const dedupeKey = dedupeTid
      ? `${effectiveKind}::tid::${dedupeTid}`
      : dedupeUrl
        ? `${effectiveKind}::url::${dedupeUrl}`
        : null;
    if (dedupeKey && dedupeKeys.has(dedupeKey)) {
      skippedExistingProposal++;
      continue;
    }

    rowsToInsert.push({
      kind: effectiveKind,
      source: "linkedin_dm_scraper",
      payload: effectivePayload,
      lead_id: resolvedLeadId,
      linkedin_thread_id: p.linkedin_thread_id ?? null,
    });
    if (dedupeKey) dedupeKeys.add(dedupeKey);

    // Invited-lead reconciliation: synthesize a stage_change proposal
    // when the matched lead is currently 'invited' and the scraper-
    // sourced kind is new_lead/new_activity (i.e. an actual DM thread,
    // not a wake-up tweak). Do this once per lead per batch.
    if (
      lead &&
      lead.status === "invited" &&
      (p.kind === "new_lead" || p.kind === "new_activity")
    ) {
      const toStatus = reconcileTargetStatus(effectivePayload);
      const stageDedupeKey = `stage_change::lid::${lead.id}::to::${toStatus}`;
      if (!dedupeKeys.has(stageDedupeKey)) {
        rowsToInsert.push({
          kind: "stage_change",
          source: "linkedin_dm_scraper",
          payload: {
            from_status: "invited",
            to_status: toStatus,
            reconciled_from: "invited_thread_match",
            linkedin_thread_id: p.linkedin_thread_id ?? null,
            linkedin_url: p.linkedin_url ?? null,
            observed_at: observedAt,
            set_connection_accepted_at: observedAt,
          },
          lead_id: lead.id,
          linkedin_thread_id: p.linkedin_thread_id ?? null,
        });
        dedupeKeys.add(stageDedupeKey);
        reconciled.push({
          source_kind: p.kind,
          lead_id: lead.id,
          from_status: "invited",
          to_status: toStatus,
        });
      }
    }
  }

  // ── Insert ──
  let insertedIds: string[] = [];
  if (rowsToInsert.length > 0) {
    const { data: inserted, error: insErr } = await supabase
      .from("review_queue")
      .insert(rowsToInsert)
      .select("id");
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
    insertedIds = (inserted ?? []).map((r) => r.id as string);
  }

  // ── Stamp last_inbox_sync_at on every resolved lead ──
  // Drives the next scrape's "newer than X" filter. Best-effort —
  // if it fails, we still return inserted_ids so the scraper run
  // isn't lost.
  const resolvedLeadIds = new Set<string>();
  for (const p of proposals) {
    const lead = resolveLead(p);
    if (lead) resolvedLeadIds.add(lead.id);
  }
  if (resolvedLeadIds.size > 0) {
    await supabase
      .from("leads")
      .update({ last_inbox_sync_at: observedAt })
      .in("id", Array.from(resolvedLeadIds));
  }

  return NextResponse.json({
    observed_at: observedAt,
    total: proposals.length,
    inserted: insertedIds.length,
    skipped: { existing_proposal: skippedExistingProposal },
    inserted_ids: insertedIds,
    reconciled,
  });
}
