import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// DELETE /api/inbox-sync/recent/[id] — Phase 5 Part B
//
// One-click Undo for a sync-applied activity. Reverts the insert that
// /api/inbox-sync (auto-apply) or the review-queue approve path made:
//
//   1. Delete the activities row (guarded to source = 'dm_inbox_scraper'
//      so this endpoint can never delete a manual log or an imported
//      historical activity).
//   2. Re-derive the lead's last_activity_at from its remaining
//      activities — the auto-apply bumped it to the insert time, so we
//      roll it back to the next-most-recent activity (or NULL if none
//      remain) to keep the cadence/Today views consistent.
//
// The classifier's conversation_state is NOT re-run here — it will be
// re-derived on the next sync. linkedin_thread_id (if the apply set it)
// is left in place; we can't know whether it pre-existed.
//
// Auth: cookie session.

const APPLIED_SOURCE = "dm_inbox_scraper";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const activityId = params.id;
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch the target activity and verify it's a sync-applied row.
  const { data: activity, error: fetchErr } = await supabase
    .from("activities")
    .select("id, lead_id, source")
    .eq("id", activityId)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  if (activity.source !== APPLIED_SOURCE) {
    return NextResponse.json(
      { error: "Only sync-applied activities can be undone here" },
      { status: 403 },
    );
  }

  const leadId = activity.lead_id as string | null;

  const { error: delErr } = await supabase
    .from("activities")
    .delete()
    .eq("id", activityId)
    .eq("source", APPLIED_SOURCE);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }

  // Roll lead.last_activity_at back to the next-most-recent remaining
  // activity for this lead (best-effort — failure here doesn't fail the
  // undo, the row is already gone).
  if (leadId) {
    const { data: latest } = await supabase
      .from("activities")
      .select("created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    await supabase
      .from("leads")
      .update({ last_activity_at: latest?.created_at ?? null })
      .eq("id", leadId);
  }

  return NextResponse.json({ ok: true, id: activityId, lead_id: leadId });
}
