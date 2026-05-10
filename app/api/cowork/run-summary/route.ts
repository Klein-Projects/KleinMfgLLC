import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";

// /api/cowork/run-summary — Phase 1.5 follow-up
//
// POST (Bearer auth, COWORK_API_TOKEN): Cowork scheduled tasks
// post a run-completion summary at the end of every run.
// Replaces the Gmail-draft summary email Cowork used to write —
// surfaces in the "Recent Cowork activity" panel on /portal/today.
//
// GET (cookie auth, ?undismissed=1&limit=N): the panel reads this
// every 60s. Newest first, dismissed_at IS NULL when undismissed=1.
//
// Allowlist check on POST: an unknown task_id is rejected loudly
// rather than silently stored, so a typo or rogue task can't pile
// up garbage in the dashboard.

const ALLOWED_TASK_IDS = new Set<string>([
  "klein-sent-invitations-scraper",
  // Phase 2 will add: "klein-dm-inbox-scraper"
  // Phase 3 will add: "klein-deep-historical-sweep", "klein-weekly-digest"
]);

const VALID_RUN_MODES = new Set(["dry_run", "live"]);

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function POST(req: NextRequest) {
  // ── Auth ──
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

  // ── Parse / validate ──
  const body = await req.json().catch(() => ({}));
  const taskId = typeof body?.task_id === "string" ? body.task_id.trim() : "";
  const runCount =
    typeof body?.run_count === "number" && Number.isFinite(body.run_count)
      ? Math.trunc(body.run_count)
      : null;
  const runMode = typeof body?.run_mode === "string" ? body.run_mode.trim() : "";
  const observedAt =
    typeof body?.observed_at === "string" ? body.observed_at.trim() : "";
  const summary =
    body?.summary && typeof body.summary === "object" && !Array.isArray(body.summary)
      ? body.summary
      : null;

  if (!taskId) {
    return NextResponse.json(
      { error: "task_id is required" },
      { status: 400 },
    );
  }
  if (!ALLOWED_TASK_IDS.has(taskId)) {
    return NextResponse.json(
      {
        error: `task_id '${taskId}' is not in the allowlist`,
        allowed: Array.from(ALLOWED_TASK_IDS),
      },
      { status: 400 },
    );
  }
  if (runCount === null || runCount < 0) {
    return NextResponse.json(
      { error: "run_count must be a non-negative integer" },
      { status: 400 },
    );
  }
  if (!VALID_RUN_MODES.has(runMode)) {
    return NextResponse.json(
      { error: "run_mode must be 'dry_run' or 'live'" },
      { status: 400 },
    );
  }
  if (!observedAt) {
    return NextResponse.json(
      { error: "observed_at is required (ISO datetime)" },
      { status: 400 },
    );
  }
  if (!summary) {
    return NextResponse.json(
      { error: "summary must be a JSON object" },
      { status: 400 },
    );
  }

  // ── Insert ──
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (Supabase env vars missing)" },
      { status: 500 },
    );
  }
  const supabase = createServiceClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase
    .from("cowork_run_summaries")
    .insert({
      task_id: taskId,
      run_count: runCount,
      run_mode: runMode,
      observed_at: observedAt,
      summary,
    })
    .select("id, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to insert run summary" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: data.id, created_at: data.created_at });
}

export async function GET(req: NextRequest) {
  // ── Auth (cookie session) ──
  const supabase = createCookieClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const undismissedOnly = url.searchParams.get("undismissed") === "1";
  const limitRaw = parseInt(url.searchParams.get("limit") ?? "20", 10);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0
      ? Math.min(limitRaw, 100)
      : 20;

  let query = supabase
    .from("cowork_run_summaries")
    .select("id, task_id, run_count, run_mode, observed_at, summary, created_at, dismissed_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (undismissedOnly) {
    query = query.is("dismissed_at", null);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ rows: data ?? [] });
}
