import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// GET /api/leads — Phase 2 Step 1 (companion to /api/leads/:id/classify)
//
// Lightweight lead-list endpoint primarily used by the Cowork-side
// Phase 2 Step 2 backfill script (and any other server-to-server
// caller) to enumerate active leads. Returns one row per lead with
// id, status, current conversation_state (so the caller can skip
// already-classified leads if it wants).
//
// Query params:
//   status_not_in=won,lost   — exclude these statuses (CSV)
//   status_in=invited,...    — include only these statuses (CSV)
//   limit=N                  — cap result size (default 1000)
//
// Auth: cookie session OR Bearer COWORK_API_TOKEN.

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function bearerToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return m ? m[1].trim() : null;
}

function parseCsvParam(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function GET(req: NextRequest) {
  // ── Auth ──
  const token = bearerToken(req);
  const cowork = process.env.COWORK_API_TOKEN;
  let supabase;
  if (token && cowork && safeEqualString(token, cowork)) {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceKey) {
      return NextResponse.json(
        { error: "Server not configured (Supabase env vars missing)" },
        { status: 500 },
      );
    }
    supabase = createServiceClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } else {
    supabase = createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // ── Query params ──
  const url = new URL(req.url);
  const statusNotIn = parseCsvParam(url.searchParams.get("status_not_in"));
  const statusIn = parseCsvParam(url.searchParams.get("status_in"));
  const limitRaw = url.searchParams.get("limit");
  let limit = 1000;
  if (limitRaw) {
    const n = Number(limitRaw);
    if (Number.isInteger(n) && n > 0 && n <= 5000) limit = n;
  }

  // ── Build + run query ──
  let q = supabase
    .from("leads")
    .select(
      "id, status, conversation_state, suggested_prompt_id, state_confidence, state_updated_at, last_activity_at",
    )
    .order("last_activity_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (statusIn.length > 0) q = q.in("status", statusIn);
  if (statusNotIn.length > 0) q = q.not("status", "in", `(${statusNotIn.join(",")})`);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    count: (data ?? []).length,
    leads: data ?? [],
  });
}
