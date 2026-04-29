"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createShipment(formData: FormData) {
  const supabase = createClient();

  const trackingNumber = (formData.get("tracking_number") as string)?.trim();
  const carrier = formData.get("carrier") as string;
  const leadId = (formData.get("lead_id") as string) || null;
  const recipientName =
    (formData.get("recipient_name") as string)?.trim() || null;
  const shippedAt = (formData.get("shipped_at") as string) || null;
  const notes = (formData.get("notes") as string)?.trim() || null;

  if (!trackingNumber) throw new Error("Tracking number is required");
  if (!carrier) throw new Error("Carrier is required");

  // Insert shipment
  const { error: shipErr } = await supabase.from("shipments").insert({
    tracking_number: trackingNumber,
    carrier,
    lead_id: leadId,
    recipient_name: recipientName,
    shipped_at: shippedAt ? new Date(shippedAt).toISOString() : null,
    notes,
    status: "pending",
    follow_up_created: false,
  });

  if (shipErr) throw new Error(shipErr.message);

  // Log activity on the lead
  if (leadId) {
    const carrierLabel =
      carrier === "usps" ? "USPS" : carrier === "ups" ? "UPS" : "FedEx";

    await supabase.from("activities").insert({
      lead_id: leadId,
      type: "sample_sent",
      summary: `Samples shipped via ${carrierLabel}, tracking: ${trackingNumber}`,
    });

    await supabase
      .from("leads")
      .update({ last_activity_at: new Date().toISOString() })
      .eq("id", leadId);
  }

  revalidatePath("/portal/shipments");
  redirect("/portal/shipments");
}

// ── Update Shipment ──

const VALID_CARRIERS = ["usps", "ups", "fedex"] as const;
const VALID_STATUSES = [
  "pending",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "exception",
] as const;

export async function updateShipment(
  shipmentId: string,
  fields: {
    carrier: string;
    status: string;
    delivered_at: string | null;
  }
) {
  const supabase = createClient();

  if (!VALID_CARRIERS.includes(fields.carrier as any)) {
    throw new Error("Invalid carrier");
  }
  if (!VALID_STATUSES.includes(fields.status as any)) {
    throw new Error("Invalid status");
  }

  const { data: existing, error: fetchErr } = await supabase
    .from("shipments")
    .select("lead_id")
    .eq("id", shipmentId)
    .single();

  if (fetchErr) throw new Error(fetchErr.message);

  const { error } = await supabase
    .from("shipments")
    .update({
      carrier: fields.carrier,
      status: fields.status,
      delivered_at: fields.delivered_at
        ? new Date(fields.delivered_at).toISOString()
        : null,
    })
    .eq("id", shipmentId);

  if (error) throw new Error(error.message);

  revalidatePath("/portal/shipments");
  if (existing?.lead_id) {
    revalidatePath(`/portal/leads/${existing.lead_id}`);
  }
}
