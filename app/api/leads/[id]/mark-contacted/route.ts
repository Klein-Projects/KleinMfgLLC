import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/leads/:id/mark-contacted — Phase 1 Today flow
//
// Logs an outbound message activity, bumps follow_up_date out 7 days,
// and (when status was `new`) auto-progresses to `contacted`. Returns
// undo context the client uses to reverse the action within 8s.
//
// Auth: cookie session (single-user portal). The Cowork-facing
// GET /api/today-queue uses Bearer token instead — that endpoint
// lands in Step 4.

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
  const promptId: string | null = body?.prompt_id ?? null;
  const channel: string = body?.channel ?? "linkedin";
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
    })
    .select("id")
    .single();

  if (actErr || !activity) {
    return NextResponse.json(
      { error: actErr?.message ?? "Failed to log activity" },
      { status: 500 },
    );
  }

  // Bump follow_up_date by 7 days from today (NY).
  const newFollowUp = new Date();
  newFollowUp.setDate(newFollowUp.getDate() + 7);
  const newFollowUpISO = newFollowUp.toISOString().split("T")[0];

  const updates: Record<string, unknown> = {
    follow_up_date: newFollowUpISO,
    last_activity_at: new Date().toISOString(),
  };

  let newStatus = prevStatus;
  if (prevStatus === "new") {
    updates.status = "contacted";
    newStatus = "contacted";
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
    new_follow_up_date: newFollowUpISO,
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
