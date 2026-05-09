import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/leads/:id/linkedin-url
//
// Body: { linkedin_url: string | null }
//
// Writes the URL to BOTH leads.linkedin_url and contacts.linkedin_url
// (when the lead has a contact). Two cheap updates so the cadence
// engine, the lead detail Contact card, and the Phase 3 backfill all
// see the value regardless of which column they query.
//
// Used by the "Add LinkedIn URL" paste modal on /portal/today cards.

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const leadId = params.id;
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const raw = body?.linkedin_url;
  let linkedinUrl: string | null = null;

  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    const trimmed = String(raw).trim();
    // Lightweight validation: must look like a URL pointing at LinkedIn.
    // Sean is the only writer; we just want to catch obvious paste typos.
    const lower = trimmed.toLowerCase();
    if (!lower.startsWith("http://") && !lower.startsWith("https://")) {
      return NextResponse.json(
        { error: "URL must start with https:// (or http://)" },
        { status: 400 },
      );
    }
    if (!lower.includes("linkedin.com")) {
      return NextResponse.json(
        { error: "URL doesn't look like a LinkedIn link (no linkedin.com)" },
        { status: 400 },
      );
    }
    linkedinUrl = trimmed;
  }

  const { data: lead, error: fetchErr } = await supabase
    .from("leads")
    .select("id, contact_id")
    .eq("id", leadId)
    .single();

  if (fetchErr || !lead) {
    return NextResponse.json(
      { error: fetchErr?.message ?? "Lead not found" },
      { status: 404 },
    );
  }

  const { error: leadErr } = await supabase
    .from("leads")
    .update({ linkedin_url: linkedinUrl })
    .eq("id", leadId);
  if (leadErr) {
    return NextResponse.json({ error: leadErr.message }, { status: 500 });
  }

  if (lead.contact_id) {
    const { error: contactErr } = await supabase
      .from("contacts")
      .update({ linkedin_url: linkedinUrl })
      .eq("id", lead.contact_id);
    if (contactErr) {
      // Roll back lead-level write so we don't leave the two columns
      // inconsistent.
      await supabase
        .from("leads")
        .update({ linkedin_url: null })
        .eq("id", leadId);
      return NextResponse.json(
        { error: contactErr.message },
        { status: 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, linkedin_url: linkedinUrl });
}
