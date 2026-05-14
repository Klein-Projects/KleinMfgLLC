import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/leads/:id/mark-contacted — Phase 1 Step 3 (cadence-driven)
//
// Body: {
//   rule_id:           uuid,                 // which cadence rule fired
//   prompt_id:         uuid | null,
//   channel:           "linkedin" | "email" | "phone",
//   action_on_send:    "none" | "mark_lost",
//   auto_log_summary?: string,
//   sent_at?:          string                // ISO date (YYYY-MM-DD) or ISO
//                                            // datetime. Used to backdate
//                                            // both the activity row and
//                                            // lead.last_activity_at when
//                                            // Sean is catching the portal
//                                            // up on a message he sent
//                                            // off-platform days/weeks ago.
//                                            // Must not be in the future.
//                                            // Defaults to now() when omitted.
// }
//
// Effect:
//   - Inserts an activity (type derived from channel; direction=outbound;
//     prompt_id linked; created_at = sent_at or now()).
//   - Sets leads.last_activity_at = sent_at or now() so the cadence engine
//     measures the next rule's window from when the message actually went
//     out, not from when the row got logged.
//   - If action_on_send === "mark_lost", advances lead.status to "lost".
//   - Does NOT bump follow_up_date — the cadence engine drives the queue
//     now; follow_up_date is only a fallback for legacy paths.
//
// Returns undo context the client uses to power the 8s Undo toast.
//
// Auth: cookie session.

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const leadId = params.id;
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const ruleId: string | null = body?.rule_id ?? null;
  const promptId: string | null = body?.prompt_id ?? null;
  const channel: string = body?.channel ?? "linkedin";
  const actionOnSend: string =
    body?.action_on_send === "mark_lost" ? "mark_lost" : "none";
  const summary: string =
    typeof body?.auto_log_summary === "string" && body.auto_log_summary.trim()
      ? body.auto_log_summary.trim()
      : "Sent follow-up via Today page";

  // Optional backdating: sent_at lets Sean log a message he sent off-portal
  // weeks ago so the cadence engine measures the next rule from then,
  // not from the click moment.
  let sentAtISO: string | null = null;
  const sentAtRaw = typeof body?.sent_at === "string" ? body.sent_at.trim() : "";
  if (sentAtRaw) {
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(sentAtRaw)
      ? new Date(sentAtRaw + "T12:00:00Z") // noon UTC for date-only input
      : new Date(sentAtRaw);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json(
        { error: "sent_at is not a valid ISO date" },
        { status: 400 },
      );
    }
    // Tolerance: allow up to 1 day in the future to absorb timezone slop.
    if (parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
      return NextResponse.json(
        { error: "sent_at cannot be in the future" },
        { status: 400 },
      );
    }
    sentAtISO = parsed.toISOString();
  }
  const effectiveTimestamp = sentAtISO ?? new Date().toISOString();

  const { data: lead, error: fetchErr } = await supabase
    .from("leads")
    .select("status, follow_up_date, last_activity_at")
    .eq("id", leadId)
    .single();

  if (fetchErr || !lead) {
    return NextResponse.json(
      { error: fetchErr?.message ?? "Lead not found" },
      { status: 404 },
    );
  }

  const prevStatus = lead.status as string;
  const prevFollowUpDate = (lead.follow_up_date as string | null) ?? null;
  const prevLastActivityAt =
    (lead.last_activity_at as string | null) ?? null;

  const activityType =
    channel === "email"
      ? "email"
      : channel === "phone"
        ? "phone"
        : "linkedin_message";

  const activityInsert: Record<string, unknown> = {
    lead_id: leadId,
    type: activityType,
    summary,
    prompt_id: promptId,
    direction: "outbound",
  };
  if (sentAtISO) {
    activityInsert.created_at = sentAtISO;
  }
  const { data: activity, error: actErr } = await supabase
    .from("activities")
    .insert(activityInsert)
    .select("id")
    .single();

  if (actErr || !activity) {
    return NextResponse.json(
      { error: actErr?.message ?? "Failed to log activity" },
      { status: 500 },
    );
  }

  const updates: Record<string, unknown> = {
    last_activity_at: effectiveTimestamp,
  };
  let newStatus = prevStatus;
  if (actionOnSend === "mark_lost") {
    updates.status = "lost";
    newStatus = "lost";
  }

  const { error: updErr } = await supabase
    .from("leads")
    .update(updates)
    .eq("id", leadId);

  if (updErr) {
    // Best-effort cleanup of the orphaned activity row.
    await supabase.from("activities").delete().eq("id", activity.id);
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    new_status: newStatus,
    rule_id: ruleId,
    undo: {
      kind: "mark_contacted",
      lead_id: leadId,
      activity_id: activity.id,
      prev_status: prevStatus,
      prev_follow_up_date: prevFollowUpDate,
      prev_last_activity_at: prevLastActivityAt,
    },
  });
}
