"use server";

import { revalidatePath } from "next/cache";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

function getServiceClient(): SupabaseClient {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

async function requireUser() {
  const cookieClient = createCookieClient();
  const {
    data: { user },
  } = await cookieClient.auth.getUser();
  if (!user) throw new Error("Unauthorized.");
  return user;
}

function splitName(full: string): { first: string; last: string } {
  const trimmed = (full || "").trim();
  if (!trimmed) return { first: "", last: "" };
  const idx = trimmed.indexOf(" ");
  if (idx < 0) return { first: trimmed, last: "" };
  return {
    first: trimmed.slice(0, idx),
    last: trimmed.slice(idx + 1).trim(),
  };
}

function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type OrderRow = {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  company_name: string | null;
  product_6in_qty: number;
  product_11in_qty: number;
  total_charged: string | number;
  discount_code: string | null;
};

async function loadOrder(supabase: SupabaseClient, orderId: string): Promise<OrderRow> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, customer_name, customer_email, customer_phone, company_name, " +
        "product_6in_qty, product_11in_qty, total_charged, discount_code"
    )
    .eq("id", orderId)
    .single();
  if (error || !data) throw new Error(error?.message || "Order not found.");
  return data as unknown as OrderRow;
}

function orderSummary(o: OrderRow): string {
  const totalCents = Math.round(Number(o.total_charged ?? 0) * 100);
  const items = `${o.product_6in_qty}× 6", ${o.product_11in_qty}× 11"`;
  const code = o.discount_code ? ` (code ${o.discount_code})` : "";
  return `Web order: ${items} — ${formatUSD(totalCents)}${code}`;
}

async function logActivity(
  supabase: SupabaseClient,
  leadId: string,
  summary: string,
  outcome: "manual_link" | "manual_create"
) {
  await supabase.from("activities").insert({
    lead_id: leadId,
    type: "web_order",
    summary,
    outcome,
  });
  await supabase
    .from("leads")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", leadId);
}

async function markResolved(supabase: SupabaseClient, reviewId: string) {
  await supabase
    .from("web_order_review")
    .update({ resolved: true })
    .eq("id", reviewId);
}

// ── Action 1: link review row to an existing company ───────────────────────
export async function linkOrderToCompany(args: {
  reviewId: string;
  orderId: string;
  companyId: string;
}) {
  await requireUser();
  const supabase = getServiceClient();

  const order = await loadOrder(supabase, args.orderId);
  const { first, last } = splitName(order.customer_name);

  // Find an existing contact for this email at this company.
  const { data: existingContacts } = await supabase
    .from("contacts")
    .select("id")
    .ilike("email", order.customer_email)
    .eq("company_id", args.companyId)
    .order("created_at", { ascending: false })
    .limit(1);

  let contactId: string;
  if (existingContacts && existingContacts.length > 0) {
    contactId = existingContacts[0].id as string;
  } else {
    const { data: newContact, error: contactErr } = await supabase
      .from("contacts")
      .insert({
        company_id: args.companyId,
        first_name: first || "Web",
        last_name: last || "Order",
        email: order.customer_email,
        phone: order.customer_phone,
      })
      .select("id")
      .single();
    if (contactErr || !newContact) {
      throw new Error(contactErr?.message || "Failed to create contact.");
    }
    contactId = newContact.id as string;
  }

  // Find most recent lead for this contact, else for the company, else create one.
  let leadId: string | null = null;
  const { data: contactLead } = await supabase
    .from("leads")
    .select("id")
    .eq("contact_id", contactId)
    .order("last_activity_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (contactLead?.id) {
    leadId = contactLead.id as string;
  } else {
    const { data: companyLead } = await supabase
      .from("leads")
      .select("id")
      .eq("company_id", args.companyId)
      .order("last_activity_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (companyLead?.id) {
      leadId = companyLead.id as string;
    } else {
      const { data: newLead, error: leadErr } = await supabase
        .from("leads")
        .insert({
          contact_id: contactId,
          company_id: args.companyId,
          status: "won",
          source: "website",
          last_activity_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (leadErr || !newLead) {
        throw new Error(leadErr?.message || "Failed to create lead.");
      }
      leadId = newLead.id as string;
    }
  }

  await logActivity(supabase, leadId, orderSummary(order), "manual_link");
  await markResolved(supabase, args.reviewId);
  revalidatePath("/portal/review");
}

// ── Action 2: create a brand-new company + contact + lead ──────────────────
export async function createAccountForOrder(args: {
  reviewId: string;
  orderId: string;
  companyName: string;
}) {
  await requireUser();
  const supabase = getServiceClient();

  const order = await loadOrder(supabase, args.orderId);
  const finalCompanyName = args.companyName.trim() || order.company_name?.trim() || "";
  if (!finalCompanyName) {
    throw new Error("Company name is required.");
  }

  const { data: company, error: companyErr } = await supabase
    .from("companies")
    .insert({ name: finalCompanyName })
    .select("id")
    .single();
  if (companyErr || !company) {
    throw new Error(companyErr?.message || "Failed to create company.");
  }
  const companyId = company.id as string;

  const { first, last } = splitName(order.customer_name);
  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .insert({
      company_id: companyId,
      first_name: first || "Web",
      last_name: last || "Order",
      email: order.customer_email,
      phone: order.customer_phone,
    })
    .select("id")
    .single();
  if (contactErr || !contact) {
    throw new Error(contactErr?.message || "Failed to create contact.");
  }
  const contactId = contact.id as string;

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .insert({
      contact_id: contactId,
      company_id: companyId,
      status: "won",
      source: "website",
      last_activity_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (leadErr || !lead) {
    throw new Error(leadErr?.message || "Failed to create lead.");
  }

  await logActivity(supabase, lead.id as string, orderSummary(order), "manual_create");
  await markResolved(supabase, args.reviewId);
  revalidatePath("/portal/review");
}

// ── Dismiss without creating CRM records ───────────────────────────────────
export async function dismissReview(args: { reviewId: string; notes?: string }) {
  await requireUser();
  const supabase = getServiceClient();
  await supabase
    .from("web_order_review")
    .update({ resolved: true, notes: args.notes ?? null })
    .eq("id", args.reviewId);
  revalidatePath("/portal/review");
}
