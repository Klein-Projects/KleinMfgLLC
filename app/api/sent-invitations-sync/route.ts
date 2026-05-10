import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// POST /api/sent-invitations-sync — Phase 1.5
//
// Cowork-facing write endpoint. Hit by the 10pm Pacific
// sent-invitations scraper task with a batch of still-pending sent
// invitations parsed from linkedin.com/mynetwork/invitation-manager/sent/.
//
// Body: {
//   observed_at:   string (ISO datetime), // when the scrape ran
//   invitations: [
//     {
//       linkedin_url:        string,
//       name:                string,
//       headline?:           string | null,
//       sent_relative?:      string | null,   // "3 days ago"
//       sent_date_estimate?: string | null,   // ISO date the scraper inferred
//     },
//     ...
//   ]
// }
//
// Effect: for each invitation,
//   1. If a lead with linkedin_url=X already exists with status='invited',
//      skip (the portal-side log-invitation already captured it).
//   2. If a pending review_queue row already exists for this URL, skip
//      (dedupe across consecutive scrape runs).
//   3. Otherwise insert review_queue { kind='new_lead', source=
//      'sent_invitations_scraper', payload prefilled with the scraped
//      fields and proposed status='invited' } — Phase 2's review-queue UI
//      will surface it for Sean's approval.
//
// Auth: Bearer token (COWORK_API_TOKEN env var). Service-role Supabase
// client; bypasses RLS.
//
// Returns 200 with { observed_at, total, inserted, skipped: { existing_lead,
// existing_proposal }, inserted_ids[] }.

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

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

interface InvitationInput {
  linkedin_url: string;
  name: string;
  headline?: string | null;
  sent_relative?: string | null;
  sent_date_estimate?: string | null;
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
  const observedAt: string | undefined =
    typeof body?.observed_at === "string" ? body.observed_at : undefined;
  const rawInvitations = Array.isArray(body?.invitations)
    ? (body.invitations as unknown[])
    : null;

  if (!observedAt) {
    return NextResponse.json(
      { error: "observed_at is required (ISO datetime)" },
      { status: 400 },
    );
  }
  if (!rawInvitations) {
    return NextResponse.json(
      { error: "invitations[] is required" },
      { status: 400 },
    );
  }

  const invitations: InvitationInput[] = [];
  const validationErrors: { index: number; error: string }[] = [];
  rawInvitations.forEach((inv, i) => {
    const o = inv as Record<string, unknown>;
    const url = typeof o?.linkedin_url === "string" ? o.linkedin_url : "";
    const name = typeof o?.name === "string" ? o.name : "";
    if (!url || !url.toLowerCase().includes("linkedin.com")) {
      validationErrors.push({ index: i, error: "missing or invalid linkedin_url" });
      return;
    }
    if (!name.trim()) {
      validationErrors.push({ index: i, error: "missing name" });
      return;
    }
    invitations.push({
      linkedin_url: normalizeLinkedinUrl(url),
      name: name.trim(),
      headline:
        typeof o?.headline === "string" ? o.headline.trim() || null : null,
      sent_relative:
        typeof o?.sent_relative === "string"
          ? o.sent_relative.trim() || null
          : null,
      sent_date_estimate:
        typeof o?.sent_date_estimate === "string"
          ? o.sent_date_estimate.trim() || null
          : null,
    });
  });

  if (validationErrors.length > 0) {
    return NextResponse.json(
      { error: "validation failed", details: validationErrors },
      { status: 400 },
    );
  }

  // ── Supabase service client ──
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

  if (invitations.length === 0) {
    return NextResponse.json({
      observed_at: observedAt,
      total: 0,
      inserted: 0,
      skipped: { existing_lead: 0, existing_proposal: 0 },
      inserted_ids: [],
    });
  }

  const urls = invitations.map((i) => i.linkedin_url);

  // Skip-list 1: leads already in status='invited' for these URLs (lead-level).
  const { data: existingLeads, error: leadsErr } = await supabase
    .from("leads")
    .select("linkedin_url")
    .in("linkedin_url", urls)
    .eq("status", "invited");
  if (leadsErr) {
    return NextResponse.json({ error: leadsErr.message }, { status: 500 });
  }
  const existingLeadUrls = new Set(
    (existingLeads ?? []).map((l) => l.linkedin_url as string),
  );

  // Skip-list 1b: leads invited via the contact's linkedin_url (contact-level).
  const { data: existingContacts, error: contactsErr } = await supabase
    .from("contacts")
    .select("linkedin_url, leads:leads(status)")
    .in("linkedin_url", urls);
  if (contactsErr) {
    return NextResponse.json({ error: contactsErr.message }, { status: 500 });
  }
  for (const row of (existingContacts ?? []) as Array<{
    linkedin_url: string;
    leads: Array<{ status: string }>;
  }>) {
    const status = row.leads?.[0]?.status;
    if (status === "invited") existingLeadUrls.add(row.linkedin_url);
  }

  // Skip-list 2: pending review_queue rows already proposing these URLs.
  const { data: existingProposals, error: rqErr } = await supabase
    .from("review_queue")
    .select("payload")
    .eq("status", "pending")
    .in("payload->>linkedin_url", urls);
  // The Postgrest `.in()` over a JSON arrow expression isn't always supported
  // by older clients; if it errors, fall back to a manual check using the
  // functional index we created in the migration.
  let existingProposalUrls = new Set<string>();
  if (rqErr) {
    const { data: fallback, error: fbErr } = await supabase
      .from("review_queue")
      .select("payload")
      .eq("status", "pending")
      .filter("source", "eq", "sent_invitations_scraper");
    if (fbErr) {
      return NextResponse.json({ error: fbErr.message }, { status: 500 });
    }
    for (const r of (fallback ?? []) as Array<{ payload: any }>) {
      const u = r.payload?.linkedin_url;
      if (typeof u === "string") existingProposalUrls.add(u);
    }
  } else {
    for (const r of (existingProposals ?? []) as Array<{ payload: any }>) {
      const u = r.payload?.linkedin_url;
      if (typeof u === "string") existingProposalUrls.add(u);
    }
  }

  // Build insert rows.
  const rows: Array<Record<string, unknown>> = [];
  let skippedExistingLead = 0;
  let skippedExistingProposal = 0;
  for (const inv of invitations) {
    if (existingLeadUrls.has(inv.linkedin_url)) {
      skippedExistingLead++;
      continue;
    }
    if (existingProposalUrls.has(inv.linkedin_url)) {
      skippedExistingProposal++;
      continue;
    }
    rows.push({
      kind: "new_lead",
      source: "sent_invitations_scraper",
      payload: {
        linkedin_url: inv.linkedin_url,
        name: inv.name,
        headline: inv.headline,
        sent_relative: inv.sent_relative,
        sent_date_estimate: inv.sent_date_estimate,
        observed_at: observedAt,
        proposed_status: "invited",
      },
    });
  }

  let insertedIds: string[] = [];
  if (rows.length > 0) {
    const { data: inserted, error: insErr } = await supabase
      .from("review_queue")
      .insert(rows)
      .select("id");
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 });
    }
    insertedIds = (inserted ?? []).map((r) => r.id as string);
  }

  return NextResponse.json({
    observed_at: observedAt,
    total: invitations.length,
    inserted: insertedIds.length,
    skipped: {
      existing_lead: skippedExistingLead,
      existing_proposal: skippedExistingProposal,
    },
    inserted_ids: insertedIds,
  });
}
