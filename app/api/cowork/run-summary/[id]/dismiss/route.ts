import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/cowork/run-summary/:id/dismiss — Phase 1.5 follow-up
//
// Marks a single Cowork run-summary row as dismissed so the
// "Recent Cowork activity" panel on /portal/today stops showing it.
// Sean clicks the × on each row when he's done reading.
//
// Idempotent: dismissing an already-dismissed row returns the
// existing dismissed_at without writing a new value.
//
// Auth: cookie session.

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

  const { data: existing, error: fetchErr } = await supabase
    .from("cowork_run_summaries")
    .select("id, dismissed_at")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) {
    return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json(
      { error: "Run summary not found" },
      { status: 404 },
    );
  }

  if (existing.dismissed_at) {
    return NextResponse.json({
      id: existing.id,
      dismissed_at: existing.dismissed_at,
    });
  }

  const dismissedAt = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("cowork_run_summaries")
    .update({ dismissed_at: dismissedAt, dismissed_by: "sean" })
    .eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({ id, dismissed_at: dismissedAt });
}
