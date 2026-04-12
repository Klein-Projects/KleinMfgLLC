import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Map EasyPost status strings to our status enum
const STATUS_MAP: Record<string, string> = {
  unknown: "pending",
  pre_transit: "pending",
  in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered",
  return_to_sender: "exception",
  failure: "exception",
  available_for_pickup: "out_for_delivery",
  error: "exception",
};

export async function POST(req: NextRequest) {
  const supabase = createClient();
  const body = await req.json();

  // Determine which shipments to check
  let shipments: { id: string; tracking_number: string; carrier: string; lead_id: string | null; follow_up_created: boolean }[];

  if (body.checkAll) {
    const { data } = await supabase
      .from("shipments")
      .select("id, tracking_number, carrier, lead_id, follow_up_created")
      .neq("status", "delivered");
    shipments = data ?? [];
  } else if (body.shipmentId) {
    const { data } = await supabase
      .from("shipments")
      .select("id, tracking_number, carrier, lead_id, follow_up_created")
      .eq("id", body.shipmentId);
    shipments = data ?? [];
  } else {
    return NextResponse.json({ error: "Provide shipmentId or checkAll" }, { status: 400 });
  }

  if (shipments.length === 0) {
    return NextResponse.json({ updated: 0, deliveredCount: 0 });
  }

  const apiKey = process.env.EASYPOST_API_KEY;

  // If no EasyPost API key, return without changes.
  // To enable live tracking: get a free API key at https://www.easypost.com
  // and set EASYPOST_API_KEY in your environment variables.
  if (!apiKey) {
    return NextResponse.json({
      updated: 0,
      deliveredCount: 0,
      message: "No EASYPOST_API_KEY set. Shipments logged but tracking disabled. Get a free key at easypost.com.",
    });
  }

  let updated = 0;
  let deliveredCount = 0;

  for (const shipment of shipments) {
    try {
      // Create a tracker via EasyPost REST API
      const response = await fetch("https://api.easypost.com/v2/trackers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          tracker: {
            tracking_code: shipment.tracking_number,
            carrier: shipment.carrier,
          },
        }),
      });

      if (!response.ok) continue;

      const tracker = await response.json();
      const newStatus = STATUS_MAP[tracker.status] ?? "pending";

      // Update the shipment status
      const updateData: Record<string, any> = { status: newStatus };

      if (newStatus === "delivered") {
        updateData.delivered_at = tracker.tracking_details?.length
          ? tracker.tracking_details[tracker.tracking_details.length - 1].datetime
          : new Date().toISOString();
        deliveredCount++;

        // Auto-create follow-up if not already created
        if (!shipment.follow_up_created && shipment.lead_id) {
          // Log follow-up activity
          await supabase.from("activities").insert({
            lead_id: shipment.lead_id,
            type: "follow_up",
            summary:
              "Samples delivered \u2014 follow up to confirm receipt and usefulness",
          });

          // Set follow-up date to 3 days from now (only if null or further out)
          const threeDaysOut = new Date();
          threeDaysOut.setDate(threeDaysOut.getDate() + 3);
          const followUpDate = threeDaysOut.toISOString().split("T")[0];

          const { data: lead } = await supabase
            .from("leads")
            .select("follow_up_date")
            .eq("id", shipment.lead_id)
            .single();

          if (
            !lead?.follow_up_date ||
            lead.follow_up_date > followUpDate
          ) {
            await supabase
              .from("leads")
              .update({ follow_up_date: followUpDate })
              .eq("id", shipment.lead_id);
          }

          updateData.follow_up_created = true;
        }
      }

      await supabase
        .from("shipments")
        .update(updateData)
        .eq("id", shipment.id);

      updated++;
    } catch {
      // Skip individual tracking failures silently
      continue;
    }
  }

  return NextResponse.json({ updated, deliveredCount });
}
