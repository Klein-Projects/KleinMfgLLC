// ============================================================
// POST /api/portal/shipments/void
// Phase 15L.5 — request an EasyPost label refund (void).
//
// EasyPost ONLY refunds labels that have not yet been scanned by UPS.
// Once the package is in the UPS system, the refund request will be
// rejected by UPS and the wallet stays debited — that's expected
// behavior, not a bug. Surface EasyPost's refund_status to the caller.
// ============================================================

import { NextRequest, NextResponse } from "next/server";
import { requirePortalAuth } from "@/lib/portal-auth";
import { easypostFetch, type EasyPostShipment } from "@/lib/easypost";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OrderRow = {
  id: string;
  shipment_id: string | null;
  shipping_status: string;
};

// EasyPost adds refund_status to the shipment after a refund request.
// Values seen in practice: "submitted" | "refunded" | "rejected".
type EasyPostShipmentWithRefund = EasyPostShipment & {
  refund_status?: string | null;
};

export async function POST(req: NextRequest) {
  const auth = await requirePortalAuth();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json(
      { error: "orderId must be a valid UUID." },
      { status: 400 }
    );
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, shipment_id, shipping_status")
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

  if (orderErr) {
    console.error("[void] order lookup failed:", orderErr);
    return NextResponse.json({ error: orderErr.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  if (order.shipping_status === "shipped") {
    return NextResponse.json(
      {
        error:
          "Order is already marked shipped — too late to void. " +
          "If the package is still on your bench, mark it back to label_purchased manually.",
      },
      { status: 409 }
    );
  }
  if (order.shipping_status === "delivered") {
    return NextResponse.json(
      { error: "Order is already delivered — cannot void." },
      { status: 409 }
    );
  }
  if (order.shipping_status === "voided") {
    return NextResponse.json(
      { error: "Order is already voided." },
      { status: 409 }
    );
  }
  if (!order.shipment_id) {
    return NextResponse.json(
      {
        error:
          "Order has no EasyPost shipment_id on file — nothing to refund. " +
          "(No label was ever purchased.)",
      },
      { status: 422 }
    );
  }

  // ── Ask EasyPost to refund the label ────────────────────────────────
  const refundRes = await easypostFetch(
    `/shipments/${order.shipment_id}/refund`,
    { method: "POST" }
  );

  let shipment: EasyPostShipmentWithRefund;
  try {
    shipment = await refundRes.json();
  } catch {
    console.error("[void] EasyPost refund non-JSON", {
      status: refundRes.status,
    });
    return NextResponse.json(
      { error: "EasyPost returned an unreadable response." },
      { status: 502 }
    );
  }

  if (!refundRes.ok) {
    console.error("[void] EasyPost refund failed", {
      status: refundRes.status,
      messages: shipment.messages,
    });
    return NextResponse.json(
      {
        error:
          "EasyPost refused the refund. Most common cause: UPS has already " +
          "scanned the package, so the label can't be refunded.",
        easypost: shipment,
      },
      { status: 502 }
    );
  }

  const refundStatus = shipment.refund_status ?? "submitted";

  // ── Mark the order voided ───────────────────────────────────────────
  const { error: updateErr } = await supabase
    .from("orders")
    .update({
      shipping_status: "voided",
      voided_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  if (updateErr) {
    // Refund was already requested at EasyPost — surface loudly so Sean
    // can reconcile the order row by hand.
    console.error(
      "[void] DB update failed AFTER EasyPost refund request:",
      {
        orderId: order.id,
        shipmentId: order.shipment_id,
        refundStatus,
        error: updateErr,
      }
    );
    return NextResponse.json(
      {
        error:
          "EasyPost refund was requested but the order row failed to update. " +
          "Reconcile manually — the label refund is in flight.",
        refundStatus,
        db_error: updateErr.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, refundStatus });
}
