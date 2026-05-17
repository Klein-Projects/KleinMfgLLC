import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { classifyLead } from "@/lib/portal/classify-lead";

// POST /api/review-queue/:id/approve — Phase 2
//
// Applies a pending review_queue row to production tables.
// Sean clicks Approve from /portal/review-queue.
//
// Effects per kind:
//   new_lead       — creates company (if name given and not present),
//                    contact, and lead with proposed_status; stamps
//                    invited_at when proposed_status='invited'.
//                    If a lead at the same linkedin_url already exists,
//                    instead absorbs the payload's non-null fields
//                    (title, headline → linkedin_profile_text, company,
//                    linkedin_thread_id) into the existing lead and
//                    marks the row approved.
//   new_activity   — appends an activity row to the matched lead.
//   stage_change   — updates lead.status (and connection_accepted_at
//                    when the proposal includes set_connection_accepted_at,
//                    typically when reconciling invited→contacted/engaged).
//   update_contact — updates fields on the lead's contact row.
//   set_wake_up    — sets lead.wake_up_at + wake_up_reason.
//
// Marks the row status='approved' with decided_at and decided_by once
// the side effects succeed. If the side effect fails, the row stays
// pending so Sean can retry after fixing the underlying state.
//
// Idempotency: re-approving an already-approved row returns
// 409 Conflict with the existing decision metadata.
//
// Auth: cookie session.

const SUMMARY_MAX = 240;

function asStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

function splitName(full: string): { first: string; last: string } {
  const trimmed = full.trim();
  const idx = trimmed.lastIndexOf(" ");
  if (idx <= 0) return { first: trimmed, last: "" };
  return {
    first: trimmed.slice(0, idx).trim(),
    last: trimmed.slice(idx + 1).trim(),
  };
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

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const id = params.id;
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: row, error: fetchErr } = await supabase
    .from("review_queue")
    .select(
      "id, kind, source, payload, lead_id, linkedin_thread_id, status, decided_at, decided_by",
    )
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json(
      { error: "Review queue row not found" },
      { status: 404 },
    );
  }
  if (row.status !== "pending") {
    return NextResponse.json(
      {
        error: `Already ${row.status}`,
        decided_at: row.decided_at,
        decided_by: row.decided_by,
      },
      { status: 409 },
    );
  }

  const kind = row.kind as
    | "new_lead"
    | "new_activity"
    | "stage_change"
    | "update_contact"
    | "set_wake_up";
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  const threadId = row.linkedin_thread_id as string | null;
  const leadIdInRow = row.lead_id as string | null;

  // Helper: resolve lead by row.lead_id → thread_id (lead-level) →
  // payload.linkedin_url (lead-level then contact-level). Used by
  // every kind except new_lead.
  async function resolveLead(): Promise<{
    id: string;
    contact_id: string | null;
    company_id: string | null;
    status: string;
    invited_at: string | null;
    linkedin_url: string | null;
    linkedin_thread_id: string | null;
  } | null> {
    if (leadIdInRow) {
      const { data } = await supabase
        .from("leads")
        .select(
          "id, contact_id, company_id, status, invited_at, linkedin_url, linkedin_thread_id",
        )
        .eq("id", leadIdInRow)
        .maybeSingle();
      if (data) return data as any;
    }
    if (threadId) {
      const { data } = await supabase
        .from("leads")
        .select(
          "id, contact_id, company_id, status, invited_at, linkedin_url, linkedin_thread_id",
        )
        .eq("linkedin_thread_id", threadId)
        .limit(1)
        .maybeSingle();
      if (data) return data as any;
    }
    const url = asStr(payload.linkedin_url);
    if (url) {
      const norm = normalizeLinkedinUrl(url);
      const { data: byLead } = await supabase
        .from("leads")
        .select(
          "id, contact_id, company_id, status, invited_at, linkedin_url, linkedin_thread_id",
        )
        .eq("linkedin_url", norm)
        .limit(1)
        .maybeSingle();
      if (byLead) return byLead as any;
      const { data: byContact } = await supabase
        .from("contacts")
        .select(
          "id, leads:leads(id, contact_id, company_id, status, invited_at, linkedin_url, linkedin_thread_id)",
        )
        .eq("linkedin_url", norm)
        .limit(1)
        .maybeSingle();
      const linked = (byContact as any)?.leads;
      if (linked) {
        return Array.isArray(linked) ? linked[0] : linked;
      }
    }
    return null;
  }

  let appliedSummary: Record<string, unknown> = {};

  try {
    if (kind === "new_lead") {
      const linkedinUrlRaw = asStr(payload.linkedin_url);
      const name = asStr(payload.name);
      if (!linkedinUrlRaw && !threadId) {
        return NextResponse.json(
          { error: "new_lead payload must include linkedin_url or linkedin_thread_id" },
          { status: 400 },
        );
      }
      if (!name) {
        return NextResponse.json(
          { error: "new_lead payload must include name" },
          { status: 400 },
        );
      }
      const linkedinUrl = linkedinUrlRaw
        ? normalizeLinkedinUrl(linkedinUrlRaw)
        : null;
      const proposedStatus =
        asStr(payload.proposed_status) &&
        VALID_LEAD_STATUSES.has(asStr(payload.proposed_status)!)
          ? (asStr(payload.proposed_status) as string)
          : "invited";
      const { first, last } = splitName(name);
      const company = asStr(payload.company);
      const title = asStr(payload.title);
      const headline = asStr(payload.headline);

      // If a lead already exists at this linkedin_url, absorb the
      // payload's non-null fields into it instead of erroring. This
      // closes the "Lead already exists" 409 trap where Sean would
      // click Approve and get a stuck-pending row he had to manually
      // reject. The scraper still produced useful signal (headline,
      // thread_id, sometimes a company name) — we want it captured.
      type ExistingDup = {
        id: string;
        contact_id: string | null;
        company_id: string | null;
        linkedin_thread_id: string | null;
        contact: {
          title: string | null;
          linkedin_profile_text: string | null;
        } | null;
      };
      let existingDup: ExistingDup | null = null;
      if (linkedinUrl) {
        const { data: dup } = await supabase
          .from("leads")
          .select(
            "id, contact_id, company_id, linkedin_thread_id, contact:contacts(title, linkedin_profile_text)",
          )
          .eq("linkedin_url", linkedinUrl)
          .limit(1)
          .maybeSingle();
        if (dup?.id) existingDup = dup as unknown as ExistingDup;
      }

      if (existingDup) {
        const contactPatch: Record<string, unknown> = {};
        if (existingDup.contact && !existingDup.contact.title && title) {
          contactPatch.title = title;
        }
        if (
          existingDup.contact &&
          !existingDup.contact.linkedin_profile_text &&
          headline
        ) {
          contactPatch.linkedin_profile_text = headline;
        }
        if (existingDup.contact_id && Object.keys(contactPatch).length > 0) {
          const { error: cErr } = await supabase
            .from("contacts")
            .update(contactPatch)
            .eq("id", existingDup.contact_id);
          if (cErr) throw new Error(cErr.message);
        }

        const leadPatch: Record<string, unknown> = {};
        if (threadId && !existingDup.linkedin_thread_id) {
          leadPatch.linkedin_thread_id = threadId;
        }
        if (!existingDup.company_id && company) {
          const { data: existingCompany } = await supabase
            .from("companies")
            .select("id")
            .eq("name", company)
            .limit(1)
            .maybeSingle();
          let companyId: string | null = existingCompany?.id ?? null;
          if (!companyId) {
            const { data: newCompany, error: cErr } = await supabase
              .from("companies")
              .insert({ name: company })
              .select("id")
              .single();
            if (cErr) throw new Error(cErr.message);
            companyId = newCompany!.id;
          }
          leadPatch.company_id = companyId;
        }
        if (Object.keys(leadPatch).length > 0) {
          const { error: lErr } = await supabase
            .from("leads")
            .update(leadPatch)
            .eq("id", existingDup.id);
          if (lErr) throw new Error(lErr.message);
        }

        appliedSummary = {
          merged_into_existing_lead_id: existingDup.id,
          enriched_contact_fields: Object.keys(contactPatch),
          enriched_lead_fields: Object.keys(leadPatch),
        };
      } else {
        let companyId: string | null = null;
        if (company) {
          const { data: existingCompany } = await supabase
            .from("companies")
            .select("id")
            .eq("name", company)
            .limit(1)
            .maybeSingle();
          if (existingCompany?.id) {
            companyId = existingCompany.id;
          } else {
            const { data: newCompany, error: cErr } = await supabase
              .from("companies")
              .insert({ name: company })
              .select("id")
              .single();
            if (cErr) throw new Error(cErr.message);
            companyId = newCompany.id;
          }
        }

        const { data: newContact, error: contactErr } = await supabase
          .from("contacts")
          .insert({
            first_name: first || name,
            last_name: last || "",
            title,
            linkedin_url: linkedinUrl,
            linkedin_profile_text: headline,
            company_id: companyId,
          })
          .select("id")
          .single();
        if (contactErr || !newContact) {
          throw new Error(contactErr?.message ?? "Failed to create contact");
        }

        const nowISO = new Date().toISOString();
        const leadInsert: Record<string, unknown> = {
          contact_id: newContact.id,
          company_id: companyId,
          status: proposedStatus,
          source: "linkedin",
          linkedin_url: linkedinUrl,
          linkedin_thread_id: threadId,
          last_activity_at: nowISO,
        };
        if (proposedStatus === "invited") {
          leadInsert.invited_at = asStr(payload.observed_at) ?? nowISO;
        }
        if (
          proposedStatus === "contacted" ||
          proposedStatus === "engaged" ||
          proposedStatus === "sample_sent"
        ) {
          // The scraper found an accepted thread — stamp acceptance time.
          leadInsert.connection_accepted_at =
            asStr(payload.connection_accepted_at) ??
            asStr(payload.first_message_at) ??
            asStr(payload.observed_at) ??
            nowISO;
        }

        const { data: newLead, error: leadErr } = await supabase
          .from("leads")
          .insert(leadInsert)
          .select("id, status")
          .single();
        if (leadErr || !newLead) {
          await supabase.from("contacts").delete().eq("id", newContact.id);
          throw new Error(leadErr?.message ?? "Failed to create lead");
        }

        appliedSummary = { lead_id: newLead.id, status: newLead.status };
      }
    } else if (kind === "new_activity") {
      const lead = await resolveLead();
      if (!lead) {
        return NextResponse.json(
          { error: "Cannot apply new_activity — no matching lead found" },
          { status: 422 },
        );
      }
      const type = asStr(payload.type) ?? "linkedin_message";
      if (!VALID_ACTIVITY_TYPES.has(type)) {
        return NextResponse.json(
          { error: `Invalid activity type: ${type}` },
          { status: 400 },
        );
      }
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

      const { data: activity, error: actErr } = await supabase
        .from("activities")
        .insert(insert)
        .select("id")
        .single();
      if (actErr || !activity) {
        throw new Error(actErr?.message ?? "Failed to insert activity");
      }

      // Stamp linkedin_thread_id on the lead if we have one and it
      // wasn't recorded yet — the scraper just discovered the thread
      // so future scrapes can match by thread_id directly.
      const leadUpdates: Record<string, unknown> = {
        last_activity_at: new Date().toISOString(),
      };
      if (threadId && !lead.linkedin_thread_id) {
        leadUpdates.linkedin_thread_id = threadId;
      }
      await supabase.from("leads").update(leadUpdates).eq("id", lead.id);

      // Phase 2: refresh the lead's conversation_state now that a new
      // activity has landed. Best-effort — a classifier failure (Haiku
      // down, parse error) must NOT roll back the approved activity.
      // The build plan's literal wording puts this hook in inbox-sync
      // "after each new_activity insert"; in current architecture
      // inbox-sync writes proposals, not activities — so the actual
      // insert happens here. Phase 5 (auto-apply) will add the second
      // call site directly in inbox-sync once routine new_activity
      // proposals start bypassing review_queue.
      let classifyOutcome:
        | { ok: true; conversation_state: string; matched_prompt: boolean }
        | { ok: false; error: string }
        | null = null;
      try {
        const cls = await classifyLead(supabase, lead.id);
        classifyOutcome = {
          ok: true,
          conversation_state: cls.conversation_state,
          matched_prompt: cls.matched_prompt,
        };
      } catch (e: unknown) {
        classifyOutcome = {
          ok: false,
          error: e instanceof Error ? e.message : "classify failed",
        };
      }

      appliedSummary = {
        lead_id: lead.id,
        activity_id: activity.id,
        classify: classifyOutcome,
      };
    } else if (kind === "stage_change") {
      const lead = await resolveLead();
      if (!lead) {
        return NextResponse.json(
          { error: "Cannot apply stage_change — no matching lead found" },
          { status: 422 },
        );
      }
      const toStatus = asStr(payload.to_status);
      if (!toStatus || !VALID_LEAD_STATUSES.has(toStatus)) {
        return NextResponse.json(
          { error: `Invalid to_status: ${toStatus}` },
          { status: 400 },
        );
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
        // Default: stamp acceptance now for invited→contacted/engaged
        // reconciliations that didn't include an explicit timestamp.
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

      appliedSummary = {
        lead_id: lead.id,
        from_status: lead.status,
        to_status: toStatus,
      };
    } else if (kind === "update_contact") {
      const lead = await resolveLead();
      if (!lead) {
        return NextResponse.json(
          { error: "Cannot apply update_contact — no matching lead found" },
          { status: 422 },
        );
      }
      const rawUpdates =
        (payload.updates as Record<string, unknown> | undefined) ?? payload;
      const allowed = ["email", "phone", "title", "linkedin_url", "first_name", "last_name"];
      const contactUpdates: Record<string, unknown> = {};
      for (const k of allowed) {
        const v = asStr((rawUpdates as Record<string, unknown>)[k]);
        if (v) contactUpdates[k] = v;
      }
      if (Object.keys(contactUpdates).length === 0) {
        return NextResponse.json(
          { error: "update_contact has nothing to update" },
          { status: 400 },
        );
      }
      if (!lead.contact_id) {
        return NextResponse.json(
          { error: "Lead has no linked contact to update" },
          { status: 422 },
        );
      }
      const { error: updErr } = await supabase
        .from("contacts")
        .update(contactUpdates)
        .eq("id", lead.contact_id);
      if (updErr) throw new Error(updErr.message);

      appliedSummary = {
        lead_id: lead.id,
        contact_id: lead.contact_id,
        updated_fields: Object.keys(contactUpdates),
      };
    } else if (kind === "set_wake_up") {
      const lead = await resolveLead();
      if (!lead) {
        return NextResponse.json(
          { error: "Cannot apply set_wake_up — no matching lead found" },
          { status: 422 },
        );
      }
      const wakeAtRaw = payload.wake_up_at;
      let wakeAt: string | null = null;
      if (typeof wakeAtRaw === "string" && wakeAtRaw.trim()) {
        const t = wakeAtRaw.trim();
        const d = /^\d{4}-\d{2}-\d{2}$/.test(t)
          ? new Date(t + "T00:00:00.000Z")
          : new Date(t);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json(
            { error: "wake_up_at is not a valid ISO date/datetime" },
            { status: 400 },
          );
        }
        wakeAt = d.toISOString();
      }
      const reason = asStr(payload.wake_up_reason);
      const { error: updErr } = await supabase
        .from("leads")
        .update({ wake_up_at: wakeAt, wake_up_reason: reason })
        .eq("id", lead.id);
      if (updErr) throw new Error(updErr.message);

      appliedSummary = {
        lead_id: lead.id,
        wake_up_at: wakeAt,
        wake_up_reason: reason,
      };
    } else {
      return NextResponse.json(
        { error: `Unknown kind: ${kind}` },
        { status: 400 },
      );
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Failed to apply change";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  // Mark the row approved.
  const decidedAt = new Date().toISOString();
  const { error: markErr } = await supabase
    .from("review_queue")
    .update({
      status: "approved",
      decided_at: decidedAt,
      decided_by: user.id,
    })
    .eq("id", id);
  if (markErr) {
    return NextResponse.json(
      {
        error: "Change applied but failed to mark row approved: " + markErr.message,
        applied: appliedSummary,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    id,
    kind,
    decided_at: decidedAt,
    applied: appliedSummary,
  });
}
