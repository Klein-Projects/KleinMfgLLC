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
  is_sample: boolean;
  sample_request_id: string | null;
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
      "id, customer_name, customer_phone, shipping_address_line1, shipping_address_line2, shipping_city, shipping_state, shipping_zip, product_6in_qty, product_11in_qty, shipping_status, is_sample, sample_request_id"
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

  // ── Resolve the ZPL URL ──────────────────────────────────
  // The UPSDAP aggregator (which gives us the discounted UPS Wallet rates)
  // returns only a PNG label_url at buy time — label_zpl_url is null even
  // though we requested label_format=ZPL. EasyPost's label conversion
  // endpoint regenerates the existing label in ZPL format for free and
  // populates label_zpl_url; we call it as a fallback when the buy response
  // doesn't already include a ZPL URL. Native UPS / USPS / FedEx accounts
  // typically populate label_zpl_url at buy time and skip this step.
  let labelZplUrl: string | null | undefined =
    bought.postage_label.label_zpl_url;

  if (!labelZplUrl) {
    const convertRes = await easypostFetch(
      `/shipments/${bought.id}/label?file_format=zpl`,
      { method: "GET" }
    );
    if (convertRes.ok) {
      try {
        const converted = (await convertRes.json()) as EasyPostShipment;
        labelZplUrl = converted.postage_label?.label_zpl_url;
        if (converted.postage_label) {
          bought.postage_label = converted.postage_label;
        }
      } catch {
        // fall through to the missing-zpl branch below
      }
    } else {
      console.error(
        "[buy-label] /label?file_format=zpl conversion failed: HTTP " +
          convertRes.status
      );
    }
  }

  if (!labelZplUrl) {
    console.error(
      "[buy-label] EasyPost returned no label_zpl_url and conversion failed",
      { shipmentId: bought.id, postage_label: bought.postage_label }
    );
    return NextResponse.json(
      {
        error:
          "Label was purchased (wallet debited) but EasyPost did not return a " +
          "ZPL URL. Print manually from the carrier-default label_url instead.",
        tracking_code: bought.tracking_code,
        label_url: bought.postage_label.label_url,
      },
      { status: 502 }
    );
  }

  // ── Fetch the actual ZPL text ────────────────────────────
  let labelZpl: string;
  try {
    const labelRes = await fetch(labelZplUrl);
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

  // EasyPost's ZPL bodies sometimes contain NUL bytes (typically inside the
  // ^GFA graphic field that encodes the carrier logo). Postgres `text`
  // columns reject any string containing \x00 with the error
  // "unsupported Unicode escape sequence", which causes the UPDATE below
  // to fail with PostgREST status 400 — leaving the wallet debited and
  // the order row unchanged. ZPL II is plain ASCII, so stripping NULs is
  // safe and printers ignore them anyway.
  const sanitizedLabelZpl = labelZpl.replace(/\x00/g, "");

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
      label_zpl: sanitizedLabelZpl,
      label_purchased_at: new Date().toISOString(),
      shipping_status: "label_purchased",
    })
    .eq("id", order.id);

  if (updateErr) {
    // Label was bought (real money spent) but DB update failed.
    // Single-line JSON.stringify so the Vercel runtime-logs view does not
    // collapse the per-key fields the way it does on a multi-line console.error.
    const errFields = {
      name: updateErr.name,
      message: updateErr.message,
      code: (updateErr as { code?: string }).code,
      details: (updateErr as { details?: string }).details,
      hint: (updateErr as { hint?: string }).hint,
    };
    console.error(
      "[buy-label-error] " +
        JSON.stringify({
          orderId: order.id,
          shipmentId: bought.id,
          trackingCode: bought.tracking_code,
          labelUrl: bought.postage_label.label_url,
          updateErr: errFields,
        })
    );
    return NextResponse.json(
      {
        error:
          "Label was purchased (wallet debited) but the order row failed to update. " +
          "Reconcile manually using the EasyPost dashboard.",
        shipment_id: bought.id,
        tracking_code: bought.tracking_code,
        label_url: bought.postage_label.label_url,
        db_error: errFields,
      },
      { status: 500 }
    );
  }

  // ── Sample-only CRM side-effects ─────────────────────────
  // Best-effort: log loudly on failure but never block ok=true.
  // The label is bought and the wallet is debited; reconciliation
  // is fine to do by hand if any of these inserts miss.
  if (order.is_sample && order.sample_request_id) {
    try {
      const { data: lead, error: leadErr } = await supabase
        .from("leads")
        .select("id")
        .eq("sample_request_id", order.sample_request_id)
        .maybeSingle<{ id: string }>();

      if (leadErr) {
        console.error("[buy-label] lead lookup failed for sample order:", {
          orderId: order.id,
          sampleRequestId: order.sample_request_id,
          error: leadErr,
        });
      }

      const { error: shipErr } = await supabase.from("shipments").insert({
        lead_id: lead?.id ?? null,
        tracking_number: bought.tracking_code,
        carrier: "ups",
        status: "pending",
        recipient_name: order.customer_name,
        notes: `Auto-created by EasyPost label purchase (order ${order.id}).`,
        follow_up_created: false,
      });

      if (shipErr) {
        console.error("[buy-label] CRM shipments insert failed:", {
          orderId: order.id,
          trackingCode: bought.tracking_code,
          error: shipErr,
        });
      }

      if (lead?.id) {
        const { error: actErr } = await supabase.from("activities").insert({
          lead_id: lead.id,
          type: "sample_sent",
          summary: `Samples shipped via UPS Ground, tracking: ${bought.tracking_code}`,
        });

        if (actErr) {
          console.error("[buy-label] sample_sent activity insert failed:", {
            leadId: lead.id,
            orderId: order.id,
            error: actErr,
          });
        }

        const { error: leadUpdErr } = await supabase
          .from("leads")
          .update({ last_activity_at: new Date().toISOString() })
          .eq("id", lead.id);

        if (leadUpdErr) {
          console.error("[buy-label] lead last_activity_at bump failed:", {
            leadId: lead.id,
            orderId: order.id,
            error: leadUpdErr,
          });
        }
      }
    } catch (sideEffectErr) {
      console.error(
        "[buy-label] unexpected error in sample-only CRM block:",
        sideEffectErr
      );
    }
  }

  return NextResponse.json({
    ok: true,
    tracking_code: bought.tracking_code,
    label_zpl: sanitizedLabelZpl,
    rate_amount: Number.isFinite(rateAmount) ? rateAmount : null,
  });
}
