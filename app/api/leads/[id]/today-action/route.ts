import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/leads/:id/today-action — Phase 1 Today flow secondaries
//
// Body: { action: "snooze_3_days" | "skip_today" | "mark_not_interested"
//                 | "undo" }
//        For undo, also pass the undo context returned by the original
//        action (mark-contacted, snooze, skip, or mark-not-interested).
//
// Auth: cookie session.

type SnoozeAction = { action: "snooze_3_days" };
type SkipAction = { action: "skip_today" };
type MarkNotInterestedAction = { action: "mark_not_interested" };
type UndoAction = {
  action: "undo";
  undo:
    | {
        kind: "mark_contacted";
        activity_id: string;
        prev_status: string;
        prev_follow_up_date: string | null;
        prev_last_activity_at: string | null;
      }
    | {
        kind: "snooze_3_days" | "skip_today";
        prev_follow_up_date: string | null;
      }
    | {
        kind: "mark_not_interested";
        prev_status: string;
      };
};

type RequestBody =
  | SnoozeAction
  | SkipAction
  | MarkNotInterestedAction
  | UndoAction;

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

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.action === "undo") {
    return handleUndo(supabase, leadId, body.undo);
  }

  // Fetch current state for undo context.
  const { data: lead, error: fetchErr } = await supabase
    .from("leads")
    .select("status, follow_up_date")
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

  if (body.action === "snooze_3_days") {
    const base = prevFollowUpDate ? new Date(prevFollowUpDate) : new Date();
    base.setDate(base.getDate() + 3);
    const next = base.toISOString().split("T")[0];

    const { error } = await supabase
      .from("leads")
      .update({ follow_up_date: next })
      .eq("id", leadId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      new_follow_up_date: next,
      undo: {
        kind: "snooze_3_days",
        lead_id: leadId,
        prev_follow_up_date: prevFollowUpDate,
      },
    });
  }

  if (body.action === "skip_today") {
    const next = new Date();
    next.setDate(next.getDate() + 1);
    const nextISO = next.toISOString().split("T")[0];

    const { error } = await supabase
      .from("leads")
      .update({ follow_up_date: nextISO })
      .eq("id", leadId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      new_follow_up_date: nextISO,
      undo: {
        kind: "skip_today",
        lead_id: leadId,
        prev_follow_up_date: prevFollowUpDate,
      },
    });
  }

  if (body.action === "mark_not_interested") {
    const { error } = await supabase
      .from("leads")
      .update({ status: "lost" })
      .eq("id", leadId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      new_status: "lost",
      undo: {
        kind: "mark_not_interested",
        lead_id: leadId,
        prev_status: prevStatus,
      },
    });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

async function handleUndo(
  supabase: ReturnType<typeof createClient>,
  leadId: string,
  undo: UndoAction["undo"],
) {
  if (undo.kind === "mark_contacted") {
    const { error: delErr } = await supabase
      .from("activities")
      .delete()
      .eq("id", undo.activity_id);
    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }

    const restore: Record<string, unknown> = {
      status: undo.prev_status,
      follow_up_date: undo.prev_follow_up_date,
    };
    if (undo.prev_last_activity_at !== null) {
      restore.last_activity_at = undo.prev_last_activity_at;
    }

    const { error: updErr } = await supabase
      .from("leads")
      .update(restore)
      .eq("id", leadId);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, undone: "mark_contacted" });
  }

  if (undo.kind === "snooze_3_days" || undo.kind === "skip_today") {
    const { error } = await supabase
      .from("leads")
      .update({ follow_up_date: undo.prev_follow_up_date })
      .eq("id", leadId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, undone: undo.kind });
  }

  if (undo.kind === "mark_not_interested") {
    const { error } = await supabase
      .from("leads")
      .update({ status: undo.prev_status })
      .eq("id", leadId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, undone: "mark_not_interested" });
  }

  return NextResponse.json({ error: "Unknown undo kind" }, { status: 400 });
}
