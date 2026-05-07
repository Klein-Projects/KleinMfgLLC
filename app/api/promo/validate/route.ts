import { NextResponse } from "next/server";
import { applyDiscount, lookupActivePromo } from "@/lib/promo";

// Server-authoritative list prices (cents). Mirrors /api/checkout and /api/webhook.
const PRICE_6_CENTS = 2100;
const PRICE_11_CENTS = 2300;

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const code = typeof body?.code === "string" ? body.code : "";
  if (!code.trim()) {
    return NextResponse.json(
      { valid: false, error: "Enter a promo code." },
      { status: 400 }
    );
  }

  let promo;
  try {
    promo = await lookupActivePromo(code);
  } catch (err) {
    console.error("Promo validate: DB error:", err);
    return NextResponse.json(
      { valid: false, error: "Could not validate promo code. Try again." },
      { status: 500 }
    );
  }

  if (!promo) {
    return NextResponse.json(
      { valid: false, error: "Invalid or expired promo code." },
      { status: 200 }
    );
  }

  const discounted_price_6 = applyDiscount(
    PRICE_6_CENTS,
    promo.discount_type,
    promo.discount_value_6
  );
  const discounted_price_11 = applyDiscount(
    PRICE_11_CENTS,
    promo.discount_type,
    promo.discount_value_11
  );

  return NextResponse.json(
    {
      valid: true,
      code: promo.code,
      label: promo.label,
      discount_type: promo.discount_type,
      discount_value_6: Number(promo.discount_value_6),
      discount_value_11: Number(promo.discount_value_11),
      list_price_6: PRICE_6_CENTS,
      list_price_11: PRICE_11_CENTS,
      discounted_price_6,
      discounted_price_11,
    },
    { status: 200 }
  );
}
