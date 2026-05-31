import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/inbox-sync/recent — Phase 5 Part B
//
// The "Recently Applied" feed on /portal/today. Returns the last ~20
// activities that the DM-scraper pipeline applied to the CRM via
// /api/inbox-sync (auto-apply) or /api/review-queue/[id]/approve — both
// stamp source = 'dm_inbox_scraper'. Each row carries enough context to
// render a one-line entry plus the lead it landed on, and is reverted
// one-click via DELETE /api/inbox-sync/recent/[id].
//
// Manual Today-page logs (mark-contacted) and the LinkedIn export import
// use other sources, so they never appear here — this feed is strictly
// the automated sync's output.
//
// Auth: cookie session.

export const dynamic = "force-dynamic";

const APPLIED_SOURCE = "dm_inbox_scraper";
const LIMIT = 20;
const PREVIEW_MAX = 140;

function preview(body: string | null, summary: string | null): string {
  const raw = (body || summary || "").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (raw.length <= PREVIEW_MAX) return raw;
  return raw.slice(0, PREVIEW_MAX - 1).trimEnd() + "…";
}

interface ActivityRow {
  id: string;
  created_at: string;
  type: string;
  direction: string | null;
  summary: string | null;
  body: string | null;
  lead: {
    id: string;
    contact: { first_name: string | null; last_name: string | null } | null;
    company: { name: string | null } | null;
  } | null;
}

export async function GET() {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("activities")
    .select(
      `
      id, created_at, type, direction, summary, body,
      lead:leads(id, contact:contacts(first_name, last_name), company:companies(name))
    `,
    )
    .eq("source", APPLIED_SOURCE)
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = ((data ?? []) as unknown as ActivityRow[]).map((a) => {
    const first = a.lead?.contact?.first_name ?? "";
    const last = a.lead?.contact?.last_name ?? "";
    const fullName = `${first} ${last}`.trim();
    return {
      id: a.id,
      created_at: a.created_at,
      type: a.type,
      direction: a.direction,
      preview: preview(a.body, a.summary),
      lead_id: a.lead?.id ?? null,
      lead_name: fullName || "Unknown lead",
      company_name: a.lead?.company?.name ?? null,
    };
  });

  return NextResponse.json({ rows });
}
