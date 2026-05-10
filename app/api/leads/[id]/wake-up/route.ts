import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/leads/:id/wake-up — Phase 1.5
//
// Body: {
//   wake_up_at:     string (ISO date or datetime) | null,  // null clears
//   wake_up_reason?: string | null,
// }
//
// Effect: sets leads.wake_up_at and leads.wake_up_reason. While
// wake_up_at > now(), the Today queue (lib/portal/today-queue.ts)
// skips this lead. Pass wake_up_at=null to unpark.
//
// Auth: cookie session.

const REASON_MAX = 240;

function parseWakeUpAt(raw: unknown): string | null | undefined {
  if (raw === null) return null;
  if (raw === undefined) return undefined;
  const s = String(raw).trim();
  if (!s) return null;
  // Accept ISO date (YYYY-MM-DD) → store as midnight UTC, or full ISO.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T00:00:00Z");
    return Number.isNaN(d.getTime()) ? "INVALID" : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "INVALID" : d.toISOString();
}

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
  const wakeUpAt = parseWakeUpAt(body?.wake_up_at);
  if (wakeUpAt === undefined) {
    return NextResponse.json(
      { error: "wake_up_at is required (use null to unpark)" },
      { status: 400 },
    );
  }
  if (wakeUpAt === "INVALID") {
    return NextResponse.json(
      { error: "wake_up_at must be an ISO date (YYYY-MM-DD) or datetime" },
      { status: 400 },
    );
  }

  let reason: string | null = null;
  if (wakeUpAt !== null) {
    const r = body?.wake_up_reason;
    if (r != null) {
      const trimmed = String(r).trim().slice(0, REASON_MAX);
      reason = trimmed || null;
    }
  }
  // When unparking, always clear the reason too.

  const { data: lead, error: fetchErr } = await supabase
    .from("leads")
    .select("id")
    .eq("id", leadId)
    .single();
  if (fetchErr || !lead) {
    return NextResponse.json(
      { error: fetchErr?.message ?? "Lead not found" },
      { status: 404 },
    );
  }

  const { error: updErr } = await supabase
    .from("leads")
    .update({
      wake_up_at: wakeUpAt,
      wake_up_reason: wakeUpAt === null ? null : reason,
    })
    .eq("id", leadId);
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    lead_id: leadId,
    wake_up_at: wakeUpAt,
    wake_up_reason: wakeUpAt === null ? null : reason,
  });
}
