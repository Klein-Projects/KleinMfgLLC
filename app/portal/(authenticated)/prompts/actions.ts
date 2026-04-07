"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

// ── Increment Use Count ──

export async function incrementUseCount(templateId: string) {
  const supabase = createClient();
  const { error } = await supabase.rpc("increment_use_count", {
    template_id: templateId,
  });

  // Fallback if RPC doesn't exist: read-then-write
  if (error) {
    const { data } = await supabase
      .from("prompt_templates")
      .select("use_count")
      .eq("id", templateId)
      .single();

    await supabase
      .from("prompt_templates")
      .update({ use_count: (data?.use_count ?? 0) + 1 })
      .eq("id", templateId);
  }

  revalidatePath("/portal/prompts");
}

// ── Create Template ──

export async function createTemplate(formData: FormData) {
  const supabase = createClient();

  const category = formData.get("category") as string;
  const title = (formData.get("title") as string).trim();
  const body = (formData.get("body") as string).trim();
  const tagsRaw = (formData.get("tags") as string) || "";

  if (!title || !body || !category) {
    throw new Error("Category, title, and body are required");
  }

  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const { error } = await supabase.from("prompt_templates").insert({
    category,
    title,
    body,
    tags: tags.length > 0 ? tags : null,
    use_count: 0,
  });

  if (error) throw new Error(error.message);
  redirect("/portal/prompts");
}

// ── Update Template ──

export async function updateTemplate(templateId: string, formData: FormData) {
  const supabase = createClient();

  const category = formData.get("category") as string;
  const title = (formData.get("title") as string).trim();
  const body = (formData.get("body") as string).trim();
  const tagsRaw = (formData.get("tags") as string) || "";

  if (!title || !body || !category) {
    throw new Error("Category, title, and body are required");
  }

  const tags = tagsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const { error } = await supabase
    .from("prompt_templates")
    .update({
      category,
      title,
      body,
      tags: tags.length > 0 ? tags : null,
    })
    .eq("id", templateId);

  if (error) throw new Error(error.message);
  redirect("/portal/prompts");
}

// ── Delete Template ──

export async function deleteTemplate(templateId: string) {
  const supabase = createClient();

  const { error } = await supabase
    .from("prompt_templates")
    .delete()
    .eq("id", templateId);

  if (error) throw new Error(error.message);
  redirect("/portal/prompts");
}
