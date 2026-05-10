import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/review-queue/:id/reject — Phase 2
//
// Marks a pending review_queue row status='rejected' with no side
// effects on production tables. Sean clicks Reject from
// /portal/review-queue when the scraper got it wrong (recruiter spam,
// duplicate, mis-classification).
//
// Idempotency: re-rejecting an already-decided row returns 409.
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

  const { data: row, error: fetchErr } = await supabase
    .from("review_queue")
    .select("id, kind, status, decided_at, decided_by")
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

  const decidedAt = new Date().toISOString();
  const { error: updErr } = await supabase
    .from("review_queue")
    .update({
      status: "rejected",
      decided_at: decidedAt,
      decided_by: user.id,
    })
    .eq("id", id);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    id,
    kind: row.kind,
    decided_at: decidedAt,
  });
}
