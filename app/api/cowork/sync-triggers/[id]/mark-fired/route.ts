import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// POST /api/cowork/sync-triggers/:id/mark-fired
//
// Bearer auth (COWORK_API_TOKEN). The klein-sync-poller calls this
// to update a trigger's fire_status as it walks through them.
//
// Body shape (all optional except fire_status):
// {
//   fire_status: 'firing' | 'complete' | 'failed',
//   fire_error?: string,
//   run_summary?: object   // arbitrary jsonb the poller can attach
// }
//
// Service-role client; bypasses RLS.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set(["firing", "complete", "failed"]);

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const expected = process.env.COWORK_API_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Server not configured (COWORK_API_TOKEN unset)" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  const token = match ? match[1].trim() : "";
  if (!token || !safeEqualString(token, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const id = params?.id;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json(
      { error: "id must be a uuid" },
      { status: 400 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "body must be JSON" },
      { status: 400 },
    );
  }

  const fire_status = body.fire_status as string | undefined;
  if (!fire_status || !VALID_STATUSES.has(fire_status)) {
    return NextResponse.json(
      {
        error:
          "fire_status must be one of: " + Array.from(VALID_STATUSES).join(", "),
      },
      { status: 400 },
    );
  }

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Server not configured" },
      { status: 500 },
    );
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const update: Record<string, unknown> = { fire_status };
  const now = new Date().toISOString();
  if (fire_status === "firing") update.fired_at = now;
  if (fire_status === "complete" || fire_status === "failed")
    update.finished_at = now;
  if (typeof body.fire_error === "string")
    update.fire_error = body.fire_error.slice(0, 4000);
  if (
    body.run_summary &&
    typeof body.run_summary === "object" &&
    !Array.isArray(body.run_summary)
  ) {
    update.run_summary = body.run_summary;
  }

  const { data, error } = await supabase
    .from("sync_triggers")
    .update(update)
    .eq("id", id)
    .select("id, task_id, fire_status, fired_at, finished_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      {
        error: "update_failed",
        message: error?.message ?? "row not found",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ ok: true, trigger: data }, { status: 200 });
}
