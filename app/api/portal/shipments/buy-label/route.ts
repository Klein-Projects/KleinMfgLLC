import { NextRequest, NextResponse } from "next/server";
import { requirePortalAuth } from "@/lib/portal-auth";
import {
  KLEIN_ORIGIN,
  KLEIN_PARCEL_DIMS,
  UPS_WALLET_ACCOUNT,
  calcParcelWeightOz,
  easypostFetch,
  type EasyPostRate,
  type EasyPostShipment,
} from "@/lib/easypost";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OrderRow = {
  id: string;
  customer_name: string;
  customer_phone: string | null;
  shipping_address_line1: string;
  shipping_address_line2: string | null;
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  product_6in_qty: number;
  product_11in_qty: number;
  shipping_status: string;
};

function logEasyPostError(
  context: string,
  status: number,
  body: unknown,
  shipment?: EasyPostShipment
) {
  console.error(`[buy-label] ${context} status=${status}`, {
    body,
    messages: shipment?.messages,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePortalAuth();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  // ── Parse body ─────────────────────────────────────────────
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

  // ── Load + validate order ─────────────────────────────────
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select(
      "id, customer_name, customer_phone, shipping_address_line1, shipping_address_line2, shipping_city, shipping_state, shipping_zip, product_6in_qty, product_11in_qty, shipping_status"
    )
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

  if (orderErr) {
    console.error("[buy-label] order lookup failed:", orderErr);
    return NextResponse.json({ error: orderErr.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.shipping_status !== "pending") {
    return NextResponse.json(
      {
        error: `Order is in shipping_status='${order.shipping_status}'. Only 'pending' orders can be labeled.`,
      },
      { status: 409 }
    );
  }

  // ── Build EasyPost shipment payload ───────────────────────
  const weightOz = calcParcelWeightOz(
    order.product_6in_qty,
    order.product_11in_qty
  );

  const createPayload = {
    shipment: {
      to_address: {
        name: order.customer_name,
        street1: order.shipping_address_line1,
        street2: order.shipping_address_line2 ?? undefined,
        city: order.shipping_city,
        state: order.shipping_state,
        zip: order.shipping_zip,
        country: "US",
        phone: order.customer_phone ?? undefined,
      },
      from_address: { ...KLEIN_ORIGIN },
      parcel: {
        length: KLEIN_PARCEL_DIMS.length,
        width: KLEIN_PARCEL_DIMS.width,
        height: KLEIN_PARCEL_DIMS.height,
        weight: weightOz,
      },
      carrier_accounts: [{ id: UPS_WALLET_ACCOUNT }],
    },
  };

  // ── Create the shipment (fetches rates) ───────────────────
  const createRes = await easypostFetch("/shipments", {
    method: "POST",
    body: JSON.stringify(createPayload),
  });

  let shipment: EasyPostShipment;
  try {
    shipment = await createRes.json();
  } catch {
    logEasyPostError("shipment.create non-JSON", createRes.status, null);
    return NextResponse.json(
      { error: "EasyPost returned an unreadable response." },
      { status: 502 }
    );
  }

  if (!createRes.ok || !shipment.id) {
    logEasyPostError("shipment.create failed", createRes.status, shipment);
    return NextResponse.json(
      {
        error: "Failed to create EasyPost shipment.",
        easypost: shipment,
      },
      { status: 502 }
    );
  }

  // ── Pick the UPS Ground rate ──────────────────────────────
  const rates = shipment.rates ?? [];
  const groundRate: EasyPostRate | undefined = rates.find(
    (r) => r.service === "Ground"
  );

  if (!groundRate) {
    logEasyPostError("no UPS Ground rate", createRes.status, shipment);
    return NextResponse.json(
      {
        error:
          "EasyPost returned no UPS Ground rate. Most common causes: " +
          "from-address is missing the state code (must be 'CA') or the " +
          "UPS Wallet carrier account is inactive in EasyPost. Check the " +
          "EasyPost dashboard → Carriers tab.",
        rates,
        messages: shipment.messages,
      },
      { status: 422 }
    );
  }

  // ── Buy the label as ZPL ─────────────────────────────────
  const buyRes = await easypostFetch(`/shipments/${shipment.id}/buy`, {
    method: "POST",
    body: JSON.stringify({
      rate: { id: groundRate.id },
      label_format: "ZPL",
    }),
  });

  let bought: EasyPostShipment;
  try {
    bought = await buyRes.json();
  } catch {
    logEasyPostError("shipment.buy non-JSON", buyRes.status, null);
    return NextResponse.json(
      { error: "EasyPost buy returned an unreadable response." },
      { status: 502 }
    );
  }

  if (!buyRes.ok || !bought.tracking_code || !bought.postage_label?.label_url) {
    logEasyPostError("shipment.buy failed", buyRes.status, bought);
    return NextResponse.json(
      {
        error: "Failed to buy EasyPost label.",
        easypost: bought,
      },
      { status: 502 }
    );
  }

  // ── Fetch the actual ZPL text ────────────────────────────
  // EasyPost returns label_url pointing at a .zpl file when label_format=ZPL.
  let labelZpl: string;
  try {
    const labelRes = await fetch(bought.postage_label.label_url);
    if (!labelRes.ok) throw new Error(`HTTP ${labelRes.status}`);
    labelZpl = await labelRes.text();
  } catch (e) {
    console.error("[buy-label] failed to fetch ZPL body:", e);
    return NextResponse.json(
      {
        error:
          "Label was purchased (wallet debited) but ZPL download failed. " +
          "Use the label_url to print manually.",
        tracking_code: bought.tracking_code,
        label_url: bought.postage_label.label_url,
      },
      { status: 502 }
    );
  }

  // ── Persist to the order row ─────────────────────────────
  const selected = bought.selected_rate ?? groundRate;
  const rateAmount = Number.parseFloat(selected.rate);

  const { error: updateErr } = await supabase
    .from("orders")
    .update({
      shipment_id: bought.id,
      tracking_code: bought.tracking_code,
      carrier: selected.carrier,
      service: selected.service,
      rate_amount: Number.isFinite(rateAmount) ? rateAmount : null,
      label_format: "ZPL",
      label_url: bought.postage_label.label_url,
      label_zpl: labelZpl,
      label_purchased_at: new Date().toISOString(),
      shipping_status: "label_purchased",
    })
    .eq("id", order.id);

  if (updateErr) {
    // Label was bought (real money spent) but DB update failed.
    // Surface it loudly so Sean can reconcile manually.
    console.error("[buy-label] DB update failed AFTER label purchase:", {
      orderId: order.id,
      shipmentId: bought.id,
      trackingCode: bought.tracking_code,
      error: updateErr,
    });
    return NextResponse.json(
      {
        error:
          "Label was purchased (wallet debited) but the order row failed to update. " +
          "Reconcile manually using the EasyPost dashboard.",
        shipment_id: bought.id,
        tracking_code: bought.tracking_code,
        label_url: bought.postage_label.label_url,
        db_error: updateErr.message,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    tracking_code: bought.tracking_code,
    label_zpl: labelZpl,
    rate_amount: Number.isFinite(rateAmount) ? rateAmount : null,
  });
}
