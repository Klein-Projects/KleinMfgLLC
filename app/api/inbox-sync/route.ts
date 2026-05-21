import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { classifyLead } from "@/lib/portal/classify-lead";

// POST /api/inbox-sync — Phase 2 + Phase 5 (Part A)
//
// Cowork-facing write endpoint. Hit by the 7am LinkedIn DM scraper
// task with a batch of proposals derived from walking Sean's DM
// inbox. Body shape:
// {
//   observed_at: string (ISO datetime),
//   proposals: [
//     {
//       kind: "new_lead" | "new_activity" | "stage_change"
//           | "update_contact" | "set_wake_up",
//       lead_id?:            string | null,
//       linkedin_thread_id?: string | null,
//       linkedin_url?:       string | null,
//       payload:             Record<string, unknown>,
//     },
//     ...
//   ]
// }
//
// Reconciliation (Phase 2):
//   1. For every proposal, try to resolve a target lead. Match order:
//      lead_id → linkedin_thread_id (lead-level) → linkedin_url
//      (lead-level) → linkedin_url (contact-level).
//   2. When a proposal of kind 'new_lead' or 'new_activity' resolves
//      to a lead with status='invited', the endpoint synthesizes an
//      additional kind='stage_change' proposal advancing the lead
//      from 'invited' to 'contacted' (outbound first message) or
//      'engaged' (inbound first message).
//   3. When a 'new_lead' proposal resolves to an existing lead, demote
//      it to a 'new_activity' proposal so we don't double-create. The
//      original payload is preserved with `demoted_from: "new_lead"`.
//
// Routing (Phase 5 Part A, auto-apply):
//   Every proposal is routed to one of two paths:
//
//   AUTO_APPLY — applied directly to activities / leads, never lands
//                in review_queue. Counts toward `auto_applied`.
//     • new_activity to a known (matched) lead, any direction.
//     • stage_change invited→contacted or invited→engaged when the
//       lead is currently invited and a DM thread exists.
//     • stage_change contacted→engaged when the lead is currently
//       contacted (first real inbound).
//   These are mechanical facts from the scraper — auto-apply does
//   not gate on the lead's classifier state_confidence. The Phase 0
//   Decision 2 threshold of 0.70 is for classifier OUTPUTS
//   (conversation_state assignments), not scraper proposals.
//
//   QUEUE_FOR_REVIEW — written to review_queue with status='pending'.
//                      Counts toward `queued`.
//     • Any proposal setting status = won or status = lost.
//     • new_lead with no matching existing lead (unknown URL).
//     • stage_change transitions that skip funnel steps (e.g.
//       contacted→sample_sent without engaged in between).
//     • update_contact, set_wake_up (safe default — not in the
//       AUTO_APPLY allow-list).
//     • Any proposal whose auto-apply attempt threw — falls back
//       to queueing with `auto_apply_error` annotation on payload.
//
// Dedupe (applies to both routes):
//   - Skip pending review_queue rows that already exist for the same
//     (kind, linkedin_thread_id) or (kind, linkedin_url when no
//     thread_id). Counted as skipped.existing_proposal.
//   - Phantom-activity backstop on new_activity: skip if
//     payload.linkedin_message_urn already exists on an activities
//     row, a pending review_queue row, OR was claimed by an earlier
//     proposal in this batch. Counted as skipped.duplicate_message_urn.
//   - The unique partial index on activities.linkedin_message_urn is
//     the DB-level backstop and is honored by the auto-apply path too
//     (23505 unique_violation → fold into existing row).
//
// Classifier hook:
//   After every new_activity that becomes a real activities row —
//   whether via auto-apply here or via /api/review-queue/[id]/approve
//   — the Haiku conversation-state classifier (lib/portal/classify-lead)
//   runs for that lead. To keep the historical-sweep cost bounded, the
//   auto-apply path runs the classifier once per lead per batch, after
//   all activity inserts complete. Best-effort: a classifier failure
//   is logged but does NOT roll back the approved activities.
//
// Side effect: bumps leads.last_inbox_sync_at on every resolved lead
// so the next scrape can fetch incrementally.
//
// Auth: Bearer token (COWORK_API_TOKEN env var). Service-role
// Supabase client; bypasses RLS.
//
// Returns 200 with {
//   observed_at,
//   total,
//   auto_applied,
//   queued,
//   skipped: { existing_proposal, duplicate_message_urn },
//   queued_ids[],          // inserted review_queue row ids
//   auto_applied_details[],// per-auto-apply outcome
//   reconciled[],          // synthesized invited→{contacted,engaged}
// }.

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

const VALID_LEAD_STATUSES = new Set([
  "new",
  "invited",
  "contacted",
  "engaged",
  "sample_sent",
  "quoted",
  "won",
  "lost",
  "nurture",
]);

const VALID_ACTIVITY_TYPES = new Set([
  "linkedin_message",
  "connection_request",
  "email",
  "phone",
  "note",
  "sample_sent",
  "follow_up",
  "web_order",
]);

// Mirrors approve.ts SUMMARY_MAX — activities.summary is the short
// preview shown in compact views, full text goes to activities.body.
const SUMMARY_MAX = 240;

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

type LeadRow = {
  id: string;
  status: string;
  linkedin_url: string | null;
  linkedin_thread_id: string | null;
  contact_id: string | null;
  invited_at: string | null;
};

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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

// Short preview shown in compact contexts (Today queue, dashboards).
// 120 chars + ellipsis matches what the activity log fallback shows
// when no full body is available.
const SUMMARY_PREVIEW_MAX = 120;
function previewFromBody(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  if (collapsed.length <= SUMMARY_PREVIEW_MAX) return collapsed;
  return collapsed.slice(0, SUMMARY_PREVIEW_MAX - 1).trimEnd() + "…";
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
    const bodyRaw = o.body ?? (payload as Record<string, unknown>).body;
    const body = asStr(bodyRaw);
    const p = payload as Record<string, unknown>;
    if (body) p.body = body;
    if (body && !asStr(p.summary)) {
      p.summary = previewFromBody(body);
    }
    const urnRaw = o.linkedin_message_urn ?? p.linkedin_message_urn;
    const urn = asStr(urnRaw);
    if (urn) p.linkedin_message_urn = urn;
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

function reconcileTargetStatus(payload: Record<string, unknown>): "contacted" | "engaged" {
  const dir = asStr(payload.first_message_direction);
  if (dir === "inbound") return "engaged";
  return "contacted";
}

// ── Routing ────────────────────────────────────────────────────────────
//
// Decide whether an (effectiveKind, payload, lead) tuple is safe to
// auto-apply or should land in review_queue. Pure function — no I/O.
function decideRoute(
  kind: ProposalKind,
  payload: Record<string, unknown>,
  lead: LeadRow | null,
): "auto_apply" | "queue" {
  // Hard queue: any deal-closing transition. Sean confirms by hand.
  if (kind === "stage_change") {
    const toStatus = asStr(payload.to_status);
    if (toStatus === "won" || toStatus === "lost") return "queue";
    if (!lead) return "queue";
    const cur = lead.status;
    const ok =
      (cur === "invited" && (toStatus === "contacted" || toStatus === "engaged")) ||
      (cur === "contacted" && toStatus === "engaged");
    if (!ok) return "queue"; // unknown / skips funnel steps
  } else if (kind === "new_activity") {
    if (!lead) return "queue";
    const type = asStr(payload.type) ?? "linkedin_message";
    if (!VALID_ACTIVITY_TYPES.has(type)) return "queue";
  } else if (kind === "new_lead") {
    // Reached only when the lead is unmatched — a matched new_lead
    // is demoted to new_activity upstream. Truly-new leads queue.
    return "queue";
  } else {
    // update_contact, set_wake_up — not on the AUTO_APPLY allow-list.
    return "queue";
  }

  // No state_confidence gate here — these are mechanical facts (a
  // message exists, a thread is now accepted), not classifier
  // judgments. The 0.70 threshold belongs on classifier-output write
  // paths, not on scraper-proposal routing.
  return "auto_apply";
}

// ── Auto-apply: new_activity ───────────────────────────────────────────
//
// Mirrors the new_activity branch of /api/review-queue/[id]/approve so
// auto-applied activities are indistinguishable from approved ones in
// the activities table. Caller is responsible for triggering the
// classifier post-batch.
async function applyNewActivity(
  supabase: SupabaseClient,
  lead: LeadRow,
  payload: Record<string, unknown>,
  threadId: string | null,
): Promise<{ activity_id: string; lead_id: string }> {
  const type = asStr(payload.type) ?? "linkedin_message";
  const body = asStr(payload.body);
  const summary =
    asStr(payload.summary) ??
    asStr(payload.first_message_excerpt) ??
    asStr(payload.message_excerpt) ??
    (body ? body : "Logged from DM scraper");
  const direction =
    asStr(payload.direction) === "inbound" ? "inbound" : "outbound";
  const occurredAt =
    asStr(payload.occurred_at) ??
    asStr(payload.first_message_at) ??
    asStr(payload.observed_at);

  const insert: Record<string, unknown> = {
    lead_id: lead.id,
    type,
    summary: truncate(summary, SUMMARY_MAX),
    direction,
    source: "dm_inbox_scraper",
  };
  if (body) insert.body = body;
  if (occurredAt) insert.created_at = occurredAt;
  const messageUrn = asStr(payload.linkedin_message_urn);
  if (messageUrn) insert.linkedin_message_urn = messageUrn;

  // 23505 (unique_violation) backstop: the partial unique index on
  // activities.linkedin_message_urn means a racing concurrent insert
  // for the same URN will raise. Fold into the existing row instead
  // of failing the whole proposal.
  const insertRes = await supabase
    .from("activities")
    .insert(insert)
    .select("id")
    .single();
  let activity = insertRes.data as { id: string } | null;
  const insertErr = insertRes.error as { code?: string; message: string } | null;
  if (insertErr) {
    if (messageUrn && insertErr.code === "23505") {
      const { data: existing } = await supabase
        .from("activities")
        .select("id")
        .eq("linkedin_message_urn", messageUrn)
        .limit(1)
        .maybeSingle();
      activity = (existing as { id: string } | null) ?? null;
      if (!activity) {
        throw new Error(
          "Duplicate linkedin_message_urn but existing row not found",
        );
      }
    } else {
      throw new Error(insertErr.message);
    }
  }
  if (!activity) throw new Error("Failed to insert activity");

  const leadUpdates: Record<string, unknown> = {
    last_activity_at: new Date().toISOString(),
  };
  if (threadId && !lead.linkedin_thread_id) {
    leadUpdates.linkedin_thread_id = threadId;
  }
  await supabase.from("leads").update(leadUpdates).eq("id", lead.id);
  if (threadId && !lead.linkedin_thread_id) {
    lead.linkedin_thread_id = threadId;
  }

  return { activity_id: activity.id, lead_id: lead.id };
}

// ── Auto-apply: stage_change ───────────────────────────────────────────
async function applyStageChange(
  supabase: SupabaseClient,
  lead: LeadRow,
  payload: Record<string, unknown>,
  threadId: string | null,
): Promise<{ lead_id: string; from_status: string; to_status: string }> {
  const toStatus = asStr(payload.to_status);
  if (!toStatus || !VALID_LEAD_STATUSES.has(toStatus)) {
    throw new Error(`Invalid to_status: ${toStatus}`);
  }

  const updates: Record<string, unknown> = {
    status: toStatus,
    last_activity_at: new Date().toISOString(),
  };
  const setAccepted = asStr(payload.set_connection_accepted_at);
  if (setAccepted) {
    updates.connection_accepted_at = setAccepted;
  } else if (
    lead.status === "invited" &&
    (toStatus === "contacted" || toStatus === "engaged")
  ) {
    updates.connection_accepted_at = new Date().toISOString();
  }
  if (threadId && !lead.linkedin_thread_id) {
    updates.linkedin_thread_id = threadId;
  }

  const { error: updErr } = await supabase
    .from("leads")
    .update(updates)
    .eq("id", lead.id);
  if (updErr) throw new Error(updErr.message);

  const fromStatus = lead.status;
  lead.status = toStatus;
  if (threadId && !lead.linkedin_thread_id) lead.linkedin_thread_id = threadId;
  return { lead_id: lead.id, from_status: fromStatus, to_status: toStatus };
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
      auto_applied: 0,
      queued: 0,
      skipped: { existing_proposal: 0, duplicate_message_urn: 0 },
      queued_ids: [],
      auto_applied_details: [],
      reconciled: [],
    });
  }

  // ── Resolve target leads in bulk ──
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

  const LEAD_COLS =
    "id, status, linkedin_url, linkedin_thread_id, contact_id, invited_at";

  const leadsByThread = new Map<string, LeadRow>();
  const leadsByUrl = new Map<string, LeadRow>();
  const leadsById = new Map<string, LeadRow>();

  if (explicitLeadIds.length > 0) {
    const { data, error } = await supabase
      .from("leads")
      .select(LEAD_COLS)
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

  if (threadIds.length > 0) {
    const { data, error } = await supabase
      .from("leads")
      .select(LEAD_COLS)
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

  if (urls.length > 0) {
    const { data, error } = await supabase
      .from("leads")
      .select(LEAD_COLS)
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

  if (urls.length > 0) {
    const { data, error } = await supabase
      .from("contacts")
      .select(
        `id, linkedin_url, leads:leads(${LEAD_COLS})`,
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
  const pendingUrns = new Set<string>();
  for (const r of (existingPending ?? []) as Array<{
    kind: string;
    linkedin_thread_id: string | null;
    payload: Record<string, unknown> | null;
  }>) {
    const url = (r.payload?.linkedin_url ?? null) as string | null;
    if (r.linkedin_thread_id) dedupeKeys.add(`${r.kind}::tid::${r.linkedin_thread_id}`);
    if (url) dedupeKeys.add(`${r.kind}::url::${url}`);
    const pUrn = asStr(r.payload?.linkedin_message_urn);
    if (pUrn) pendingUrns.add(pUrn);
  }

  const urnCandidates = Array.from(
    new Set(
      proposals
        .filter((p) => p.kind === "new_activity")
        .map((p) => asStr(p.payload.linkedin_message_urn))
        .filter((s): s is string => !!s),
    ),
  );
  const existingActivityUrns = new Set<string>();
  if (urnCandidates.length > 0) {
    const { data: existingActs, error: actErr } = await supabase
      .from("activities")
      .select("linkedin_message_urn")
      .in("linkedin_message_urn", urnCandidates);
    if (actErr) {
      return NextResponse.json({ error: actErr.message }, { status: 500 });
    }
    for (const r of (existingActs ?? []) as Array<{
      linkedin_message_urn: string | null;
    }>) {
      if (r.linkedin_message_urn) existingActivityUrns.add(r.linkedin_message_urn);
    }
  }

  // ── Build inserts + reconciliation ──
  const rowsToInsert: RowToInsert[] = [];
  const reconciled: Array<{
    source_kind: ProposalKind;
    lead_id: string;
    from_status: string;
    to_status: string;
  }> = [];
  const autoAppliedDetails: Array<{
    kind: ProposalKind;
    lead_id: string;
    activity_id?: string;
    from_status?: string;
    to_status?: string;
  }> = [];
  // Leads whose new_activity got auto-applied — we run the Haiku
  // classifier exactly once per lead after the batch finishes.
  const classifierLeadIds = new Set<string>();
  let autoAppliedCount = 0;
  let skippedExistingProposal = 0;
  let skippedDuplicateMessageUrn = 0;
  const seenUrnsThisBatch = new Set<string>();

  // Inline helper that routes one (effectiveKind, payload, lead) tuple.
  // Tries auto-apply when decideRoute allows; on any auto-apply error
  // falls back to queueing the proposal with `auto_apply_error` set on
  // the payload so Sean can see what happened.
  async function routeAndApply(
    effectiveKind: ProposalKind,
    effectivePayload: Record<string, unknown>,
    lead: LeadRow | null,
    threadIdForApply: string | null,
  ): Promise<"auto_applied" | "queued"> {
    const route = decideRoute(effectiveKind, effectivePayload, lead);
    if (route === "auto_apply" && lead) {
      try {
        if (effectiveKind === "new_activity") {
          const r = await applyNewActivity(supabase, lead, effectivePayload, threadIdForApply);
          autoAppliedDetails.push({
            kind: effectiveKind,
            lead_id: r.lead_id,
            activity_id: r.activity_id,
          });
          classifierLeadIds.add(r.lead_id);
        } else if (effectiveKind === "stage_change") {
          const r = await applyStageChange(supabase, lead, effectivePayload, threadIdForApply);
          autoAppliedDetails.push({
            kind: effectiveKind,
            lead_id: r.lead_id,
            from_status: r.from_status,
            to_status: r.to_status,
          });
        } else {
          // decideRoute should never return auto_apply for other kinds.
          throw new Error(`Auto-apply unsupported for kind=${effectiveKind}`);
        }
        autoAppliedCount++;
        return "auto_applied";
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : "auto-apply failed";
        console.error("[inbox-sync] auto-apply failed, queueing", {
          kind: effectiveKind,
          lead_id: lead.id,
          error: msg,
        });
        effectivePayload.auto_apply_error = msg;
      }
    }
    rowsToInsert.push({
      kind: effectiveKind,
      source: "linkedin_dm_scraper",
      payload: effectivePayload,
      lead_id: lead?.id ?? null,
      linkedin_thread_id: threadIdForApply,
    });
    return "queued";
  }

  for (const p of proposals) {
    const lead = resolveLead(p);

    // Phantom-activity dedupe (URN-keyed). Skips before any side effect.
    if (p.kind === "new_activity") {
      const urn = asStr(p.payload.linkedin_message_urn);
      if (urn) {
        if (
          existingActivityUrns.has(urn) ||
          pendingUrns.has(urn) ||
          seenUrnsThisBatch.has(urn)
        ) {
          skippedDuplicateMessageUrn++;
          continue;
        }
        seenUrnsThisBatch.add(urn);
      } else {
        console.warn(
          "[inbox-sync] new_activity proposal without linkedin_message_urn",
          {
            observed_at: observedAt,
            linkedin_thread_id: p.linkedin_thread_id,
            linkedin_url: p.linkedin_url,
            lead_id: p.lead_id,
          },
        );
      }
    }

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
    if (effectiveKind === "new_lead" && lead) {
      effectiveKind = "new_activity";
      effectivePayload.demoted_from = "new_lead";
    }

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

    await routeAndApply(
      effectiveKind,
      effectivePayload,
      lead,
      p.linkedin_thread_id ?? null,
    );
    if (dedupeKey) dedupeKeys.add(dedupeKey);

    // Invited-lead reconciliation: synthesize a stage_change when the
    // matched lead is currently 'invited' and the scraper-sourced kind
    // is new_lead/new_activity. The synthetic stage_change goes through
    // the same routing — for the invited→contacted/engaged case it
    // auto-applies, otherwise it queues.
    if (
      lead &&
      lead.status === "invited" &&
      (p.kind === "new_lead" || p.kind === "new_activity")
    ) {
      const toStatus = reconcileTargetStatus(effectivePayload);
      const stageDedupeKey = `stage_change::lid::${lead.id}::to::${toStatus}`;
      if (!dedupeKeys.has(stageDedupeKey)) {
        const stagePayload: Record<string, unknown> = {
          from_status: "invited",
          to_status: toStatus,
          reconciled_from: "invited_thread_match",
          linkedin_thread_id: p.linkedin_thread_id ?? null,
          linkedin_url: p.linkedin_url ?? null,
          observed_at: observedAt,
          set_connection_accepted_at: observedAt,
        };
        await routeAndApply(
          "stage_change",
          stagePayload,
          lead,
          p.linkedin_thread_id ?? null,
        );
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

  // ── Insert queued rows into review_queue ──
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

  // ── Classifier hook (auto-apply path) ──
  // Once per lead per batch — see header comment. Failures are logged
  // but do NOT roll back the auto-applied activities.
  for (const leadId of Array.from(classifierLeadIds)) {
    try {
      await classifyLead(supabase, leadId);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "classify failed";
      console.error("[inbox-sync] classifier failed for lead", { leadId, error: msg });
    }
  }

  // ── Stamp last_inbox_sync_at on every resolved lead ──
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
    auto_applied: autoAppliedCount,
    queued: insertedIds.length,
    skipped: {
      existing_proposal: skippedExistingProposal,
      duplicate_message_urn: skippedDuplicateMessageUrn,
    },
    queued_ids: insertedIds,
    auto_applied_details: autoAppliedDetails,
    reconciled,
  });
}
