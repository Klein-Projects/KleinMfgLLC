import { NextResponse } from "next/server";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

const PRICE_6_CENTS = 2100;
const PRICE_11_CENTS = 2300;
const CC_FEE_RATE = 0.0309;

let stripeClient: Stripe | null = null;
function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set.");
  stripeClient = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  return stripeClient;
}

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("Stripe webhook: STRIPE_WEBHOOK_SECRET is not set.");
    return NextResponse.json({ error: "Misconfigured." }, { status: 500 });
  }

  const sig = request.headers.get("stripe-signature");
  if (!sig) {
    return NextResponse.json(
      { error: "Missing Stripe signature." },
      { status: 400 }
    );
  }

  // ── Step 1: Verify Stripe signature against raw body ──
  const rawBody = Buffer.from(await request.arrayBuffer());

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "Signature verification failed.";
    console.error("Stripe signature verification failed:", msg);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  // Stripe sends many event types — only act on completed checkouts.
  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const md = session.metadata ?? {};

  // ── Step 2: Extract order data ──
  const customerName = (md.customerName ?? "").trim();
  const customerEmail = (session.customer_email ?? "").trim();
  const customerPhone = (md.customerPhone ?? "").trim();
  const companyName = (md.companyName ?? "").trim();
  const addressLine1 = (md.addressLine1 ?? "").trim();
  const addressLine2 = (md.addressLine2 ?? "").trim();
  const city = (md.city ?? "").trim();
  const state = (md.state ?? "").trim();
  const zip = (md.zip ?? "").trim();
  const carrierType = (md.carrierType ?? "").trim();
  const carrierAccountNumber = (md.carrierAccountNumber ?? "").trim();

  const q6 = parseInt(md.qty6in ?? "0", 10) || 0;
  const q11 = parseInt(md.qty11in ?? "0", 10) || 0;

  const rawShippingMethod = md.shippingMethod ?? "";
  const isCollect = rawShippingMethod === "collect";
  const isKleinCalc = rawShippingMethod === "klein_calculated";
  // The orders table CHECK accepts 'klein_ups' | 'collect'.
  const shippingMethodDb: "klein_ups" | "collect" = isCollect
    ? "collect"
    : "klein_ups";

  const stripePaymentIntentId =
    typeof session.payment_intent === "string" ? session.payment_intent : null;

  // ── Step 3: Recalculate totals server-side ──
  const subtotalCents = q6 * PRICE_6_CENTS + q11 * PRICE_11_CENTS;

  let shippingCents = 0;
  if (isKleinCalc) {
    const parsed = parseInt(md.shippingCost ?? "0", 10);
    shippingCents = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }

  const ccFeeCents = Math.round((subtotalCents + shippingCents) * CC_FEE_RATE);
  const totalCents = subtotalCents + shippingCents + ccFeeCents;

  // ── Step 4: Save to Supabase using service role ──
  let isDuplicate = false;
  try {
    const supabase = getSupabaseAdmin();
    const { error: dbError } = await supabase.from("orders").insert({
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: customerPhone || null,
      company_name: companyName || null,
      shipping_address_line1: addressLine1,
      shipping_address_line2: addressLine2 || null,
      shipping_city: city,
      shipping_state: state,
      shipping_zip: zip,
      product_6in_qty: q6,
      product_11in_qty: q11,
      shipping_method: shippingMethodDb,
      carrier_type: isCollect ? carrierType || null : null,
      carrier_account_number: isCollect ? carrierAccountNumber || null : null,
      shipping_cost: (shippingCents / 100).toFixed(2),
      subtotal: (subtotalCents / 100).toFixed(2),
      cc_fee: (ccFeeCents / 100).toFixed(2),
      total_charged: (totalCents / 100).toFixed(2),
      stripe_session_id: session.id,
      stripe_payment_intent_id: stripePaymentIntentId,
      status: "paid",
    });

    if (dbError) {
      // 23505 = unique_violation on stripe_session_id → Stripe retried this event.
      if (dbError.code === "23505") {
        isDuplicate = true;
        console.warn(
          `Stripe webhook: duplicate session ${session.id} — already recorded, skipping email.`
        );
      } else {
        console.error("Stripe webhook: Supabase insert error:", dbError);
      }
    }
  } catch (dbErr) {
    console.error("Stripe webhook: Supabase exception:", dbErr);
  }

  // ── Step 5: Send notification email via Resend ──
  if (!isDuplicate) {
    try {
      if (!process.env.RESEND_API_KEY) {
        console.error(
          "Stripe webhook: RESEND_API_KEY not set; skipping order email."
        );
      } else {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);

        const dateStr = new Date(
          (session.created ?? Math.floor(Date.now() / 1000)) * 1000
        ).toLocaleString("en-US", {
          dateStyle: "full",
          timeStyle: "short",
          timeZone: "America/Chicago",
        });

        const subject = `New Order — ${customerName || "Customer"} — ${formatUSD(totalCents)}`;

        const eName = escapeHtml(customerName);
        const eEmail = escapeHtml(customerEmail);
        const ePhone = escapeHtml(customerPhone);
        const eCompany = escapeHtml(companyName);
        const eAddr1 = escapeHtml(addressLine1);
        const eAddr2 = escapeHtml(addressLine2);
        const eCity = escapeHtml(city);
        const eState = escapeHtml(state);
        const eZip = escapeHtml(zip);
        const eCarrier = escapeHtml(carrierType);
        const eAccount = escapeHtml(carrierAccountNumber);
        const eSession = escapeHtml(session.id);

        const html = `<!doctype html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#2E2E2E;max-width:640px;margin:0 auto;padding:24px;">
  <h2 style="margin:0 0 8px;color:#1C2E4A;">NEW ORDER RECEIVED</h2>
  <p style="margin:0 0 16px;color:#7A7A7A;">${escapeHtml(dateStr)}</p>
  <hr style="border:0;border-top:1px solid #ddd;"/>

  <h3 style="margin:16px 0 4px;color:#1C2E4A;">CUSTOMER</h3>
  <p style="margin:0;line-height:1.6;">
    <strong>Name:</strong> ${eName || "—"}<br/>
    <strong>Email:</strong> ${eEmail || "—"}<br/>
    <strong>Phone:</strong> ${ePhone || "—"}${
      companyName ? `<br/><strong>Company:</strong> ${eCompany}` : ""
    }
  </p>
  <hr style="border:0;border-top:1px solid #ddd;"/>

  <h3 style="margin:16px 0 4px;color:#1C2E4A;">SHIP TO</h3>
  <p style="margin:0;line-height:1.6;">
    ${eAddr1}${addressLine2 ? `<br/>${eAddr2}` : ""}<br/>
    ${eCity}, ${eState} ${eZip}
  </p>
  <hr style="border:0;border-top:1px solid #ddd;"/>

  <h3 style="margin:16px 0 4px;color:#1C2E4A;">ORDER</h3>
  <p style="margin:0;line-height:1.6;">
    6&quot; Scrapers: ${q6} &times; $21.00 = ${formatUSD(q6 * PRICE_6_CENTS)}<br/>
    11&quot; Scrapers: ${q11} &times; $23.00 = ${formatUSD(q11 * PRICE_11_CENTS)}<br/>
    <strong>Subtotal:</strong> ${formatUSD(subtotalCents)}
  </p>
  <hr style="border:0;border-top:1px solid #ddd;"/>

  <h3 style="margin:16px 0 4px;color:#1C2E4A;">SHIPPING</h3>
  <p style="margin:0;line-height:1.6;">
    <strong>Method:</strong> ${isCollect ? "Ship Collect" : "Klein UPS Flat Rate"}${
      isCollect
        ? `<br/><strong>Carrier:</strong> ${eCarrier || "—"}<br/><strong>Account #:</strong> ${eAccount || "—"}`
        : ""
    }<br/>
    <strong>Shipping cost:</strong> ${formatUSD(shippingCents)}
  </p>
  <hr style="border:0;border-top:1px solid #ddd;"/>

  <p style="margin:16px 0 0;line-height:1.6;">
    CC Processing Fee (3.09%): ${formatUSD(ccFeeCents)}<br/>
    <strong style="font-size:16px;color:#A52A2A;">TOTAL CHARGED: ${formatUSD(totalCents)}</strong>
  </p>
  <hr style="border:0;border-top:1px solid #ddd;"/>

  <p style="margin:16px 0 0;color:#7A7A7A;font-size:12px;">
    Stripe Session ID: ${eSession}
  </p>
</body></html>`;

        const sendResult = await resend.emails.send({
          from: "Klein Manufacturing <sales@kleinmfgllc.com>",
          to: "sales@kleinmfgllc.com",
          subject,
          html,
        });

        if (sendResult.error) {
          console.error(
            "Stripe webhook: Resend rejected email:",
            sendResult.error
          );
        } else {
          console.log(
            "Stripe webhook: order email sent",
            sendResult.data?.id ?? "(no id)"
          );
        }
      }
    } catch (emailErr) {
      console.error("Stripe webhook: Resend email error:", emailErr);
    }
  }

  // ── Step 6: Always return 200 to Stripe ──
  return NextResponse.json({ received: true }, { status: 200 });
}
