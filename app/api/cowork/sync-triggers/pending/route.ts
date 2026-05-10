import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// GET /api/cowork/sync-triggers/pending
//
// Bearer auth (COWORK_API_TOKEN). The klein-sync-poller scheduled task
// hits this every ~5 min. Returns the queued sync_triggers rows so the
// poller can dispatch the matching scrape inline. Service-role client;
// bypasses RLS.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function GET(req: NextRequest) {
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

  const url =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (Supabase URL or service key unset)" },
      { status: 500 },
    );
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await supabase
    .from("sync_triggers")
    .select("id, task_id, requested_at, requested_by")
    .eq("fire_status", "queued")
    .order("requested_at", { ascending: true })
    .limit(20);

  if (error) {
    return NextResponse.json(
      { error: "read_failed", message: error.message },
      { status: 500 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      observed_at: new Date().toISOString(),
      pending: data ?? [],
    },
    { status: 200 },
  );
}
