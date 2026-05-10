import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/leads/log-invitation — Phase 1.5
//
// Body: {
//   linkedin_url:  string,           // required, LinkedIn profile URL
//   name:          string,           // required, "First Last"
//   company?:      string | null,    // optional, free-text company name
//   title?:        string | null,    // optional, job title
//   prompt_id:     string,           // required, FK to prompt_templates
//   note_text:     string,           // required, the personalized note Sean sent
//   source?:       string,           // defaults to "outreach_page"
// }
//
// Effect:
//   1. Resolves an existing lead by linkedin_url (lead-level OR contact-level).
//   2. If no match: creates company (if a name is given and one doesn't already
//      exist by exact name match), contact, and lead with status='invited',
//      invited_at=now().
//   3. If match exists: backfills missing contact fields where blank; if lead
//      status='new', advances to 'invited' and stamps invited_at. Status that
//      is already past 'invited' is preserved (we don't regress the funnel).
//   4. Inserts an activity (type='connection_request', prompt_id, summary
//      truncated from note_text, direction='outbound', source='outreach_page').
//
// Returns: { lead_id, status, created: bool, activity_id }
//
// Auth: cookie session.

const SUMMARY_MAX = 240;

// Strip trailing slash, lowercase host for stable dedupe matching.
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

// Last-space split: "John A. Smith" → ["John A.", "Smith"]; single word
// names return null so the caller returns a 400.
function splitName(full: string): { first: string; last: string } | null {
  const trimmed = full.trim();
  const idx = trimmed.lastIndexOf(" ");
  if (idx <= 0) return null;
  const first = trimmed.slice(0, idx).trim();
  const last = trimmed.slice(idx + 1).trim();
  if (!first || !last) return null;
  return { first, last };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}

export async function POST(req: NextRequest) {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // ── Validate ──
  const linkedinUrlRaw = String(body?.linkedin_url ?? "").trim();
  const nameRaw = String(body?.name ?? "").trim();
  const promptId = body?.prompt_id ? String(body.prompt_id) : null;
  const noteText = String(body?.note_text ?? "").trim();
  const company = body?.company ? String(body.company).trim() : null;
  const title = body?.title ? String(body.title).trim() : null;
  const source = body?.source ? String(body.source) : "outreach_page";

  if (!linkedinUrlRaw) {
    return NextResponse.json(
      { error: "linkedin_url is required" },
      { status: 400 },
    );
  }
  const lower = linkedinUrlRaw.toLowerCase();
  if (
    (!lower.startsWith("http://") && !lower.startsWith("https://")) ||
    !lower.includes("linkedin.com")
  ) {
    return NextResponse.json(
      { error: "linkedin_url must be a LinkedIn URL" },
      { status: 400 },
    );
  }
  if (!nameRaw) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const splitNameResult = splitName(nameRaw);
  if (!splitNameResult) {
    return NextResponse.json(
      { error: "name must include both first and last (e.g. 'Jane Smith')" },
      { status: 400 },
    );
  }
  if (!promptId) {
    return NextResponse.json(
      { error: "prompt_id is required" },
      { status: 400 },
    );
  }
  if (!noteText) {
    return NextResponse.json(
      { error: "note_text is required" },
      { status: 400 },
    );
  }

  const linkedinUrl = normalizeLinkedinUrl(linkedinUrlRaw);

  // ── Resolve existing lead by linkedin_url ──
  // Match either leads.linkedin_url directly, or via the contact. The "or"
  // filter form below leans on Postgrest syntax for the lead-level column;
  // we then independently look up by contacts.linkedin_url and merge.
  const [byLeadRes, byContactRes] = await Promise.all([
    supabase
      .from("leads")
      .select(
        "id, status, contact_id, company_id, invited_at, linkedin_url, " +
          "contact:contacts(id, first_name, last_name, title, linkedin_url, company_id)",
      )
      .eq("linkedin_url", linkedinUrl)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("contacts")
      .select(
        "id, first_name, last_name, title, linkedin_url, company_id, " +
          "leads:leads(id, status, contact_id, company_id, invited_at, linkedin_url)",
      )
      .eq("linkedin_url", linkedinUrl)
      .limit(1)
      .maybeSingle(),
  ]);

  type ResolvedLead = {
    id: string;
    status: string;
    contact_id: string | null;
    company_id: string | null;
    invited_at: string | null;
  };

  let existingLead: ResolvedLead | null = null;
  let existingContact:
    | { id: string; first_name: string; last_name: string; title: string | null; company_id: string | null; linkedin_url: string | null }
    | null = null;

  if (byLeadRes.data) {
    const r = byLeadRes.data as any;
    existingLead = {
      id: r.id,
      status: r.status,
      contact_id: r.contact_id,
      company_id: r.company_id,
      invited_at: r.invited_at,
    };
    if (r.contact) {
      existingContact = {
        id: r.contact.id,
        first_name: r.contact.first_name,
        last_name: r.contact.last_name,
        title: r.contact.title,
        company_id: r.contact.company_id,
        linkedin_url: r.contact.linkedin_url,
      };
    }
  } else if (byContactRes.data) {
    const r = byContactRes.data as any;
    existingContact = {
      id: r.id,
      first_name: r.first_name,
      last_name: r.last_name,
      title: r.title,
      company_id: r.company_id,
      linkedin_url: r.linkedin_url,
    };
    const linkedLead = Array.isArray(r.leads) ? r.leads[0] : r.leads;
    if (linkedLead) {
      existingLead = {
        id: linkedLead.id,
        status: linkedLead.status,
        contact_id: linkedLead.contact_id,
        company_id: linkedLead.company_id,
        invited_at: linkedLead.invited_at,
      };
    }
  }

  let leadId: string;
  let leadStatus: string;
  let created: boolean;
  const nowISO = new Date().toISOString();

  if (existingLead) {
    // ── Existing lead path: backfill, optionally advance status ──
    leadId = existingLead.id;
    created = false;

    const leadUpdates: Record<string, unknown> = {
      last_activity_at: nowISO,
    };
    if (existingLead.status === "new") {
      leadUpdates.status = "invited";
      leadUpdates.invited_at = nowISO;
      leadStatus = "invited";
    } else if (
      existingLead.status === "invited" &&
      !existingLead.invited_at
    ) {
      // Defensive: stamp invited_at on a row that was somehow set to invited
      // without a timestamp (shouldn't happen, but cheap to fix).
      leadUpdates.invited_at = nowISO;
      leadStatus = "invited";
    } else {
      leadStatus = existingLead.status;
    }

    // Backfill leads.linkedin_url if blank.
    if (!byLeadRes.data) {
      leadUpdates.linkedin_url = linkedinUrl;
    }

    const { error: updErr } = await supabase
      .from("leads")
      .update(leadUpdates)
      .eq("id", leadId);
    if (updErr) {
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }

    // Backfill contact title and linkedin_url where blank.
    if (existingContact) {
      const contactUpdates: Record<string, unknown> = {};
      if (!existingContact.title && title) contactUpdates.title = title;
      if (!existingContact.linkedin_url) contactUpdates.linkedin_url = linkedinUrl;
      if (Object.keys(contactUpdates).length > 0) {
        await supabase
          .from("contacts")
          .update(contactUpdates)
          .eq("id", existingContact.id);
      }
    }
  } else {
    // ── New lead path ──
    created = true;
    leadStatus = "invited";

    // Resolve company. Phase 1.5 keeps this simple: if a company name was
    // given, we look for an existing company by exact name match and reuse
    // it; otherwise we create one. No fuzzy matching.
    let companyId: string | null = null;
    if (company) {
      const { data: existingCompany } = await supabase
        .from("companies")
        .select("id")
        .eq("name", company)
        .limit(1)
        .maybeSingle();
      if (existingCompany?.id) {
        companyId = existingCompany.id;
      } else {
        const { data: newCompany, error: cErr } = await supabase
          .from("companies")
          .insert({ name: company })
          .select("id")
          .single();
        if (cErr) {
          return NextResponse.json({ error: cErr.message }, { status: 500 });
        }
        companyId = newCompany.id;
      }
    }

    // Create contact.
    const { data: newContact, error: contactErr } = await supabase
      .from("contacts")
      .insert({
        first_name: splitNameResult.first,
        last_name: splitNameResult.last,
        title,
        linkedin_url: linkedinUrl,
        company_id: companyId,
      })
      .select("id")
      .single();
    if (contactErr || !newContact) {
      return NextResponse.json(
        { error: contactErr?.message ?? "Failed to create contact" },
        { status: 500 },
      );
    }

    // Create lead.
    const { data: newLead, error: leadErr } = await supabase
      .from("leads")
      .insert({
        contact_id: newContact.id,
        company_id: companyId,
        status: "invited",
        source: "linkedin",
        linkedin_url: linkedinUrl,
        invited_at: nowISO,
        last_activity_at: nowISO,
      })
      .select("id")
      .single();
    if (leadErr || !newLead) {
      // Best-effort cleanup of the orphan contact so a retry doesn't
      // collide on the linkedin_url.
      await supabase.from("contacts").delete().eq("id", newContact.id);
      return NextResponse.json(
        { error: leadErr?.message ?? "Failed to create lead" },
        { status: 500 },
      );
    }
    leadId = newLead.id;
  }

  // ── Insert connection_request activity ──
  // Resolve prompt title for the legacy prompt_used column.
  const { data: promptRow } = await supabase
    .from("prompt_templates")
    .select("title")
    .eq("id", promptId)
    .single();
  const promptUsed = promptRow?.title ?? null;

  const { data: activity, error: actErr } = await supabase
    .from("activities")
    .insert({
      lead_id: leadId,
      type: "connection_request",
      summary: truncate(noteText, SUMMARY_MAX),
      prompt_id: promptId,
      prompt_used: promptUsed,
      direction: "outbound",
      source,
    })
    .select("id")
    .single();

  if (actErr || !activity) {
    return NextResponse.json(
      { error: actErr?.message ?? "Failed to log activity" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    lead_id: leadId,
    status: leadStatus,
    created,
    activity_id: activity.id,
  });
}
