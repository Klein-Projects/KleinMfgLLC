import { NextResponse } from "next/server";
import Stripe from "stripe";
import { lookupActiveDiscount, resolveUnitPrices } from "@/lib/discount";
import { getListPrices } from "@/lib/settings";

const CC_FEE_RATE = 0.0309;
const MIN_SUBTOTAL_CENTS = 10000; // $100 minimum order

let stripeClient: Stripe | null = null;
function getStripe(): Stripe {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  stripeClient = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  return stripeClient;
}

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const {
    customerName,
    customerEmail,
    customerPhone,
    companyName,
    addressLine1,
    addressLine2,
    city,
    state,
    zip,
    qty6in,
    qty11in,
    shippingMethod,
    shippingCost,
    carrierType,
    carrierAccountNumber,
    discountCode,
  } = body ?? {};

  // ── Validate quantities ──
  const q6 = Number.isInteger(qty6in) ? qty6in : parseInt(qty6in, 10);
  const q11 = Number.isInteger(qty11in) ? qty11in : parseInt(qty11in, 10);

  if (!Number.isFinite(q6) || q6 < 0 || !Number.isFinite(q11) || q11 < 0) {
    return NextResponse.json(
      { error: "Quantities must be non-negative integers." },
      { status: 400 }
    );
  }

  // ── Read live list prices from site_settings ──
  const { price6Cents: PRICE_6_CENTS, price11Cents: PRICE_11_CENTS } =
    await getListPrices();

  if (q6 * PRICE_6_CENTS + q11 * PRICE_11_CENTS < MIN_SUBTOTAL_CENTS) {
    return NextResponse.json(
      { error: `Minimum order is $${(MIN_SUBTOTAL_CENTS / 100).toFixed(0)}.` },
      { status: 400 }
    );
  }

  // ── Validate shipping method ──
  if (shippingMethod !== "klein_calculated" && shippingMethod !== "collect") {
    return NextResponse.json(
      { error: "shippingMethod must be 'klein_calculated' or 'collect'." },
      { status: 400 }
    );
  }

  if (shippingMethod === "collect") {
    if (
      typeof carrierAccountNumber !== "string" ||
      carrierAccountNumber.trim().length === 0
    ) {
      return NextResponse.json(
        { error: "carrierAccountNumber is required for ship-collect orders." },
        { status: 400 }
      );
    }
    if (carrierType !== "UPS" && carrierType !== "FedEx") {
      return NextResponse.json(
        { error: "carrierType must be 'UPS' or 'FedEx' for ship-collect orders." },
        { status: 400 }
      );
    }
  }

  // ── Validate customer email ──
  if (
    typeof customerEmail !== "string" ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())
  ) {
    return NextResponse.json(
      { error: "A valid customerEmail is required." },
      { status: 400 }
    );
  }

  // ── Server-side pricing (re-validate discount against DB; never trust client prices) ──
  let unit6Cents = PRICE_6_CENTS;
  let unit11Cents = PRICE_11_CENTS;
  let appliedDiscountCode: string | null = null;

  if (typeof discountCode === "string" && discountCode.trim()) {
    try {
      const row = await lookupActiveDiscount(discountCode);
      if (!row) {
        return NextResponse.json(
          { error: "Invalid or expired discount code." },
          { status: 400 }
        );
      }
      const resolved = resolveUnitPrices(row, PRICE_6_CENTS, PRICE_11_CENTS, q6, q11);
      unit6Cents = resolved.unit6;
      unit11Cents = resolved.unit11;
      // Only stamp the code if it actually produced a discount.
      // (Tiered codes below the lowest tier resolve to list price.)
      const anyDiscount = unit6Cents < PRICE_6_CENTS || unit11Cents < PRICE_11_CENTS;
      if (anyDiscount) appliedDiscountCode = row.code;
    } catch (err) {
      console.error("Checkout: discount lookup failed:", err);
      return NextResponse.json(
        { error: "Could not validate discount code. Try again." },
        { status: 500 }
      );
    }
  }

  const subtotalCents = q6 * unit6Cents + q11 * unit11Cents;

  let shippingCents = 0;
  if (shippingMethod === "klein_calculated") {
    const parsed = Number.isInteger(shippingCost)
      ? shippingCost
      : parseInt(shippingCost, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return NextResponse.json(
        { error: "shippingCost (in cents) is required for klein_calculated shipping." },
        { status: 400 }
      );
    }
    shippingCents = parsed;
  }

  const ccFeeCents = Math.round(
    (subtotalCents + shippingCents) * CC_FEE_RATE
  );

  // ── Build Stripe line items ──
  const lineItems: NonNullable<Stripe.Checkout.SessionCreateParams["line_items"]> = [];

  if (q6 > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: appliedDiscountCode
            ? `6" Phenolic Aviation Scraper (Discount: ${appliedDiscountCode})`
            : '6" Phenolic Aviation Scraper',
        },
        unit_amount: unit6Cents,
      },
      quantity: q6,
    });
  }

  if (q11 > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: {
          name: appliedDiscountCode
            ? `11" Phenolic Aviation Scraper (Discount: ${appliedDiscountCode})`
            : '11" Phenolic Aviation Scraper',
        },
        unit_amount: unit11Cents,
      },
      quantity: q11,
    });
  }

  if (shippingCents > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: { name: "Shipping (UPS Ground)" },
        unit_amount: shippingCents,
      },
      quantity: 1,
    });
  }

  if (ccFeeCents > 0) {
    lineItems.push({
      price_data: {
        currency: "usd",
        product_data: { name: "Credit card processing fee (3.09%)" },
        unit_amount: ccFeeCents,
      },
      quantity: 1,
    });
  }

  // ── Metadata for the webhook (all values must be strings, max 500 chars each) ──
  const metadata: Record<string, string> = {
    qty6in: String(q6),
    qty11in: String(q11),
    shippingMethod,
    shippingCost: String(shippingCents),
    carrierType: typeof carrierType === "string" ? carrierType : "",
    carrierAccountNumber:
      typeof carrierAccountNumber === "string" ? carrierAccountNumber.trim() : "",
    customerName: typeof customerName === "string" ? customerName.trim() : "",
    customerPhone: typeof customerPhone === "string" ? customerPhone.trim() : "",
    companyName: typeof companyName === "string" ? companyName.trim() : "",
    addressLine1: typeof addressLine1 === "string" ? addressLine1.trim() : "",
    addressLine2: typeof addressLine2 === "string" ? addressLine2.trim() : "",
    city: typeof city === "string" ? city.trim() : "",
    state: typeof state === "string" ? state : "",
    zip: typeof zip === "string" ? zip.trim() : "",
    discountCode: appliedDiscountCode ?? "",
    unit6Cents: String(unit6Cents),
    unit11Cents: String(unit11Cents),
  };

  // ── Create Stripe Checkout session ──
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? "";

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      customer_email: customerEmail.trim().toLowerCase(),
      line_items: lineItems,
      metadata,
      success_url: `${baseUrl}/order/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/order`,
    });

    return NextResponse.json({ url: session.url }, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not create Stripe session.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
