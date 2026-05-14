"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type UpdateShipmentInput = {
  id: string;
  shipped_at?: string | null; // ISO string, or null to clear
  qty_6in?: number | null;
  qty_11in?: number | null;
  is_sample?: boolean | null;
  year: number; // for revalidation
};

// Phase 4 Step 5 — inline edit on /portal/analytics/samples/<year>.
// Lets Sean correct shipped_at, qty_6in, qty_11in, and the is_sample
// flag on the 18 historical shipments backfilled by migration 018.
export async function updateShipment(input: UpdateShipmentInput) {
  if (!input.id) throw new Error("id is required");

  const patch: Record<string, unknown> = {};
  if ("shipped_at" in input) patch.shipped_at = input.shipped_at || null;
  if ("qty_6in" in input)
    patch.qty_6in =
      input.qty_6in == null || input.qty_6in === ""
        ? null
        : Math.max(0, Math.floor(Number(input.qty_6in)));
  if ("qty_11in" in input)
    patch.qty_11in =
      input.qty_11in == null || input.qty_11in === ""
        ? null
        : Math.max(0, Math.floor(Number(input.qty_11in)));
  if ("is_sample" in input) patch.is_sample = !!input.is_sample;

  if (Object.keys(patch).length === 0) return { ok: true };

  const supabase = createClient();
  const { error } = await supabase
    .from("shipments")
    .update(patch)
    .eq("id", input.id);

  if (error) throw new Error(error.message);

  revalidatePath("/portal");
  revalidatePath(`/portal/analytics/samples/${input.year}`);
  return { ok: true };
}
