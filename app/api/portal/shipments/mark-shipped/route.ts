import { NextRequest, NextResponse } from "next/server";
import { requirePortalAuth } from "@/lib/portal-auth";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OrderRow = {
  id: string;
  customer_name: string;
  customer_email: string;
  product_6in_qty: number;
  product_11in_qty: number;
  subtotal: string | number;
  shipping_cost: string | number;
  cc_fee: string | number;
  total_charged: string | number;
  tracking_code: string | null;
  carrier: string | null;
  service: string | null;
  shipping_status: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtUSD(value: string | number): string {
  const n = typeof value === "number" ? value : Number.parseFloat(value);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${n.toFixed(2)}`;
}

function firstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0];
}

function buildEmailHtml(order: OrderRow, trackingUrl: string): string {
  const eName = escapeHtml(firstName(order.customer_name));
  const eTracking = escapeHtml(order.tracking_code ?? "");
  const eTrackUrl = escapeHtml(trackingUrl);
  const eService = escapeHtml(order.service || "Ground");

  const lineItems: string[] = [];
  if (order.product_6in_qty > 0) {
    lineItems.push(
      `${order.product_6in_qty} &times; 6&quot; Scraper${order.product_6in_qty === 1 ? "" : "s"}`
    );
  }
  if (order.product_11in_qty > 0) {
    lineItems.push(
      `${order.product_11in_qty} &times; 11&quot; Scraper${order.product_11in_qty === 1 ? "" : "s"}`
    );
  }
  const itemsHtml = lineItems.length
    ? lineItems.map((l) => `&bull; ${l}`).join("<br/>")
    : "&mdash;";

  return `<!doctype html>
<html><body style="font-family:Calibri,'Segoe UI',-apple-system,BlinkMacSystemFont,Arial,sans-serif;color:#2E2E2E;max-width:640px;margin:0 auto;padding:0;background:#ffffff;">
  <div style="background:#1C2E4A;color:#ffffff;padding:20px 24px;">
    <div style="font-size:18px;font-weight:600;letter-spacing:0.5px;">KLEIN MANUFACTURING, LLC</div>
    <div style="font-size:13px;opacity:0.85;margin-top:2px;">Built for the shop. Trusted on the flight line. Made in America.</div>
  </div>
  <hr style="border:0;border-top:3px solid #A52A2A;margin:0;"/>

  <div style="padding:24px;">
    <h2 style="margin:0 0 12px;color:#1C2E4A;font-size:20px;">Your order has shipped.</h2>
    <p style="margin:0 0 16px;line-height:1.6;">
      Hi ${eName},<br/><br/>
      Your Klein Manufacturing order has shipped via UPS ${eService}.
    </p>

    <h3 style="margin:20px 0 6px;color:#1C2E4A;font-size:14px;letter-spacing:0.5px;">TRACKING</h3>
    <p style="margin:0;line-height:1.6;">
      <strong>Tracking number:</strong> ${eTracking}<br/>
      <a href="${eTrackUrl}" style="color:#A52A2A;text-decoration:none;font-weight:600;">Track your package &rarr;</a>
    </p>
    <hr style="border:0;border-top:1px solid #ddd;margin:18px 0;"/>

    <h3 style="margin:0 0 6px;color:#1C2E4A;font-size:14px;letter-spacing:0.5px;">ORDER DETAILS</h3>
    <p style="margin:0;line-height:1.6;">${itemsHtml}</p>

    <p style="margin:14px 0 0;line-height:1.6;">
      Subtotal: ${fmtUSD(order.subtotal)}<br/>
      Shipping: ${fmtUSD(order.shipping_cost)}<br/>
      Card processing fee: ${fmtUSD(order.cc_fee)}<br/>
      <strong style="color:#A52A2A;font-size:16px;">Total paid: ${fmtUSD(order.total_charged)}</strong>
    </p>
    <hr style="border:0;border-top:1px solid #ddd;margin:18px 0;"/>

    <p style="margin:0;line-height:1.6;">
      Questions? Just reply to this email.<br/><br/>
      &mdash; Sean Klein<br/>
      Klein Manufacturing, LLC
    </p>
  </div>
</body></html>`;
}

function buildEmailText(order: OrderRow, trackingUrl: string): string {
  const lines: string[] = [];
  if (order.product_6in_qty > 0) {
    lines.push(`  ${order.product_6in_qty} x 6" Scraper`);
  }
  if (order.product_11in_qty > 0) {
    lines.push(`  ${order.product_11in_qty} x 11" Scraper`);
  }

  return [
    `Hi ${firstName(order.customer_name)},`,
    ``,
    `Your Klein Manufacturing order has shipped via UPS ${order.service || "Ground"}.`,
    ``,
    `Tracking number: ${order.tracking_code ?? ""}`,
    `Track your package: ${trackingUrl}`,
    ``,
    `Order details:`,
    ...(lines.length ? lines : ["  —"]),
    ``,
    `Subtotal: ${fmtUSD(order.subtotal)}`,
    `Shipping: ${fmtUSD(order.shipping_cost)}`,
    `Card processing fee: ${fmtUSD(order.cc_fee)}`,
    `Total paid: ${fmtUSD(order.total_charged)}`,
    ``,
    `Questions? Reply to this email.`,
    ``,
    `— Sean Klein, Klein Manufacturing, LLC`,
  ].join("\n");
}

export async function POST(req: NextRequest) {
  const auth = await requirePortalAuth();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  let body: { orderId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json(
      { error: "orderId must be a valid UUID." },
      { status: 400 }
    );
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select(
      "id, customer_name, customer_email, product_6in_qty, product_11in_qty, subtotal, shipping_cost, cc_fee, total_charged, tracking_code, carrier, service, shipping_status"
    )
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

  if (orderErr) {
    console.error("[mark-shipped] order lookup failed:", orderErr);
    return NextResponse.json({ error: orderErr.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }
  if (order.shipping_status !== "label_purchased") {
    return NextResponse.json(
      {
        error: `Order is in shipping_status='${order.shipping_status}'. Only 'label_purchased' orders can be marked shipped.`,
      },
      { status: 409 }
    );
  }
  if (!order.tracking_code) {
    return NextResponse.json(
      {
        error:
          "Order has no tracking_code on file — cannot mark shipped without one.",
      },
      { status: 422 }
    );
  }

  // ── Flip the order to 'shipped' BEFORE sending email ─────────────────
  // If Resend hiccups, we still want the order marked shipped so it leaves
  // the Ready-to-Ship queue. The email failure is logged for follow-up.
  const shippedAt = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("orders")
    .update({ shipping_status: "shipped", shipped_at: shippedAt })
    .eq("id", order.id);

  if (updateErr) {
    console.error("[mark-shipped] DB update failed:", updateErr);
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // ── Send tracking email (non-blocking) ───────────────────────────────
  const trackingUrl = `https://www.ups.com/track?tracknum=${encodeURIComponent(
    order.tracking_code
  )}`;

  let emailMessageId: string | null = null;
  let emailError: string | null = null;

  if (!process.env.RESEND_API_KEY) {
    emailError = "RESEND_API_KEY not set; tracking email skipped.";
    console.error("[mark-shipped] " + emailError);
  } else if (!order.customer_email) {
    emailError = "Order has no customer_email; tracking email skipped.";
    console.error("[mark-shipped] " + emailError);
  } else {
    try {
      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);

      const sendResult = await resend.emails.send({
        from: "Klein Manufacturing <sales@kleinmfgllc.com>",
        to: order.customer_email,
        subject:
          "Your Klein Manufacturing order has shipped — tracking enclosed",
        html: buildEmailHtml(order, trackingUrl),
        text: buildEmailText(order, trackingUrl),
        replyTo: "sales@kleinmfgllc.com",
      });

      if (sendResult.error) {
        emailError = sendResult.error.message ?? "Resend rejected the email.";
        console.error("[mark-shipped] Resend rejected email:", sendResult.error);
      } else {
        emailMessageId = sendResult.data?.id ?? null;
        console.log(
          "[mark-shipped] tracking email sent",
          emailMessageId ?? "(no id)"
        );
      }
    } catch (e) {
      emailError = e instanceof Error ? e.message : "Unknown email error.";
      console.error("[mark-shipped] Resend exception:", e);
    }
  }

  return NextResponse.json({
    ok: true,
    emailMessageId,
    ...(emailError ? { emailError } : {}),
  });
}
