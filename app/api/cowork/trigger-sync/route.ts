import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/cowork/trigger-sync?task=sent-invitations  (Phase 1.5)
// POST /api/cowork/trigger-sync?task=dm-inbox          (Phase 2)
//
// Fires a Cowork scraper on demand. Implementation: writes a row to
// the sync_triggers table with fire_status='queued'. The
// klein-sync-poller scheduled task on Cowork polls the table every
// ~5 minutes, claims queued rows, runs the matching scrape inline,
// and writes back fire_status. Latency between click and scrape
// start is up to ~5 minutes, which is fine for an on-demand button.
//
// Replaces the original webhook-URL design (COWORK_TRIGGER_*_URL)
// which was never wired up because Cowork does not expose public
// webhook endpoints.
//
// Auth: cookie session (Sean from /portal/settings/sync, etc.).
// Returns 202 with { trigger_id, task, queued_at, message }.

const VALID_TASKS = new Set(["sent-invitations", "dm-inbox"]);

// Cooldown: refuse to queue more than one trigger for the same task
// within this window. Stops accidental double-clicks from spamming
// the poller.
const COOLDOWN_SECONDS = 60;

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const task = new URL(req.url).searchParams.get("task");
  if (!task || !VALID_TASKS.has(task)) {
    return NextResponse.json(
      {
        error:
          "task is required (one of: " +
          Array.from(VALID_TASKS).join(", ") +
          ")",
      },
      { status: 400 },
    );
  }

  // Cooldown: any recent queued or firing trigger for this task?
  const cutoff = new Date(Date.now() - COOLDOWN_SECONDS * 1000).toISOString();
  const { data: recent } = await supabase
    .from("sync_triggers")
    .select("id, fire_status, requested_at")
    .eq("task_id", task)
    .in("fire_status", ["queued", "firing"])
    .gte("requested_at", cutoff)
    .order("requested_at", { ascending: false })
    .limit(1);

  if (recent && recent.length > 0) {
    return NextResponse.json(
      {
        ok: true,
        already_queued: true,
        trigger_id: recent[0].id,
        task,
        queued_at: recent[0].requested_at,
        message:
          "A sync for this task is already queued. The poller will pick it up within ~5 minutes.",
      },
      { status: 202 },
    );
  }

  const { data: inserted, error } = await supabase
    .from("sync_triggers")
    .insert({
      task_id: task,
      requested_by: user.id,
      fire_status: "queued",
    })
    .select("id, requested_at")
    .single();

  if (error || !inserted) {
    return NextResponse.json(
      {
        error: "queue_failed",
        message: error?.message ?? "Failed to insert sync_triggers row",
        task,
      },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      trigger_id: inserted.id,
      task,
      queued_at: inserted.requested_at,
      message:
        "Queued. The Cowork poller checks every ~5 minutes and will run this scrape on its next tick.",
    },
    { status: 202 },
  );
}

// GET /api/cowork/trigger-sync (cookie auth) — read-only status for
// the Sync page UI. Returns the latest row per task plus queued and
// firing counts so the UI can render "Queued / running soon" or
// "Last run finished N min ago".
export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("sync_triggers")
    .select(
      "id, task_id, fire_status, requested_at, fired_at, finished_at, fire_error",
    )
    .order("requested_at", { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json(
      { error: "read_failed", message: error.message },
      { status: 500 },
    );
  }

  type Row = NonNullable<typeof data>[number];
  const byTask: Record<
    string,
    { latest: Row | null; queuedCount: number; firingCount: number }
  > = {};
  VALID_TASKS.forEach((t) => {
    byTask[t] = { latest: null, queuedCount: 0, firingCount: 0 };
  });
  for (const row of data ?? []) {
    const bucket = byTask[row.task_id];
    if (!bucket) continue;
    if (!bucket.latest) bucket.latest = row;
    if (row.fire_status === "queued") bucket.queuedCount += 1;
    if (row.fire_status === "firing") bucket.firingCount += 1;
  }

  return NextResponse.json({ ok: true, byTask }, { status: 200 });
}
