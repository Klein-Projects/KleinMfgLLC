import { createClient } from "@supabase/supabase-js";

export type PromoRow = {
  code: string;
  discount_type: "percent" | "amount";
  discount_value_6: number;
  discount_value_11: number;
  is_active: boolean;
  label: string | null;
};

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function lookupActivePromo(code: string): Promise<PromoRow | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("promo_codes")
    .select("code, discount_type, discount_value_6, discount_value_11, is_active, label")
    .ilike("code", trimmed)
    .eq("is_active", true)
    .limit(1);

  if (error || !data || data.length === 0) return null;
  return data[0] as PromoRow;
}

/**
 * Apply a promo discount to a single product's list price (cents).
 * Returns the discounted unit price in cents, floored at 0.
 */
export function applyDiscount(
  listPriceCents: number,
  discountType: "percent" | "amount",
  discountValue: number
): number {
  if (!Number.isFinite(listPriceCents) || listPriceCents < 0) return 0;

  let result: number;
  if (discountType === "percent") {
    const pct = Math.max(0, Math.min(100, Number(discountValue) || 0));
    result = Math.round(listPriceCents * (1 - pct / 100));
  } else {
    const offCents = Math.round((Number(discountValue) || 0) * 100);
    result = listPriceCents - offCents;
  }
  return Math.max(0, result);
}
