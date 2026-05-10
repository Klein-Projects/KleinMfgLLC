import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/cowork/trigger-sync?task=sent-invitations  — Phase 1.5
// POST /api/cowork/trigger-sync?task=dm-inbox          — Phase 2 (placeholder)
//
// Fires a Cowork scraper task on demand. Backed by a per-task webhook URL
// stored in Vercel env vars; Cowork shares this URL when it builds each
// task. The portal is the only authorized caller.
//
// Auth: cookie session (Sean from /portal/settings/sync, etc.).
//
// Returns 202 with { run_id, task, fired_at } on success. The run_id is
// whatever Cowork returns in its webhook response body; the portal does
// not generate one. If the env var for the requested task is unset, the
// route returns 503 with a "not configured" payload so the UI can render
// a "task not yet wired up by Cowork" disabled state without a 500.

const TASK_ENV_MAP: Record<string, string> = {
  "sent-invitations": "COWORK_TRIGGER_SENT_INVITATIONS_URL",
  "dm-inbox": "COWORK_TRIGGER_DM_INBOX_URL",
};

export async function POST(req: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const task = new URL(req.url).searchParams.get("task");
  if (!task || !TASK_ENV_MAP[task]) {
    return NextResponse.json(
      {
        error:
          "task is required (one of: " +
          Object.keys(TASK_ENV_MAP).join(", ") +
          ")",
      },
      { status: 400 },
    );
  }

  const envName = TASK_ENV_MAP[task];
  const webhookUrl = process.env[envName];
  if (!webhookUrl) {
    return NextResponse.json(
      {
        error: "task_not_configured",
        message: `Cowork has not provided a webhook URL for this task yet (expected env var ${envName}).`,
        task,
      },
      { status: 503 },
    );
  }

  // Optional: forward a small auth header so Cowork can prove the trigger
  // came from the portal. Reuses COWORK_API_TOKEN — Cowork's task is the
  // intended audience for both directions.
  const sharedToken = process.env.COWORK_API_TOKEN;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (sharedToken) headers["Authorization"] = `Bearer ${sharedToken}`;

  const firedAt = new Date().toISOString();

  let resp: Response;
  try {
    resp = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ source: "portal_sync_button", fired_at: firedAt, task }),
      // Cowork tasks may take a moment to ack — give them up to 15s.
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "trigger_failed",
        message:
          err instanceof Error ? err.message : "Failed to reach Cowork webhook",
        task,
      },
      { status: 502 },
    );
  }

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    return NextResponse.json(
      {
        error: "trigger_failed",
        message: `Cowork webhook returned ${resp.status}`,
        body: text.slice(0, 500),
        task,
      },
      { status: 502 },
    );
  }

  // Try to read a JSON ack with run_id, but don't fail the trigger if Cowork
  // returns plain text or an empty 200.
  let runId: string | null = null;
  try {
    const ackText = await resp.text();
    if (ackText) {
      try {
        const ack = JSON.parse(ackText) as Record<string, unknown>;
        if (typeof ack?.run_id === "string") runId = ack.run_id;
      } catch {
        /* ignore non-JSON */
      }
    }
  } catch {
    /* ignore */
  }

  return NextResponse.json(
    { ok: true, task, run_id: runId, fired_at: firedAt },
    { status: 202 },
  );
}
