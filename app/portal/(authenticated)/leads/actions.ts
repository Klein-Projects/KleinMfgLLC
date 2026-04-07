"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ── Update Lead Field ──

export async function updateLeadField(
  leadId: string,
  field: string,
  value: string | number | null
) {
  const supabase = createClient();
  const { error } = await supabase
    .from("leads")
    .update({ [field]: value })
    .eq("id", leadId);

  if (error) throw new Error(error.message);
  revalidatePath(`/portal/leads/${leadId}`);
}

// ── Log Activity ──

export async function logActivity(formData: FormData) {
  const supabase = createClient();

  const leadId = formData.get("lead_id") as string;
  const type = formData.get("type") as string;
  const summary = formData.get("summary") as string;
  const outcome = (formData.get("outcome") as string) || null;
  const promptUsed = (formData.get("prompt_used") as string) || null;

  if (!summary?.trim()) throw new Error("Summary is required");

  const { error } = await supabase.from("activities").insert({
    lead_id: leadId,
    type,
    summary: summary.trim(),
    outcome,
    prompt_used: promptUsed,
  });

  if (error) throw new Error(error.message);

  // Update lead last_activity_at
  await supabase
    .from("leads")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", leadId);

  revalidatePath(`/portal/leads/${leadId}`);
}

// ── Create Lead ──

export async function createLead(formData: FormData) {
  const supabase = createClient();

  // Company: use existing or create new
  let companyId: string | null = null;
  const existingCompanyId = formData.get("existing_company_id") as string;
  const newCompanyName = formData.get("new_company_name") as string;

  if (existingCompanyId) {
    companyId = existingCompanyId;
  } else if (newCompanyName?.trim()) {
    const { data: newCompany, error: companyErr } = await supabase
      .from("companies")
      .insert({
        name: newCompanyName.trim(),
        industry: (formData.get("new_company_industry") as string) || null,
        website: (formData.get("new_company_website") as string) || null,
      })
      .select("id")
      .single();

    if (companyErr) throw new Error(companyErr.message);
    companyId = newCompany.id;
  }

  // Create contact
  const { data: contact, error: contactErr } = await supabase
    .from("contacts")
    .insert({
      first_name: (formData.get("first_name") as string).trim(),
      last_name: (formData.get("last_name") as string).trim(),
      title: (formData.get("title") as string) || null,
      email: (formData.get("email") as string) || null,
      phone: (formData.get("phone") as string) || null,
      linkedin_url: (formData.get("linkedin_url") as string) || null,
      company_id: companyId,
    })
    .select("id")
    .single();

  if (contactErr) throw new Error(contactErr.message);

  // Create lead
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .insert({
      contact_id: contact.id,
      company_id: companyId,
      status: (formData.get("status") as string) || "new",
      source: (formData.get("source") as string) || "linkedin",
      follow_up_date: (formData.get("follow_up_date") as string) || null,
      notes: (formData.get("notes") as string) || null,
    })
    .select("id")
    .single();

  if (leadErr) throw new Error(leadErr.message);

  redirect(`/portal/leads/${lead.id}`);
}
