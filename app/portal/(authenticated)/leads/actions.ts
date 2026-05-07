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

// ── Update Contact ──

export async function updateContact(
  contactId: string,
  leadId: string,
  fields: {
    first_name: string;
    last_name: string;
    title: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    company_name: string | null;
    company_id: string | null;
  }
) {
  const supabase = createClient();

  if (!fields.first_name?.trim() || !fields.last_name?.trim()) {
    throw new Error("First and last name are required");
  }

  const trimmedCompany = fields.company_name?.trim() || null;
  let companyIdToLink: string | null = fields.company_id;

  if (fields.company_id && trimmedCompany) {
    const { error: companyErr } = await supabase
      .from("companies")
      .update({ name: trimmedCompany })
      .eq("id", fields.company_id);
    if (companyErr) throw new Error(companyErr.message);
  } else if (!fields.company_id && trimmedCompany) {
    const { data: newCompany, error: companyErr } = await supabase
      .from("companies")
      .insert({ name: trimmedCompany })
      .select("id")
      .single();
    if (companyErr) throw new Error(companyErr.message);
    companyIdToLink = newCompany.id;

    const { error: leadErr } = await supabase
      .from("leads")
      .update({ company_id: companyIdToLink })
      .eq("id", leadId);
    if (leadErr) throw new Error(leadErr.message);
  }

  const { error } = await supabase
    .from("contacts")
    .update({
      first_name: fields.first_name.trim(),
      last_name: fields.last_name.trim(),
      title: fields.title?.trim() || null,
      email: fields.email?.trim() || null,
      phone: fields.phone?.trim() || null,
      address: fields.address?.trim() || null,
      ...(companyIdToLink !== fields.company_id
        ? { company_id: companyIdToLink }
        : {}),
    })
    .eq("id", contactId);

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

// ── Snooze Follow-Up ──

export async function snoozeFollowUp(leadId: string) {
  const supabase = createClient();

  const { data: lead, error: fetchErr } = await supabase
    .from("leads")
    .select("follow_up_date")
    .eq("id", leadId)
    .single();

  if (fetchErr) throw new Error(fetchErr.message);

  const base = lead.follow_up_date
    ? new Date(lead.follow_up_date)
    : new Date();
  base.setDate(base.getDate() + 3);
  const newDate = base.toISOString().split("T")[0];

  const { error } = await supabase
    .from("leads")
    .update({ follow_up_date: newDate })
    .eq("id", leadId);

  if (error) throw new Error(error.message);
  revalidatePath("/portal");
  revalidatePath(`/portal/leads/${leadId}`);
}

// ── Mark Contacted ──

export async function markContacted(leadId: string) {
  const supabase = createClient();

  // Log follow-up activity
  const { error: actErr } = await supabase.from("activities").insert({
    lead_id: leadId,
    type: "follow_up",
    summary: "Marked contacted from dashboard",
  });
  if (actErr) throw new Error(actErr.message);

  // If status is 'new', upgrade to 'contacted'
  const { data: lead } = await supabase
    .from("leads")
    .select("status")
    .eq("id", leadId)
    .single();

  const updates: Record<string, any> = {
    last_activity_at: new Date().toISOString(),
  };
  if (lead?.status === "new") {
    updates.status = "contacted";
  }

  const { error } = await supabase
    .from("leads")
    .update(updates)
    .eq("id", leadId);

  if (error) throw new Error(error.message);
  revalidatePath("/portal");
  revalidatePath(`/portal/leads/${leadId}`);
}

// ── Quick Log Activity (from slide-over) ──

export async function quickLogActivity(
  leadId: string,
  type: string,
  summary: string
) {
  const supabase = createClient();

  if (!summary?.trim()) throw new Error("Summary is required");

  const { error } = await supabase.from("activities").insert({
    lead_id: leadId,
    type,
    summary: summary.trim(),
  });
  if (error) throw new Error(error.message);

  await supabase
    .from("leads")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", leadId);

  revalidatePath("/portal");
  revalidatePath(`/portal/leads/${leadId}`);
}

// ── Set Follow-Up Date ──

export async function setFollowUpDate(leadId: string, date: string) {
  const supabase = createClient();
  const { error } = await supabase
    .from("leads")
    .update({ follow_up_date: date || null })
    .eq("id", leadId);

  if (error) throw new Error(error.message);
  revalidatePath("/portal");
  revalidatePath(`/portal/leads/${leadId}`);
}

// ── Delete Lead ──

export async function deleteLead(leadId: string) {
  const supabase = createClient();

  const { error } = await supabase.from("leads").delete().eq("id", leadId);
  if (error) throw new Error(error.message);

  revalidatePath("/portal");
  revalidatePath("/portal/leads");
  redirect("/portal/leads");
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
