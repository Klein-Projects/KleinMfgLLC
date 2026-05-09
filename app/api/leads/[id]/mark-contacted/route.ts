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
// }
//
// Effect:
//   - Inserts an activity (type derived from channel; direction=outbound;
//     prompt_id linked).
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

  const { data: activity, error: actErr } = await supabase
    .from("activities")
    .insert({
      lead_id: leadId,
      type: activityType,
      summary,
      prompt_id: promptId,
      direction: "outbound",
    })
    .select("id")
    .single();

  if (actErr || !activity) {
    return NextResponse.json(
      { error: actErr?.message ?? "Failed to log activity" },
      { status: 500 },
    );
  }

  const updates: Record<string, unknown> = {
    last_activity_at: new Date().toISOString(),
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
