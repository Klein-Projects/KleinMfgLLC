import type { ContractCard, ContractQueue } from "@/lib/portal/today-queue";

// ─────────────────────────────────────────────────────────────────────────
// Klein 3:30pm Today digest — pure HTML renderer.
//
// Inputs: a ContractQueue (the same shape /api/today-queue returns) and
// the rendering moment (so subject + headline match what Sean sees on
// Pacific time, not the server's UTC clock).
//
// No external CSS, no <style> blocks — every rule is inlined on the
// element. Layout is table-based so Outlook 2007/2013/2016 don't drop
// blocks. Width is 600px; cards stack one per row.
// ─────────────────────────────────────────────────────────────────────────

const COLORS = {
  navy: "#1C2E4A",
  red: "#A52A2A",
  charcoal: "#2E2E2E",
  steel: "#7A7A7A",
  offWhite: "#F4F4F2",
  pageBg: "#E9EAEC",
  cardBorder: "#D9DBDF",
  white: "#FFFFFF",
} as const;

const HEADER_FONT =
  'Arial, "Helvetica Neue", Helvetica, sans-serif';
const BODY_FONT =
  'Calibri, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

const PREVIEW_LIMIT = 5; // cards rendered inline

// ── Helpers ───────────────────────────────────────────────────────────

export function escapeHtml(s: string | null | undefined): string {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(s: string): string {
  // For the script body — preserve paragraph breaks in the email.
  return escapeHtml(s).replace(/\r?\n/g, "<br>");
}

interface DateParts {
  weekday: string;     // Monday
  month: string;       // May
  day: number;         // 9
  year: number;        // 2026
  pacificDateISO: string; // 2026-05-09
}

export function pacificDateParts(now: Date): DateParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  const isoFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return {
    weekday: parts.weekday ?? "",
    month: parts.month ?? "",
    day: Number(parts.day ?? "0"),
    year: Number(parts.year ?? "0"),
    pacificDateISO: isoFmt.format(now),
  };
}

// ── Subject ───────────────────────────────────────────────────────────

export function buildSubject(rendered: number, parts: DateParts): string {
  return `Klein 3:30pm digest — ${rendered} follow-up${rendered === 1 ? "" : "s"} for ${parts.weekday}, ${parts.month} ${parts.day}`;
}

// ── Card pieces ───────────────────────────────────────────────────────

function pillCellHtml(card: ContractCard): string {
  const isOverdue = card.days_overdue > 0;
  const bg = isOverdue ? COLORS.red : COLORS.navy;
  const label = isOverdue
    ? `${card.days_overdue} DAY${card.days_overdue === 1 ? "" : "S"} OVERDUE`
    : "DUE TODAY";
  return [
    `<td align="right" valign="top" style="padding:0;font-family:${HEADER_FONT};">`,
    `<span style="display:inline-block;background:${bg};color:${COLORS.white};font:bold 11px/1 ${HEADER_FONT};letter-spacing:0.06em;padding:6px 10px;border-radius:3px;text-transform:uppercase;white-space:nowrap;">`,
    escapeHtml(label),
    `</span>`,
    `</td>`,
  ].join("");
}

function metaLineHtml(card: ContractCard): string {
  const bits: string[] = [];
  if (card.title) bits.push(escapeHtml(card.title));
  if (card.company) bits.push(escapeHtml(card.company));
  if (bits.length === 0) return "";
  return `<div style="font:13px/1.4 ${BODY_FONT};color:${COLORS.steel};margin:2px 0 0 0;">${bits.join(" · ")}</div>`;
}

function cadenceLineHtml(card: ContractCard): string {
  const cat = card.recommended_prompt.category;
  const title = card.recommended_prompt.title;
  return `<div style="font:11px/1.4 ${HEADER_FONT};color:${COLORS.steel};margin-top:10px;letter-spacing:0.04em;text-transform:uppercase;">${escapeHtml(cat)} · ${escapeHtml(title)}</div>`;
}

function ctaButtonHtml(card: ContractCard): string {
  // Bullet-proof button pattern: outer table, inner anchor with padding.
  // VML for Outlook is omitted intentionally — Sean's audience is
  // sales@kleinmfgllc.com (himself) on Gmail web, Gmail iOS, and Outlook
  // desktop. The padded anchor renders as a button on all three; VML
  // would just be noise.
  const href = escapeHtml(card.portal_url);
  return [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;">`,
    `<tr><td align="center" bgcolor="${COLORS.navy}" style="background:${COLORS.navy};border-radius:3px;">`,
    `<a href="${href}" target="_blank" style="display:inline-block;padding:10px 18px;font:bold 13px/1 ${HEADER_FONT};color:${COLORS.white};text-decoration:none;border-radius:3px;letter-spacing:0.04em;">`,
    `Open in Portal ›`,
    `</a>`,
    `</td></tr></table>`,
  ].join("");
}

function cardHtml(card: ContractCard): string {
  return [
    // outer card row spacer
    `<tr><td style="padding:0 0 14px 0;">`,
    // card table
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.offWhite};border:1px solid ${COLORS.cardBorder};border-left:4px solid ${COLORS.navy};border-collapse:separate;">`,
    `<tr><td style="padding:18px 20px 18px 20px;">`,

    // header row: name / meta on the left, pill on the right
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`,
    `<tr>`,
    `<td valign="top" style="padding:0;">`,
    `<div style="font:bold 17px/1.25 ${HEADER_FONT};color:${COLORS.navy};">${escapeHtml(card.name)}</div>`,
    metaLineHtml(card),
    `</td>`,
    pillCellHtml(card),
    `</tr>`,
    `</table>`,

    cadenceLineHtml(card),

    // red divider above script
    `<div style="border-top:2px solid ${COLORS.red};margin:14px 0 12px 0;height:0;line-height:0;font-size:0;">&nbsp;</div>`,

    // script body
    `<div style="font:14px/1.55 ${BODY_FONT};color:${COLORS.charcoal};white-space:normal;">${nl2br(card.recommended_prompt.body_personalized)}</div>`,

    // CTA
    `<div style="margin-top:16px;">${ctaButtonHtml(card)}</div>`,

    `</td></tr>`,
    `</table>`,
    `</td></tr>`,
  ].join("");
}

// ── Empty state ───────────────────────────────────────────────────────

function emptyStateHtml(parts: DateParts): string {
  const portalLink =
    "https://kleinmfgllc.com/portal/today";
  return [
    `<tr><td style="padding:0 0 14px 0;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.offWhite};border:1px solid ${COLORS.cardBorder};border-left:4px solid ${COLORS.navy};border-collapse:separate;">`,
    `<tr><td style="padding:24px 20px;text-align:center;">`,
    `<div style="font:bold 16px/1.3 ${HEADER_FONT};color:${COLORS.navy};">All clear for ${escapeHtml(parts.weekday)}.</div>`,
    `<div style="font:14px/1.5 ${BODY_FONT};color:${COLORS.charcoal};margin-top:8px;">No follow-ups due. Either everyone has replied or nothing has tripped a cadence rule today.</div>`,
    `<div style="margin-top:14px;">`,
    `<a href="${portalLink}" target="_blank" style="font:13px/1 ${HEADER_FONT};color:${COLORS.navy};text-decoration:underline;">Check the portal anyway →</a>`,
    `</div>`,
    `</td></tr></table></td></tr>`,
  ].join("");
}

// ── Footer ────────────────────────────────────────────────────────────

function footerHtml(): string {
  return [
    `<tr><td style="background:${COLORS.navy};padding:14px 20px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`,
    `<tr>`,
    `<td align="left" valign="middle" style="font:12px/1.4 ${HEADER_FONT};color:${COLORS.white};">`,
    `Klein Manufacturing, LLC · Made in the USA`,
    `</td>`,
    `<td align="right" valign="middle" style="font:12px/1.4 ${HEADER_FONT};color:${COLORS.white};opacity:0.85;">`,
    `Sent 3:30 PM PT, daily`,
    `</td>`,
    `</tr>`,
    `</table>`,
    `</td></tr>`,
  ].join("");
}

// ── Header ────────────────────────────────────────────────────────────

function headerHtml(): string {
  return [
    `<tr><td style="background:${COLORS.navy};padding:22px 20px 18px 20px;text-align:center;">`,
    `<div style="font:bold 22px/1.1 ${HEADER_FONT};color:${COLORS.white};letter-spacing:0.18em;text-transform:uppercase;">KLEIN MANUFACTURING</div>`,
    `<div style="font:12px/1.4 ${BODY_FONT};color:${COLORS.white};opacity:0.85;letter-spacing:0.04em;margin-top:6px;">Handcrafted Phenolic Scrapers ★ Made in the USA ★ Designed for Aviation</div>`,
    `</td></tr>`,
  ].join("");
}

function summaryStripHtml(rendered: number, total: number, parts: DateParts): string {
  const subtitle = (() => {
    if (total === 0) return "No follow-ups due.";
    const rest = total - rendered;
    if (rest <= 0) {
      return `${total} follow-up${total === 1 ? "" : "s"} ready below.`;
    }
    return `${total} follow-up${total === 1 ? "" : "s"} total — top ${rendered} below, ${rest} more in the full queue.`;
  })();
  const dateLabel = `${parts.weekday}, ${parts.month} ${parts.day}, ${parts.year}`;
  return [
    `<tr><td style="background:${COLORS.white};border-bottom:1px solid ${COLORS.cardBorder};padding:18px 20px;">`,
    `<div style="font:bold 15px/1.3 ${HEADER_FONT};color:${COLORS.navy};">3:30 PM Digest · ${escapeHtml(dateLabel)}</div>`,
    `<div style="font:13px/1.5 ${BODY_FONT};color:${COLORS.charcoal};margin-top:4px;">${escapeHtml(subtitle)}</div>`,
    `</td></tr>`,
  ].join("");
}

function fullQueueLinkHtml(rendered: number, total: number): string {
  const rest = total - rendered;
  if (rest <= 0) return "";
  const href = "https://kleinmfgllc.com/portal/today";
  return [
    `<tr><td style="padding:6px 0 4px 0;text-align:center;">`,
    `<a href="${href}" target="_blank" style="font:13px/1.4 ${HEADER_FONT};color:${COLORS.navy};text-decoration:underline;">`,
    `${rest} more in the full queue → kleinmfgllc.com/portal/today`,
    `</a>`,
    `</td></tr>`,
  ].join("");
}

// ── Main renderer ─────────────────────────────────────────────────────

export interface RenderOptions {
  now?: Date;
  previewLimit?: number;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  rendered: number; // cards actually placed in the email body
  pacificDateISO: string;
}

export function renderDigestEmail(
  queue: ContractQueue,
  options: RenderOptions = {},
): RenderedEmail {
  const now = options.now ?? new Date();
  const parts = pacificDateParts(now);
  const previewLimit = options.previewLimit ?? PREVIEW_LIMIT;

  const cards = queue.queue.slice(0, previewLimit);
  const rendered = cards.length;
  const total = queue.total;

  const cardsHtml =
    rendered === 0
      ? emptyStateHtml(parts)
      : cards.map(cardHtml).join("");

  const subject = buildSubject(rendered, parts);

  // Hidden preheader — first thing many clients show next to the subject
  // in the inbox list. Mirrors the summary strip without dominating the
  // visible layout.
  const preheader =
    total === 0
      ? `No follow-ups due for ${parts.weekday}.`
      : `${rendered} of ${total} follow-up${total === 1 ? "" : "s"} for ${parts.weekday}, ${parts.month} ${parts.day}.`;

  const html = [
    `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">`,
    `<html xmlns="http://www.w3.org/1999/xhtml" lang="en">`,
    `<head>`,
    `<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<meta name="x-apple-disable-message-reformatting">`,
    `<meta name="color-scheme" content="light only">`,
    `<meta name="supported-color-schemes" content="light">`,
    `<title>${escapeHtml(subject)}</title>`,
    `</head>`,
    `<body style="margin:0;padding:0;background:${COLORS.pageBg};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">`,

    // Preheader (hidden but indexable by mail clients)
    `<div style="display:none;font-size:1px;color:${COLORS.pageBg};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escapeHtml(preheader)}</div>`,

    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COLORS.pageBg};">`,
    `<tr><td align="center" style="padding:24px 12px 28px 12px;">`,

    // Outer 600px shell
    `<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:${COLORS.white};border-collapse:separate;">`,

    headerHtml(),
    summaryStripHtml(rendered, total, parts),

    // Cards padding wrapper
    `<tr><td style="padding:18px 20px 4px 20px;">`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">`,
    cardsHtml,
    fullQueueLinkHtml(rendered, total),
    `</table>`,
    `</td></tr>`,

    footerHtml(),

    `</table>`,
    `</td></tr></table>`,
    `</body>`,
    `</html>`,
  ].join("");

  return {
    subject,
    html,
    rendered,
    pacificDateISO: parts.pacificDateISO,
  };
}
