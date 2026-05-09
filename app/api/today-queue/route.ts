import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchContractQueue } from "@/lib/portal/today-queue";

// GET /api/today-queue — Phase 1 Step 4
//
// Cowork-facing read endpoint. Same engine that powers /portal/today,
// reshaped to the API contract in docs/api.md.
//
// Auth: Bearer token (COWORK_API_TOKEN env var). The 3pm digest task,
// the 10pm sent-invitations task, and any future Cowork task that
// needs to peek at the queue all share this token. Session cookies do
// NOT grant access — this route is for service-to-service only.
//
// Query params:
//   date    — ISO date (YYYY-MM-DD), defaults to today in
//             America/New_York.
//   limit   — int, default 25, capped at 100.

const FALLBACK_BASE_URL = "https://kleinmfgllc.com";

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function parseLimit(raw: string | null): number {
  if (!raw) return 25;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 25;
  return Math.min(Math.floor(n), 100);
}

function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !Number.isNaN(d.getTime());
}

export async function GET(req: NextRequest) {
  // ── Auth ──
  const expected = process.env.COWORK_API_TOKEN;
  if (!expected) {
    // Fail closed — refuse to serve when the token isn't configured so a
    // missing env var doesn't accidentally publish the queue.
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

  // ── Params ──
  const url = new URL(req.url);
  const dateParam = url.searchParams.get("date");
  const limitParam = url.searchParams.get("limit");

  let todayISO: string | undefined;
  if (dateParam) {
    if (!isValidISODate(dateParam)) {
      return NextResponse.json(
        { error: 'date must be ISO YYYY-MM-DD' },
        { status: 400 },
      );
    }
    todayISO = dateParam;
  }

  const limit = parseLimit(limitParam);

  // ── Supabase (service role; bypasses RLS) ──
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (Supabase env vars missing)" },
      { status: 500 },
    );
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Build queue ──
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? FALLBACK_BASE_URL;

  try {
    const result = await fetchContractQueue(supabase, {
      todayISO,
      limit,
      baseUrl,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Internal error" },
      { status: 500 },
    );
  }
}
