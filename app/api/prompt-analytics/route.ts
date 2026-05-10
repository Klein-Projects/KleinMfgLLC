import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchPromptAnalytics } from "@/lib/portal/prompt-analytics";

// GET /api/prompt-analytics — Phase 3
//
// Cookie-auth, used by /portal/prompts to render the per-card
// "+X% reply rate" / "+X% accept rate" badges. The full
// /portal/prompts/analytics page calls fetchPromptAnalytics directly
// from its server component — this HTTP endpoint exists only so
// the existing client-rendered prompt library page can stay
// "use client" without a full refactor.
//
// Output shape mirrors PromptAnalyticsResult from the helper.

export async function GET(_req: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await fetchPromptAnalytics(supabase);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to compute analytics";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
