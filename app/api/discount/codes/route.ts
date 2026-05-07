import { NextResponse } from "next/server";
import { requirePortalAuth } from "@/lib/portal-auth";

type DiscountType = "percent" | "amount" | "tiered_percent";

type TierInput = { min_qty: number; percent_off: number };

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function parseTiers(raw: unknown): TierInput[] | { error: string } {
  if (!Array.isArray(raw)) return { error: "tiers must be an array." };
  const out: TierInput[] = [];
  for (const t of raw) {
    const min_qty = Number(t?.min_qty);
    const percent_off = Number(t?.percent_off);
    if (!Number.isInteger(min_qty) || min_qty <= 0) {
      return { error: "Each tier needs a positive integer min_qty." };
    }
    if (!Number.isFinite(percent_off) || percent_off <= 0 || percent_off > 100) {
      return { error: "Each tier percent_off must be in (0, 100]." };
    }
    out.push({ min_qty, percent_off });
  }
  // De-dup on min_qty (DB has UNIQUE (code_id, min_qty)).
  const seen = new Set<number>();
  for (const t of out) {
    if (seen.has(t.min_qty)) {
      return { error: `Duplicate tier at min_qty ${t.min_qty}.` };
    }
    seen.add(t.min_qty);
  }
  return out;
}

// ── GET /api/discount/codes ─────────────────────────────────────────────────
export async function GET() {
  const auth = await requirePortalAuth();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  const { data, error } = await supabase
    .from("discount_codes")
    .select(
      "id, code, discount_type, discount_value_6, discount_value_11, is_active, label, company_id, created_at, " +
        "company:companies(id, name), " +
        "tiers:discount_code_tiers(min_qty, percent_off)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("GET /api/discount/codes:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ codes: data ?? [] }, { status: 200 });
}

// ── POST /api/discount/codes ────────────────────────────────────────────────
export async function POST(request: Request) {
  const auth = await requirePortalAuth();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const code = typeof body?.code === "string" ? body.code.trim() : "";
  const discount_type = body?.discount_type as DiscountType;
  const label =
    typeof body?.label === "string" && body.label.trim() ? body.label.trim() : null;
  const company_id =
    typeof body?.company_id === "string" && body.company_id.trim()
      ? body.company_id.trim()
      : null;

  if (!code) {
    return NextResponse.json({ error: "Code is required." }, { status: 400 });
  }
  if (!["percent", "amount", "tiered_percent"].includes(discount_type)) {
    return NextResponse.json(
      { error: "discount_type must be 'percent', 'amount', or 'tiered_percent'." },
      { status: 400 }
    );
  }

  let discount_value_6: number | null = null;
  let discount_value_11: number | null = null;
  let tiers: TierInput[] = [];

  if (discount_type === "tiered_percent") {
    const parsed = parseTiers(body?.tiers ?? []);
    if (!Array.isArray(parsed)) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    if (parsed.length === 0) {
      return NextResponse.json(
        { error: "Tiered codes need at least one tier." },
        { status: 400 }
      );
    }
    tiers = parsed;
  } else {
    const v6 = Number(body?.discount_value_6);
    const v11 = Number(body?.discount_value_11);
    if (!isFiniteNonNegative(v6) || !isFiniteNonNegative(v11)) {
      return NextResponse.json(
        { error: "Both 6\" and 11\" discount values are required." },
        { status: 400 }
      );
    }
    if (discount_type === "percent" && (v6 > 100 || v11 > 100)) {
      return NextResponse.json(
        { error: "Percent values must be 0–100." },
        { status: 400 }
      );
    }
    discount_value_6 = v6;
    discount_value_11 = v11;
  }

  const { data: inserted, error: insertErr } = await supabase
    .from("discount_codes")
    .insert({
      code,
      discount_type,
      discount_value_6,
      discount_value_11,
      label,
      company_id,
      is_active: true,
    })
    .select("id")
    .single();

  if (insertErr) {
    if (insertErr.code === "23505") {
      return NextResponse.json(
        { error: "A code with that name already exists." },
        { status: 409 }
      );
    }
    console.error("POST /api/discount/codes:", insertErr);
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }

  if (tiers.length > 0) {
    const { error: tierErr } = await supabase
      .from("discount_code_tiers")
      .insert(tiers.map((t) => ({ ...t, code_id: inserted.id })));
    if (tierErr) {
      // Roll back the parent code so we don't leave a tiered code with no tiers.
      await supabase.from("discount_codes").delete().eq("id", inserted.id);
      console.error("POST /api/discount/codes (tiers):", tierErr);
      return NextResponse.json({ error: tierErr.message }, { status: 500 });
    }
  }

  return NextResponse.json({ id: inserted.id }, { status: 201 });
}
