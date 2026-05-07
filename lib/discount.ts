import { createClient } from "@supabase/supabase-js";

export type DiscountType = "percent" | "amount" | "tiered_percent";

export type DiscountTier = {
  min_qty: number;
  percent_off: number;
};

export type DiscountRow = {
  id: string;
  code: string;
  discount_type: DiscountType;
  discount_value_6: number | null;
  discount_value_11: number | null;
  is_active: boolean;
  label: string | null;
  company_id: string | null;
  tiers: DiscountTier[];
};

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

export async function lookupActiveDiscount(code: string): Promise<DiscountRow | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("discount_codes")
    .select(
      "id, code, discount_type, discount_value_6, discount_value_11, is_active, label, company_id, " +
        "tiers:discount_code_tiers(min_qty, percent_off)"
    )
    .ilike("code", trimmed)
    .eq("is_active", true)
    .limit(1);

  if (error || !data || data.length === 0) return null;

  const row = data[0] as unknown as DiscountRow;
  // Normalize tier ordering so consumers can rely on ascending min_qty.
  row.tiers = (row.tiers ?? []).slice().sort((a, b) => a.min_qty - b.min_qty);
  return row;
}

/**
 * Apply a flat (percent | amount) discount to a single product's list price (cents).
 * Used for non-tiered codes only.
 */
export function applyFlatDiscount(
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

/**
 * Pick the best-matching tier for a given total qty. Returns null if no tier qualifies.
 * Assumes tiers are sorted ascending by min_qty.
 */
export function resolveTier(
  tiers: DiscountTier[],
  totalQty: number
): DiscountTier | null {
  let match: DiscountTier | null = null;
  for (const t of tiers) {
    if (totalQty >= t.min_qty) match = t;
    else break;
  }
  return match;
}

/**
 * Resolve effective per-unit prices for a discount code given current qtys.
 * - tiered_percent: applies the matched tier's percent to both list prices,
 *   or returns list prices when no tier qualifies.
 * - percent / amount: applies the per-product discount values.
 */
export function resolveUnitPrices(
  row: DiscountRow,
  listPrice6Cents: number,
  listPrice11Cents: number,
  qty6: number,
  qty11: number
): { unit6: number; unit11: number; appliedTier: DiscountTier | null } {
  if (row.discount_type === "tiered_percent") {
    const tier = resolveTier(row.tiers, (qty6 || 0) + (qty11 || 0));
    if (!tier) {
      return { unit6: listPrice6Cents, unit11: listPrice11Cents, appliedTier: null };
    }
    return {
      unit6: applyFlatDiscount(listPrice6Cents, "percent", tier.percent_off),
      unit11: applyFlatDiscount(listPrice11Cents, "percent", tier.percent_off),
      appliedTier: tier,
    };
  }

  return {
    unit6: applyFlatDiscount(
      listPrice6Cents,
      row.discount_type,
      Number(row.discount_value_6 ?? 0)
    ),
    unit11: applyFlatDiscount(
      listPrice11Cents,
      row.discount_type,
      Number(row.discount_value_11 ?? 0)
    ),
    appliedTier: null,
  };
}
