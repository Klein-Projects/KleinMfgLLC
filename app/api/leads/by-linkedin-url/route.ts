import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/leads/by-linkedin-url?url=<encoded> — Phase 1.5 supporting endpoint
//
// Used by /portal/outreach for client-side dedupe. Looks up a lead by
// LinkedIn URL (lead-level OR via the contact). Returns the lead summary
// and a hint on whether it's currently in status='invited' so the page
// can render the "already invited" warning chip.
//
// Response 200: { found: bool, lead?: { id, status, invited_at, name, company } }
// Response 200: { found: false } when no match.
//
// Auth: cookie session.

function normalizeLinkedinUrl(raw: string): string {
  let s = raw.trim();
  if (s.endsWith("/")) s = s.slice(0, -1);
  try {
    const u = new URL(s);
    u.hostname = u.hostname.toLowerCase();
    let out = u.toString();
    if (out.endsWith("/")) out = out.slice(0, -1);
    return out;
  } catch {
    return s;
  }
}

export async function GET(req: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const urlParam = new URL(req.url).searchParams.get("url");
  if (!urlParam) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }
  const lower = urlParam.toLowerCase();
  if (
    (!lower.startsWith("http://") && !lower.startsWith("https://")) ||
    !lower.includes("linkedin.com")
  ) {
    return NextResponse.json(
      { error: "url must be a LinkedIn URL" },
      { status: 400 },
    );
  }
  const normalized = normalizeLinkedinUrl(urlParam);

  const [byLeadRes, byContactRes] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id, status, invited_at, " +
          "contact:contacts(first_name, last_name), " +
          "company:companies(name)",
      )
      .eq("linkedin_url", normalized)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, " +
          "leads:leads(id, status, invited_at, company:companies(name))",
      )
      .eq("linkedin_url", normalized)
      .limit(1)
      .maybeSingle(),
  ]);

  let lead: {
    id: string;
    status: string;
    invited_at: string | null;
    name: string;
    company: string | null;
  } | null = null;

  if (byLeadRes.data) {
    const r = byLeadRes.data as any;
    const fn = r.contact?.first_name ?? "";
    const ln = r.contact?.last_name ?? "";
    lead = {
      id: r.id,
      status: r.status,
      invited_at: r.invited_at,
      name: `${fn} ${ln}`.trim() || "Unknown",
      company: r.company?.name ?? null,
    };
  } else if (byContactRes.data) {
    const r = byContactRes.data as any;
    const linked = Array.isArray(r.leads) ? r.leads[0] : r.leads;
    if (linked) {
      lead = {
        id: linked.id,
        status: linked.status,
        invited_at: linked.invited_at,
        name: `${r.first_name ?? ""} ${r.last_name ?? ""}`.trim() || "Unknown",
        company: linked.company?.name ?? null,
      };
    }
  }

  if (!lead) {
    return NextResponse.json({ found: false });
  }
  return NextResponse.json({ found: true, lead });
}
