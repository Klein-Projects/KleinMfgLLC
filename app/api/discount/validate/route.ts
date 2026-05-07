import { NextResponse } from "next/server";
import { lookupActiveDiscount, resolveUnitPrices } from "@/lib/discount";

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
      { valid: false, error: "Enter a discount code." },
      { status: 400 }
    );
  }

  // Optional qty hints — used to preview the resolved tier for tiered codes.
  const qty6 = Number.isFinite(body?.qty6) ? Number(body.qty6) : 0;
  const qty11 = Number.isFinite(body?.qty11) ? Number(body.qty11) : 0;

  let row;
  try {
    row = await lookupActiveDiscount(code);
  } catch (err) {
    console.error("Discount validate: DB error:", err);
    return NextResponse.json(
      { valid: false, error: "Could not validate discount code. Try again." },
      { status: 500 }
    );
  }

  if (!row) {
    return NextResponse.json(
      { valid: false, error: "Invalid or expired discount code." },
      { status: 200 }
    );
  }

  const { unit6, unit11, appliedTier } = resolveUnitPrices(
    row,
    PRICE_6_CENTS,
    PRICE_11_CENTS,
    qty6,
    qty11
  );

  return NextResponse.json(
    {
      valid: true,
      code: row.code,
      label: row.label,
      discount_type: row.discount_type,
      discount_value_6: row.discount_value_6 == null ? null : Number(row.discount_value_6),
      discount_value_11: row.discount_value_11 == null ? null : Number(row.discount_value_11),
      tiers: row.tiers,
      list_price_6: PRICE_6_CENTS,
      list_price_11: PRICE_11_CENTS,
      discounted_price_6: unit6,
      discounted_price_11: unit11,
      applied_tier: appliedTier,
    },
    { status: 200 }
  );
}
