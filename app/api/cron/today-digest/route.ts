import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { fetchContractQueue } from "@/lib/portal/today-queue";
import {
  renderDigestEmail,
  pacificDateParts,
} from "@/lib/portal/digest-email";

// ─────────────────────────────────────────────────────────────────────────
// GET /api/cron/today-digest — Phase 1 (V2.3)
//
// Cron-triggered Today digest. Pulls the same queue /api/today-queue
// returns (top 10), renders a Klein-branded HTML email, and sends via
// Resend to DIGEST_TO_EMAIL.
//
// Vercel Cron schedules in UTC, so we register two daily UTC slots and
// gate inside the route on America/Los_Angeles local time: the digest
// sends on the first firing that lands in the Pacific afternoon. Any
// firing outside that window returns 200 with { sent: false,
// reason: "off-window" } so the cron run still shows healthy in Vercel,
// and a second same-day firing is a harmless no-op (see idempotency).
// The window is intentionally wide because Vercel's free Hobby-plan
// crons can drift well past their scheduled minute.
//
// Idempotency: pacific_date is the primary key on digest_runs. The
// route INSERTs that row before calling Resend. A second invocation
// the same Pacific day fails the insert and exits without sending.
//
// Auth: Authorization: Bearer <CRON_SECRET>. Vercel Cron sends this
// header automatically when CRON_SECRET is set as a Vercel env var
// (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
//
// Dry-run: GET /api/cron/today-digest?dry-run=1 with a valid token
// returns the rendered HTML in the response body, does not call Resend,
// and does not write digest_runs.
// ─────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FALLBACK_BASE_URL = "https://kleinmfgllc.com";
const QUEUE_LIMIT = 10;        // top 10 leads, top 5 rendered inline
const PREVIEW_LIMIT = 5;
// Send on any firing that lands in the Pacific afternoon (noon–6pm).
// Wide on purpose: Hobby-plan cron drift can be large, and a second
// in-window firing the same day no-ops via the digest_runs unique key.
const SEND_WINDOW_START_HOUR = 12; // 12:00 PM Pacific (inclusive)
const SEND_WINDOW_END_HOUR = 18;   // 6:00 PM Pacific (exclusive)

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function localPacificClock(now: Date): { hour: number; minute: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return {
    hour: Number(parts.hour ?? "0"),
    minute: Number(parts.minute ?? "0"),
  };
}

function inSendWindow(now: Date): boolean {
  const { hour } = localPacificClock(now);
  return hour >= SEND_WINDOW_START_HOUR && hour < SEND_WINDOW_END_HOUR;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const dryRun =
    url.searchParams.get("dry-run") === "1" ||
    url.searchParams.get("dryRun") === "1";

  // ── Auth ──────────────────────────────────────────────────────────
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "Server not configured (CRON_SECRET unset)" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  const token = match ? match[1].trim() : "";
  if (!token || !safeEqualString(token, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const parts = pacificDateParts(now);

  // ── Window guard ──────────────────────────────────────────────────
  // Send on the first firing that lands in the Pacific afternoon; both
  // daily UTC slots fall inside it, so the earlier one sends and the
  // later one no-ops on the digest_runs unique date key.
  // Skipped on dry-run so Sean can preview from any timezone any time.
  // (Digest sends 7 days a week — no weekday guard.)
  if (!dryRun) {
    if (!inSendWindow(now)) {
      const { hour, minute } = localPacificClock(now);
      return NextResponse.json({
        sent: false,
        reason: "off-window",
        pacific_local_time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
        pacific_date: parts.pacificDateISO,
      });
    }
  }

  // ── Supabase (service role; bypasses RLS) ─────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json(
      { error: "Server not configured (Supabase env vars missing)" },
      { status: 500 },
    );
  }
  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Build queue ───────────────────────────────────────────────────
  // Use the Pacific calendar date — the digest is "today" from Sean's
  // perspective, not the server's. fetchContractQueue accepts an
  // explicit todayISO; pass the LA date so cards reflect what Sean
  // sees in the portal at 3:30 PM PT.
  const baseUrl =
    process.env.NEXT_PUBLIC_BASE_URL?.replace(/\/$/, "") ?? FALLBACK_BASE_URL;

  let queue;
  try {
    queue = await fetchContractQueue(supabase, {
      todayISO: parts.pacificDateISO,
      limit: QUEUE_LIMIT,
      baseUrl,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to fetch today queue",
      },
      { status: 500 },
    );
  }

  const rendered = renderDigestEmail(queue, {
    now,
    previewLimit: PREVIEW_LIMIT,
  });

  // ── Dry-run short-circuit ─────────────────────────────────────────
  if (dryRun) {
    // HTTP headers are ByteString — em-dashes etc. blow up the
    // response constructor. Downcast to ASCII for the diagnostic
    // header; the subject in the email body is unaffected.
    const subjectAscii = rendered.subject.replace(/[^\x20-\x7E]/g, "-");
    return new NextResponse(rendered.html, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "x-digest-subject": subjectAscii,
        "x-digest-rendered": String(rendered.rendered),
        "x-digest-total": String(queue.total),
        "x-digest-pacific-date": rendered.pacificDateISO,
        "x-digest-dry-run": "1",
      },
    });
  }

  // ── Idempotency: claim today's slot before sending ────────────────
  const fromEmail =
    process.env.DIGEST_FROM_EMAIL ?? "digest@kleinmfgllc.com";
  const toEmail = process.env.DIGEST_TO_EMAIL ?? "sales@kleinmfgllc.com";

  const claim = await supabase
    .from("digest_runs")
    .insert({
      pacific_date: rendered.pacificDateISO,
      cards_sent: rendered.rendered,
      total_in_queue: queue.total,
      recipients: toEmail,
    })
    .select("pacific_date")
    .single();

  if (claim.error) {
    // 23505 unique_violation — already sent today. Treat as no-op.
    const code = (claim.error as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json({
        sent: false,
        reason: "already-sent-today",
        pacific_date: rendered.pacificDateISO,
      });
    }
    return NextResponse.json(
      {
        error: `Idempotency claim failed: ${claim.error.message}`,
      },
      { status: 500 },
    );
  }

  // ── Send via Resend ───────────────────────────────────────────────
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // Roll back the claim so the next legitimate cron firing can try.
    await supabase
      .from("digest_runs")
      .delete()
      .eq("pacific_date", rendered.pacificDateISO);
    return NextResponse.json(
      { error: "Server not configured (RESEND_API_KEY unset)" },
      { status: 500 },
    );
  }

  let resendId: string | null = null;
  try {
    const { Resend } = await import("resend");
    const resend = new Resend(apiKey);
    const sendResult = await resend.emails.send({
      from: `Klein Manufacturing <${fromEmail}>`,
      to: toEmail,
      subject: rendered.subject,
      html: rendered.html,
    });

    if (sendResult.error) {
      // Roll back the claim — message never left.
      await supabase
        .from("digest_runs")
        .delete()
        .eq("pacific_date", rendered.pacificDateISO);
      console.error(
        "[today-digest] Resend rejected:",
        sendResult.error,
      );
      return NextResponse.json(
        {
          error:
            sendResult.error.message ?? "Resend rejected the email.",
        },
        { status: 502 },
      );
    }
    resendId = sendResult.data?.id ?? null;
  } catch (e) {
    await supabase
      .from("digest_runs")
      .delete()
      .eq("pacific_date", rendered.pacificDateISO);
    console.error("[today-digest] Resend exception:", e);
    return NextResponse.json(
      {
        error: e instanceof Error ? e.message : "Unknown Resend error.",
      },
      { status: 502 },
    );
  }

  // Annotate the run row with the Resend message id (best-effort).
  if (resendId) {
    await supabase
      .from("digest_runs")
      .update({ resend_id: resendId })
      .eq("pacific_date", rendered.pacificDateISO);
  }

  return NextResponse.json({
    sent: true,
    pacific_date: rendered.pacificDateISO,
    subject: rendered.subject,
    cards_sent: rendered.rendered,
    total_in_queue: queue.total,
    resend_id: resendId,
    to: toEmail,
    from: fromEmail,
  });
}
