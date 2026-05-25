// ============================================================
// CRM auto-attribution for website inbound
// ------------------------------------------------------------
// Match-first, auto-create as fallback. Every inbound from
// sample-request form or paid-order checkout lands as a lead.
//
// Sample request → new lead at status='sample_sent' (or attach
//   activity to an existing open lead for that contact).
// Paid order     → new lead at status='pending_ship' (mark-shipped
//   later promotes to 'won' + stamps closed_won_at).
//
// Treats won/lost leads as terminal: a return customer who has a
// prior 'won' lead spawns a fresh lead rather than reviving the
// old one.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

type Supa = SupabaseClient<any, any, any>;

type SourceSample = {
  kind: "sample_request";
  sampleRequestId: string;
};

type SourcePaidOrder = {
  kind: "paid_order";
  orderId: string;
  discountCompanyId?: string | null;
  appliedDiscountCode?: string | null;
};

export type AttributionSource = SourceSample | SourcePaidOrder;

export type AttributionInput = {
  supabase: Supa;
  customerEmail: string;
  customerName: string;
  customerPhone?: string | null;
  companyName?: string | null;
  source: AttributionSource;
  activitySummary: string;
};

export type AttributionResult =
  | {
      ok: true;
      leadId: string;
      outcome:
        | "matched_by_promo"
        | "matched_by_email"
        | "attached_new_lead"
        | "created_lead";
    }
  | { ok: false; reason: "no_email" | "db_error"; detail?: string };

const TERMINAL_STATUSES = ["won", "lost"];

function splitName(full: string, fallbackEmail: string): {
  first: string;
  last: string;
} {
  const trimmed = (full ?? "").trim();
  if (!trimmed) {
    const local = (fallbackEmail.split("@")[0] || "Customer").trim();
    return { first: local || "Customer", last: "—" };
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "—" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

async function findOpenLeadByCompany(
  supabase: Supa,
  companyId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("leads")
    .select("id")
    .eq("company_id", companyId)
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function findContactByEmail(
  supabase: Supa,
  email: string
): Promise<{ id: string; company_id: string | null } | null> {
  const { data } = await supabase
    .from("contacts")
    .select("id, company_id")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

async function findOpenLeadByContact(
  supabase: Supa,
  contactId: string
): Promise<string | null> {
  const { data } = await supabase
    .from("leads")
    .select("id")
    .eq("contact_id", contactId)
    .not("status", "in", `(${TERMINAL_STATUSES.join(",")})`)
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.id ?? null;
}

async function getOrCreateCompany(
  supabase: Supa,
  name: string | null | undefined
): Promise<string | null> {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;

  const { data: existing } = await supabase
    .from("companies")
    .select("id")
    .ilike("name", trimmed)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) return existing.id;

  const { data: created, error } = await supabase
    .from("companies")
    .insert({ name: trimmed })
    .select("id")
    .single();
  if (error) {
    console.error("[crm-attribution] company create failed:", error);
    return null;
  }
  return created.id;
}

async function createContact(
  supabase: Supa,
  args: {
    email: string;
    name: string;
    phone?: string | null;
    companyId: string | null;
  }
): Promise<string | null> {
  const { first, last } = splitName(args.name, args.email);
  const { data, error } = await supabase
    .from("contacts")
    .insert({
      first_name: first,
      last_name: last,
      email: args.email.toLowerCase(),
      phone: args.phone ?? null,
      company_id: args.companyId,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[crm-attribution] contact create failed:", error);
    return null;
  }
  return data.id;
}

async function createLead(
  supabase: Supa,
  args: {
    contactId: string;
    companyId: string | null;
    status: "sample_sent" | "pending_ship";
    sampleRequestId?: string | null;
  }
): Promise<string | null> {
  const { data, error } = await supabase
    .from("leads")
    .insert({
      contact_id: args.contactId,
      company_id: args.companyId,
      status: args.status,
      source: "website",
      sample_request_id: args.sampleRequestId ?? null,
    })
    .select("id")
    .single();
  if (error) {
    console.error("[crm-attribution] lead create failed:", error);
    return null;
  }
  return data.id;
}

async function logActivity(
  supabase: Supa,
  args: {
    leadId: string;
    type: "web_order" | "sample_sent";
    summary: string;
    outcome: string;
  }
) {
  const { error: actErr } = await supabase.from("activities").insert({
    lead_id: args.leadId,
    type: args.type,
    summary: args.summary,
    outcome: args.outcome,
  });
  if (actErr) {
    console.error("[crm-attribution] activity insert failed:", actErr);
  }
  const { error: leadErr } = await supabase
    .from("leads")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", args.leadId);
  if (leadErr) {
    console.error("[crm-attribution] last_activity_at bump failed:", leadErr);
  }
}

async function linkSampleRequestIfMissing(
  supabase: Supa,
  leadId: string,
  sampleRequestId: string
) {
  const { data: lead } = await supabase
    .from("leads")
    .select("sample_request_id")
    .eq("id", leadId)
    .maybeSingle();
  if (lead && !lead.sample_request_id) {
    const { error } = await supabase
      .from("leads")
      .update({ sample_request_id: sampleRequestId })
      .eq("id", leadId);
    if (error) {
      console.error("[crm-attribution] sample_request_id link failed:", error);
    }
  }
}

export async function attributeInboundToCrm(
  input: AttributionInput
): Promise<AttributionResult> {
  const {
    supabase,
    customerEmail,
    customerName,
    customerPhone,
    companyName,
    source,
    activitySummary,
  } = input;

  const email = (customerEmail ?? "").trim().toLowerCase();
  if (!email) {
    return { ok: false, reason: "no_email" };
  }

  const activityType: "web_order" | "sample_sent" =
    source.kind === "sample_request" ? "sample_sent" : "web_order";
  const newLeadStatus: "sample_sent" | "pending_ship" =
    source.kind === "sample_request" ? "sample_sent" : "pending_ship";

  // ── Branch 1: discount code → company (paid orders only) ──
  if (source.kind === "paid_order" && source.discountCompanyId) {
    const matchedLeadId = await findOpenLeadByCompany(
      supabase,
      source.discountCompanyId
    );
    if (matchedLeadId) {
      await logActivity(supabase, {
        leadId: matchedLeadId,
        type: activityType,
        summary: activitySummary,
        outcome: "matched_by_promo",
      });
      return { ok: true, leadId: matchedLeadId, outcome: "matched_by_promo" };
    }
    // No open lead under that company — fall through to email match,
    // and ultimately auto-create. Note in logs that discount didn't help.
    console.warn(
      `[crm-attribution] discount ${source.appliedDiscountCode} ties to ` +
        `company ${source.discountCompanyId} but has no open leads; ` +
        `falling through to email match / auto-create.`
    );
  }

  // ── Branch 2: email → contact ──
  const contact = await findContactByEmail(supabase, email);

  if (contact?.id) {
    const openLeadId = await findOpenLeadByContact(supabase, contact.id);
    if (openLeadId) {
      // Existing open lead — attach activity and (if sample) backfill
      // sample_request_id when missing.
      if (source.kind === "sample_request") {
        await linkSampleRequestIfMissing(
          supabase,
          openLeadId,
          source.sampleRequestId
        );
      }
      await logActivity(supabase, {
        leadId: openLeadId,
        type: activityType,
        summary: activitySummary,
        outcome: "matched_by_email",
      });
      return { ok: true, leadId: openLeadId, outcome: "matched_by_email" };
    }

    // Contact exists but their lead(s) are terminal (won/lost) — spawn
    // a fresh lead. Reuse the contact's existing company if any.
    const newLeadId = await createLead(supabase, {
      contactId: contact.id,
      companyId: contact.company_id,
      status: newLeadStatus,
      sampleRequestId:
        source.kind === "sample_request" ? source.sampleRequestId : null,
    });
    if (!newLeadId) {
      return { ok: false, reason: "db_error", detail: "lead create failed" };
    }
    await logActivity(supabase, {
      leadId: newLeadId,
      type: activityType,
      summary: activitySummary,
      outcome: "attached_new_lead",
    });
    return { ok: true, leadId: newLeadId, outcome: "attached_new_lead" };
  }

  // ── Branch 3: no contact — full auto-create ──
  const companyId = await getOrCreateCompany(supabase, companyName);
  const contactId = await createContact(supabase, {
    email,
    name: customerName,
    phone: customerPhone,
    companyId,
  });
  if (!contactId) {
    return { ok: false, reason: "db_error", detail: "contact create failed" };
  }
  const leadId = await createLead(supabase, {
    contactId,
    companyId,
    status: newLeadStatus,
    sampleRequestId:
      source.kind === "sample_request" ? source.sampleRequestId : null,
  });
  if (!leadId) {
    return { ok: false, reason: "db_error", detail: "lead create failed" };
  }
  await logActivity(supabase, {
    leadId,
    type: activityType,
    summary: activitySummary,
    outcome: "created_lead",
  });
  return { ok: true, leadId, outcome: "created_lead" };
}
