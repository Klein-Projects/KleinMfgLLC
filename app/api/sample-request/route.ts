import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATE_RE = /^[A-Z]{2}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}

type ValidPayload = {
  name: string;
  email: string;
  phone: string;
  company: string;
  job_title: string;
  shipping_address_line1: string;
  shipping_address_line2: string; // "" if absent
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  quantity_6inch: number;
  quantity_11inch: number;
  notes: string;
};

type ValidationResult =
  | { ok: true; data: ValidPayload }
  | { ok: false; errors: Record<string, string> };

function validate(body: unknown): ValidationResult {
  const errors: Record<string, string> = {};
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");

  const name = str("name");
  const email = str("email").toLowerCase();
  const phone = str("phone");
  const line1 = str("shipping_address_line1");
  const line2 = str("shipping_address_line2");
  const city = str("shipping_city");
  const state = str("shipping_state").toUpperCase();
  const zip = str("shipping_zip");

  if (!name) errors.name = "Full name is required.";

  if (!email) errors.email = "Email is required.";
  else if (!EMAIL_RE.test(email)) errors.email = "Enter a valid email address.";

  if (!phone) errors.phone = "Phone is required.";

  if (!line1) errors.shipping_address_line1 = "Street address is required.";
  if (!city) errors.shipping_city = "City is required.";

  if (!state) errors.shipping_state = "State is required.";
  else if (!STATE_RE.test(state)) errors.shipping_state = "Use the 2-letter state code.";

  if (!zip) errors.shipping_zip = "ZIP is required.";
  else if (!ZIP_RE.test(zip)) errors.shipping_zip = "Use 12345 or 12345-6789.";

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    data: {
      name,
      email,
      phone,
      company: str("company"),
      job_title: str("job_title"),
      shipping_address_line1: line1,
      shipping_address_line2: line2,
      shipping_city: city,
      shipping_state: state,
      shipping_zip: zip,
      quantity_6inch: Number.parseInt(String(b.quantity_6inch ?? ""), 10) || 0,
      quantity_11inch: Number.parseInt(String(b.quantity_11inch ?? ""), 10) || 0,
      notes: str("notes"),
    },
  };
}

function buildLegacyAddress(p: ValidPayload): string {
  const street = [p.shipping_address_line1, p.shipping_address_line2].filter(Boolean).join(" ");
  return `${street}, ${p.shipping_city}, ${p.shipping_state} ${p.shipping_zip}`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const v = validate(body);
    if (!v.ok) {
      const firstError = Object.values(v.errors)[0] ?? "Invalid sample request.";
      return NextResponse.json(
        { error: firstError, errors: v.errors },
        { status: 400 }
      );
    }
    const p = v.data;

    const supabase = getSupabaseAdmin();

    // ── 1. Insert sample_requests row (legacy + structured columns) ──
    const { data: sampleRow, error: srErr } = await supabase
      .from("sample_requests")
      .insert({
        name: p.name,
        company: p.company || null,
        job_title: p.job_title || null,
        email: p.email,
        phone: p.phone,
        quantity_6inch: p.quantity_6inch,
        quantity_11inch: p.quantity_11inch,
        shipping_address: buildLegacyAddress(p),
        shipping_address_line1: p.shipping_address_line1,
        shipping_address_line2: p.shipping_address_line2 || null,
        shipping_city: p.shipping_city,
        shipping_state: p.shipping_state,
        shipping_zip: p.shipping_zip,
        notes: p.notes || null,
      })
      .select("id")
      .single();

    if (srErr || !sampleRow) {
      console.error("sample_requests insert error:", srErr);
      return NextResponse.json(
        { error: "Failed to save your request. Please try again." },
        { status: 500 }
      );
    }

    // ── 2. Insert $0 orders row so the sample rides the EasyPost pipeline ──
    //    Best-effort: if this fails, the sample_requests row stays so Sean can
    //    fulfill manually via UPS WorldShip. We log loudly and return 200.
    const { error: ordErr } = await supabase.from("orders").insert({
      customer_name: p.name,
      customer_email: p.email,
      customer_phone: p.phone,
      company_name: p.company || null,
      shipping_address_line1: p.shipping_address_line1,
      shipping_address_line2: p.shipping_address_line2 || null,
      shipping_city: p.shipping_city,
      shipping_state: p.shipping_state,
      shipping_zip: p.shipping_zip,
      shipping_method: "klein_ups",
      subtotal: 0,
      cc_fee: 0,
      total_charged: 0,
      shipping_cost: 0,
      status: "paid",
      shipping_status: "pending",
      product_6in_qty: p.quantity_6inch || 0,
      product_11in_qty: p.quantity_11inch || 0,
      is_sample: true,
      sample_request_id: sampleRow.id,
    });

    if (ordErr) {
      console.error(
        `orders insert failed for sample_request ${sampleRow.id} — manual fulfillment required:`,
        ordErr
      );
    }

    // ── 3. Notify sales@ ──
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);

        const companyLine = p.company ? ` — ${p.company}` : "";
        const subject = `New Sample Request — ${p.name}${companyLine}`;

        const lines = [
          `Name: ${p.name}`,
          p.company ? `Company: ${p.company}` : null,
          p.job_title ? `Job Title: ${p.job_title}` : null,
          `Email: ${p.email}`,
          `Phone: ${p.phone}`,
          `Qty 6" Scrapers: ${p.quantity_6inch}`,
          `Qty 11" Scrapers: ${p.quantity_11inch}`,
          `Shipping Address:\n${buildLegacyAddress(p)}`,
          p.notes ? `Notes:\n${p.notes}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        await resend.emails.send({
          from: "Klein Manufacturing <sales@kleinmfgllc.com>",
          to: "sales@kleinmfgllc.com",
          subject,
          text: `New sample request received:\n\n${lines}`,
        });
      } catch (emailErr) {
        console.error("Resend email error:", emailErr);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("Sample request error:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
