"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ManualOrderPart = {
  size: "6in" | "11in";
  qty: number;
  unit_price: number;
};

export type CreateManualOrderInput = {
  customer_name: string;
  customer_company: string | null;
  order_date: string; // YYYY-MM-DD
  parts: ManualOrderPart[];
  total_revenue: number;
  notes: string | null;
  lead_id: string | null;
};

// Phase 4 Step 4 — persist offline orders (Boeing/Delta direct POs,
// phone orders, etc.) into manual_orders. The dashboard "Revenue"
// and "Parts sold" tiles already union this table (Step 2), so the
// numbers update on the next render after this insert.
export async function createManualOrder(input: CreateManualOrderInput) {
  const supabase = createClient();

  if (!input.customer_name?.trim()) {
    throw new Error("Customer name is required");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.order_date)) {
    throw new Error("Order date must be YYYY-MM-DD");
  }
  if (!Array.isArray(input.parts) || input.parts.length === 0) {
    throw new Error("At least one part line is required");
  }
  for (const p of input.parts) {
    if (p.size !== "6in" && p.size !== "11in") {
      throw new Error(`Unknown part size: ${p.size}`);
    }
    if (!Number.isFinite(p.qty) || p.qty <= 0) {
      throw new Error("Each part line needs a positive quantity");
    }
    if (!Number.isFinite(p.unit_price) || p.unit_price < 0) {
      throw new Error("Unit price must be a non-negative number");
    }
  }
  if (!Number.isFinite(input.total_revenue) || input.total_revenue < 0) {
    throw new Error("Total revenue must be a non-negative number");
  }

  const { data, error } = await supabase
    .from("manual_orders")
    .insert({
      customer_name: input.customer_name.trim(),
      customer_company: input.customer_company?.trim() || null,
      order_date: input.order_date,
      parts: input.parts,
      total_revenue: input.total_revenue,
      source: "manual",
      notes: input.notes?.trim() || null,
      lead_id: input.lead_id || null,
    })
    .select("id, order_date")
    .single();

  if (error) throw new Error(error.message);

  // Revalidate everywhere the new revenue can show up.
  const year = new Date(input.order_date).getUTCFullYear();
  revalidatePath("/portal");
  revalidatePath(`/portal/analytics/revenue/${year}`);
  revalidatePath(`/portal/analytics/parts-sold/${year}`);
  revalidatePath(`/portal/analytics/won/${year}`);

  return data;
}

// Phase 4 Step 5 — inline edit on existing manual_orders rows. Web
// orders aren't editable from this page (Stripe owns them).
export type UpdateManualOrderInput = {
  id: string;
  customer_name?: string;
  customer_company?: string | null;
  order_date?: string;
  total_revenue?: number;
  notes?: string | null;
  lead_id?: string | null;
  year: number; // for revalidation
};

export async function updateManualOrder(input: UpdateManualOrderInput) {
  if (!input.id) throw new Error("id is required");

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (input.customer_name !== undefined) {
    if (!input.customer_name?.trim()) {
      throw new Error("Customer name can't be empty");
    }
    patch.customer_name = input.customer_name.trim();
  }
  if (input.customer_company !== undefined) {
    patch.customer_company = input.customer_company?.trim() || null;
  }
  if (input.order_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.order_date)) {
      throw new Error("Order date must be YYYY-MM-DD");
    }
    patch.order_date = input.order_date;
  }
  if (input.total_revenue !== undefined) {
    if (!Number.isFinite(input.total_revenue) || input.total_revenue < 0) {
      throw new Error("Total revenue must be a non-negative number");
    }
    patch.total_revenue = input.total_revenue;
  }
  if (input.notes !== undefined) patch.notes = input.notes?.trim() || null;
  if (input.lead_id !== undefined) patch.lead_id = input.lead_id || null;

  const supabase = createClient();
  const { error } = await supabase
    .from("manual_orders")
    .update(patch)
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  revalidatePath("/portal");
  revalidatePath(`/portal/analytics/revenue/${input.year}`);
  revalidatePath(`/portal/analytics/parts-sold/${input.year}`);
  revalidatePath(`/portal/analytics/won/${input.year}`);
  return { ok: true };
}

export async function deleteManualOrder({
  id,
  year,
}: {
  id: string;
  year: number;
}) {
  if (!id) throw new Error("id is required");

  const supabase = createClient();
  const { error } = await supabase.from("manual_orders").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/portal");
  revalidatePath(`/portal/analytics/revenue/${year}`);
  revalidatePath(`/portal/analytics/parts-sold/${year}`);
  revalidatePath(`/portal/analytics/won/${year}`);
  return { ok: true };
}

// Phase 4 Step 5 follow-on — let Sean nuke a stray test order from the
// orders table (Stripe still has its record; deleting here just drops
// our local mirror so the row stops counting toward revenue/parts).
// Edit on web orders stays off — modifying total/customer/qty on a
// Stripe-owned row would silently diverge from the source of truth.
export async function deleteWebOrder({
  id,
  year,
}: {
  id: string;
  year: number;
}) {
  if (!id) throw new Error("id is required");

  const supabase = createClient();
  const { error } = await supabase.from("orders").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath("/portal");
  revalidatePath(`/portal/analytics/revenue/${year}`);
  revalidatePath(`/portal/analytics/parts-sold/${year}`);
  return { ok: true };
}
