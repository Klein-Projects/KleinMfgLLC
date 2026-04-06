import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // ── Validate required fields ──
    const { name, email } = body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Full name is required." },
        { status: 400 }
      );
    }

    if (
      !email ||
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return NextResponse.json(
        { error: "A valid email address is required." },
        { status: 400 }
      );
    }

    // ── Insert into Supabase ──
    const supabase = createClient();

    const { error: dbError } = await supabase.from("sample_requests").insert({
      name: name.trim(),
      company: body.company?.trim() || null,
      job_title: body.job_title?.trim() || null,
      email: email.trim().toLowerCase(),
      phone: body.phone?.trim() || null,
      quantity_6inch: parseInt(body.quantity_6inch) || 0,
      quantity_11inch: parseInt(body.quantity_11inch) || 0,
      shipping_address: body.shipping_address?.trim() || null,
      notes: body.notes?.trim() || null,
    });

    if (dbError) {
      console.error("Supabase insert error:", dbError);
      return NextResponse.json(
        { error: "Failed to save your request. Please try again." },
        { status: 500 }
      );
    }

    // ── Send notification email (optional — skip if no API key) ──
    if (process.env.RESEND_API_KEY) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);

        const companyLine = body.company ? ` — ${body.company}` : "";
        const subject = `New Sample Request — ${name}${companyLine}`;

        const lines = [
          `Name: ${name}`,
          body.company ? `Company: ${body.company}` : null,
          body.job_title ? `Job Title: ${body.job_title}` : null,
          `Email: ${email}`,
          body.phone ? `Phone: ${body.phone}` : null,
          `Qty 6" Scrapers: ${body.quantity_6inch || 0}`,
          `Qty 11" Scrapers: ${body.quantity_11inch || 0}`,
          body.shipping_address
            ? `Shipping Address:\n${body.shipping_address}`
            : null,
          body.notes ? `Notes:\n${body.notes}` : null,
        ]
          .filter(Boolean)
          .join("\n");

        await resend.emails.send({
          from: "Klein Mfg Samples <onboarding@resend.dev>",
          to: "kleinmanufacturing@gmail.com",
          subject,
          text: `New sample request received:\n\n${lines}`,
        });
      } catch (emailErr) {
        // Email failure should not block the request
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
