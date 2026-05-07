import { createClient } from "@supabase/supabase-js";

// Defaults matching the seed values in migration 006 — used as a fallback
// when the row is missing or unparseable.
const DEFAULT_PRICE_6_CENTS = 2100;
const DEFAULT_PRICE_11_CENTS = 2300;

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

function dollarsToCents(value: string | null | undefined, fallback: number): number {
  if (typeof value !== "string") return fallback;
  const dollars = Number(value);
  if (!Number.isFinite(dollars) || dollars < 0) return fallback;
  return Math.round(dollars * 100);
}

export async function getListPrices(): Promise<{
  price6Cents: number;
  price11Cents: number;
}> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("site_settings")
      .select("key, value")
      .in("key", ["list_price_6", "list_price_11"]);
    if (error || !data) {
      return {
        price6Cents: DEFAULT_PRICE_6_CENTS,
        price11Cents: DEFAULT_PRICE_11_CENTS,
      };
    }
    const map: Record<string, string> = {};
    for (const row of data) map[row.key] = row.value;
    return {
      price6Cents: dollarsToCents(map["list_price_6"], DEFAULT_PRICE_6_CENTS),
      price11Cents: dollarsToCents(map["list_price_11"], DEFAULT_PRICE_11_CENTS),
    };
  } catch (err) {
    console.error("getListPrices: failed, using defaults:", err);
    return {
      price6Cents: DEFAULT_PRICE_6_CENTS,
      price11Cents: DEFAULT_PRICE_11_CENTS,
    };
  }
}
