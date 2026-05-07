import { NextResponse } from "next/server";
import { requirePortalAuth } from "@/lib/portal-auth";

type Ctx = { params: { id: string } };

type TierInput = { min_qty: number; percent_off: number };

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
  const seen = new Set<number>();
  for (const t of out) {
    if (seen.has(t.min_qty)) {
      return { error: `Duplicate tier at min_qty ${t.min_qty}.` };
    }
    seen.add(t.min_qty);
  }
  return out;
}

// ── PATCH /api/discount/codes/[id] ──────────────────────────────────────────
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await requirePortalAuth();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  // Fetch existing row first so we can validate against the current discount_type.
  const { data: existing, error: fetchErr } = await supabase
    .from("discount_codes")
    .select("id, discount_type")
    .eq("id", id)
    .single();
  if (fetchErr || !existing) {
    return NextResponse.json({ error: "Code not found." }, { status: 404 });
  }

  const next_type =
    typeof body?.discount_type === "string"
      ? (body.discount_type as "percent" | "amount" | "tiered_percent")
      : existing.discount_type;
  if (!["percent", "amount", "tiered_percent"].includes(next_type)) {
    return NextResponse.json(
      { error: "discount_type must be 'percent', 'amount', or 'tiered_percent'." },
      { status: 400 }
    );
  }

  const updates: Record<string, unknown> = {};
  if (body?.discount_type !== undefined) updates.discount_type = next_type;
  if (body?.label !== undefined) {
    updates.label =
      typeof body.label === "string" && body.label.trim() ? body.label.trim() : null;
  }
  if (body?.is_active !== undefined) updates.is_active = !!body.is_active;
  if (body?.company_id !== undefined) {
    updates.company_id =
      typeof body.company_id === "string" && body.company_id.trim()
        ? body.company_id.trim()
        : null;
  }

  if (next_type === "tiered_percent") {
    // Tiered codes must clear flat values.
    updates.discount_value_6 = null;
    updates.discount_value_11 = null;
  } else {
    // Flat codes need both per-product values.
    if (
      body?.discount_value_6 !== undefined ||
      body?.discount_value_11 !== undefined ||
      body?.discount_type !== undefined
    ) {
      const v6 = Number(body?.discount_value_6);
      const v11 = Number(body?.discount_value_11);
      if (
        !Number.isFinite(v6) ||
        v6 < 0 ||
        !Number.isFinite(v11) ||
        v11 < 0
      ) {
        return NextResponse.json(
          { error: "Both 6\" and 11\" discount values are required." },
          { status: 400 }
        );
      }
      if (next_type === "percent" && (v6 > 100 || v11 > 100)) {
        return NextResponse.json(
          { error: "Percent values must be 0–100." },
          { status: 400 }
        );
      }
      updates.discount_value_6 = v6;
      updates.discount_value_11 = v11;
    }
  }

  // Tiers handling: when provided, replace the full tier set for this code.
  let nextTiers: TierInput[] | null = null;
  if (body?.tiers !== undefined || next_type === "tiered_percent") {
    if (body?.tiers !== undefined) {
      const parsed = parseTiers(body.tiers);
      if (!Array.isArray(parsed)) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
      }
      if (next_type === "tiered_percent" && parsed.length === 0) {
        return NextResponse.json(
          { error: "Tiered codes need at least one tier." },
          { status: 400 }
        );
      }
      nextTiers = parsed;
    }
  }

  if (Object.keys(updates).length > 0) {
    const { error: updErr } = await supabase
      .from("discount_codes")
      .update(updates)
      .eq("id", id);
    if (updErr) {
      console.error("PATCH /api/discount/codes/[id]:", updErr);
      return NextResponse.json({ error: updErr.message }, { status: 500 });
    }
  }

  if (nextTiers !== null) {
    const { error: delErr } = await supabase
      .from("discount_code_tiers")
      .delete()
      .eq("code_id", id);
    if (delErr) {
      console.error("PATCH tiers delete:", delErr);
      return NextResponse.json({ error: delErr.message }, { status: 500 });
    }
    if (nextTiers.length > 0) {
      const { error: insErr } = await supabase
        .from("discount_code_tiers")
        .insert(nextTiers.map((t) => ({ ...t, code_id: id })));
      if (insErr) {
        console.error("PATCH tiers insert:", insErr);
        return NextResponse.json({ error: insErr.message }, { status: 500 });
      }
    }
  }

  // Switching away from tiered_percent: drop any orphan tiers.
  if (
    body?.discount_type !== undefined &&
    next_type !== "tiered_percent" &&
    nextTiers === null
  ) {
    await supabase.from("discount_code_tiers").delete().eq("code_id", id);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}

// ── DELETE /api/discount/codes/[id] ─────────────────────────────────────────
export async function DELETE(_request: Request, { params }: Ctx) {
  const auth = await requirePortalAuth();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  const id = params.id;
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }

  // ON DELETE CASCADE on discount_code_tiers handles tier rows.
  const { error } = await supabase.from("discount_codes").delete().eq("id", id);
  if (error) {
    console.error("DELETE /api/discount/codes/[id]:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
