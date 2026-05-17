import { NextRequest, NextResponse } from "next/server";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { classifyLead, ClassifyError } from "@/lib/portal/classify-lead";

// POST /api/leads/:id/classify — Phase 2 Step 1
//
// Runs the Haiku conversation-state classifier against a lead's last
// five activities and persists the result on the lead row:
//   conversation_state, suggested_prompt_id, state_confidence,
//   state_reasoning, state_updated_at
//
// Auth: accepts EITHER a cookie session (portal user) OR a Bearer
// COWORK_API_TOKEN. The Bearer path runs with the service-role client
// so the Cowork backfill script can hit it for every active lead in
// one go without juggling portal sessions.
//
// Body: none (the :id alone is sufficient).
//
// Returns 200 with the classify result on success, 4xx/5xx with
// { error: string } otherwise. ClassifyError carries its own
// httpStatus so model / parse failures surface as 502 instead of 500.

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

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const leadId = params.id;

  // Bearer path → service-role client, bypasses RLS. Used by the
  // Cowork backfill script and any other server-to-server caller.
  const token = bearerToken(req);
  const cowork = process.env.COWORK_API_TOKEN;
  if (token && cowork && safeEqualString(token, cowork)) {
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
    try {
      const result = await classifyLead(supabase, leadId);
      return NextResponse.json(result);
    } catch (e: unknown) {
      if (e instanceof ClassifyError) {
        return NextResponse.json({ error: e.message }, { status: e.httpStatus });
      }
      const msg = e instanceof Error ? e.message : "Classify failed";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  // Cookie session path → portal user.
  const supabase = createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await classifyLead(supabase, leadId);
    return NextResponse.json(result);
  } catch (e: unknown) {
    if (e instanceof ClassifyError) {
      return NextResponse.json({ error: e.message }, { status: e.httpStatus });
    }
    const msg = e instanceof Error ? e.message : "Classify failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
