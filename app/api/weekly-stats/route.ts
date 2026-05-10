import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// GET /api/weekly-stats — Phase 3
//
// Cowork-facing read endpoint. The Sunday 7pm ET digest task hits
// this every week to render Sean's weekly recap email.
//
// Query params:
//   week=last      — last Mon-Sun window that has fully ended (default).
//   week=current   — Mon through "now" of the current week.
//   week=YYYY-MM-DD — Mon-Sun window containing that date.
//
// Auth: Bearer COWORK_API_TOKEN, same env var as /api/today-queue and
// /api/inbox-sync. Service-role Supabase client; bypasses RLS.

type LeadStatus =
  | "new"
  | "invited"
  | "contacted"
  | "engaged"
  | "sample_sent"
  | "quoted"
  | "won"
  | "lost"
  | "nurture";

const ALL_STATUSES: LeadStatus[] = [
  "new",
  "invited",
  "contacted",
  "engaged",
  "sample_sent",
  "quoted",
  "won",
  "lost",
  "nurture",
];

function safeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

// Returns the Monday-of-week (00:00 UTC) for a given anchor Date.
// Treating weeks as UTC is intentional — the digest copy is a recap,
// not a deadline, and timezone-edge rounding doesn't matter at the
// granularity Sean cares about.
function mondayOf(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat. Want Monday.
  const day = out.getUTCDay();
  const diff = day === 0 ? 6 : day - 1;
  out.setUTCDate(out.getUTCDate() - diff);
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface ResolvedWeek {
  start: Date; // inclusive — Monday 00:00 UTC
  end: Date;   // inclusive end — Sunday 23:59:59.999 UTC
  startISO: string;
  endISO: string;
  label: string;
}

function resolveWeek(param: string | null): ResolvedWeek {
  const today = new Date();
  let mon: Date;
  let endMs: Date;

  if (param === "current") {
    mon = mondayOf(today);
    endMs = today;
  } else if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) {
    const anchor = new Date(param + "T00:00:00.000Z");
    mon = mondayOf(anchor);
    endMs = addDays(mon, 7);
    endMs.setUTCMilliseconds(-1);
  } else {
    // Default: 'last'. Last full Mon-Sun window — the one that ended
    // before today's Monday.
    const thisMon = mondayOf(today);
    mon = addDays(thisMon, -7);
    endMs = addDays(thisMon, -1);
    endMs.setUTCHours(23, 59, 59, 999);
  }

  const startISO = isoDate(mon);
  const endISODate = isoDate(endMs);

  // "Week of May 4" — short, human-friendly.
  const label = `Week of ${mon.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  })}`;

  return { start: mon, end: endMs, startISO, endISO: endISODate, label };
}

export async function GET(req: NextRequest) {
  // ── Auth ──
  const expected = process.env.COWORK_API_TOKEN;
  if (!expected) {
    return NextResponse.json(
      { error: "Server not configured (COWORK_API_TOKEN unset)" },
      { status: 500 },
    );
  }
  const auth = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  const token = match ? match[1].trim() : "";
  if (!token || !safeEqualString(token, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Window ──
  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");
  const week = resolveWeek(weekParam);

  // ── Supabase service client ──
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

  const startISO = week.start.toISOString();
  const endISO = week.end.toISOString();

  // ── Fetch ──
  const [
    activitiesRes,
    leadsCreatedRes,
    leadsAcceptedRes,
    leadsParkedRes,
    shipmentsCreatedRes,
    shipmentsDeliveredRes,
    sampleRequestsRes,
    allLeadsRes,
    promptsRes,
  ] = await Promise.all([
    supabase
      .from("activities")
      .select("id, lead_id, prompt_id, type, direction, created_at")
      .gte("created_at", startISO)
      .lte("created_at", endISO),
    supabase
      .from("leads")
      .select("id, status, created_at")
      .gte("created_at", startISO)
      .lte("created_at", endISO),
    supabase
      .from("leads")
      .select("id, status, connection_accepted_at")
      .gte("connection_accepted_at", startISO)
      .lte("connection_accepted_at", endISO),
    supabase
      .from("leads")
      .select("id, wake_up_at")
      .gte("wake_up_at", startISO)
      .lte("wake_up_at", "9998-12-31"), // exclude the indefinite sentinel from "parked this week" counts? include it.
    supabase
      .from("shipments")
      .select("id, lead_id, created_at, shipped_at, delivered_at")
      .gte("created_at", startISO)
      .lte("created_at", endISO),
    supabase
      .from("shipments")
      .select("id, lead_id, delivered_at")
      .gte("delivered_at", startISO)
      .lte("delivered_at", endISO),
    supabase
      .from("sample_requests")
      .select("id, created_at, status")
      .gte("created_at", startISO)
      .lte("created_at", endISO),
    supabase.from("leads").select("id, status"),
    supabase
      .from("prompt_templates")
      .select("id, title, category"),
  ]);

  for (const res of [
    activitiesRes,
    leadsCreatedRes,
    leadsAcceptedRes,
    leadsParkedRes,
    shipmentsCreatedRes,
    shipmentsDeliveredRes,
    sampleRequestsRes,
    allLeadsRes,
    promptsRes,
  ]) {
    if (res.error) {
      return NextResponse.json({ error: res.error.message }, { status: 500 });
    }
  }

  type ActivityRow = {
    id: string;
    lead_id: string | null;
    prompt_id: string | null;
    type: string;
    direction: "inbound" | "outbound" | null;
    created_at: string;
  };
  type LeadRow = { id: string; status: string };
  type PromptRow = { id: string; title: string; category: string };

  const activities = (activitiesRes.data ?? []) as ActivityRow[];
  const allLeads = (allLeadsRes.data ?? []) as LeadRow[];
  const prompts = (promptsRes.data ?? []) as PromptRow[];

  // ── Derive ──
  const connectionRequestsThisWeek = activities.filter(
    (a) => a.type === "connection_request" && a.direction === "outbound",
  ).length;
  const connectionsAcceptedThisWeek = (leadsAcceptedRes.data ?? []).length;
  const acceptRate =
    connectionRequestsThisWeek > 0
      ? connectionsAcceptedThisWeek / connectionRequestsThisWeek
      : null;

  const outboundMessages = activities.filter(
    (a) =>
      a.direction === "outbound" &&
      (a.type === "linkedin_message" || a.type === "email" || a.type === "follow_up"),
  ).length;
  const inboundReplies = activities.filter(
    (a) => a.direction === "inbound",
  ).length;
  const replyRate =
    outboundMessages > 0 ? inboundReplies / outboundMessages : null;

  // Pipeline current snapshot.
  const currentStatusCounts: Record<LeadStatus, number> = {
    new: 0, invited: 0, contacted: 0, engaged: 0, sample_sent: 0,
    quoted: 0, won: 0, lost: 0, nurture: 0,
  };
  for (const l of allLeads) {
    if ((ALL_STATUSES as string[]).includes(l.status)) {
      currentStatusCounts[l.status as LeadStatus]++;
    }
  }

  // Top prompts this week — by uses, then reply rate among uses.
  const usesByPrompt = new Map<string, number>();
  const repliesByPrompt = new Map<string, number>();
  // For per-prompt reply rate scoped to the week, count distinct leads
  // with both an outbound use AND an inbound activity in the window.
  const leadsByPromptOutbound = new Map<string, Set<string>>();
  const inboundLeadsThisWeek = new Set<string>();
  for (const a of activities) {
    if (a.direction === "inbound" && a.lead_id) {
      inboundLeadsThisWeek.add(a.lead_id);
    }
  }
  for (const a of activities) {
    if (!a.prompt_id) continue;
    usesByPrompt.set(a.prompt_id, (usesByPrompt.get(a.prompt_id) ?? 0) + 1);
    if (a.direction === "outbound" && a.lead_id) {
      let s = leadsByPromptOutbound.get(a.prompt_id);
      if (!s) leadsByPromptOutbound.set(a.prompt_id, (s = new Set()));
      s.add(a.lead_id);
    }
  }
  leadsByPromptOutbound.forEach((leadSet, promptId) => {
    let count = 0;
    leadSet.forEach((lid) => {
      if (inboundLeadsThisWeek.has(lid)) count++;
    });
    repliesByPrompt.set(promptId, count);
  });

  const promptById = new Map(prompts.map((p) => [p.id, p]));
  const topPrompts = Array.from(usesByPrompt.entries())
    .map(([id, uses]) => {
      const p = promptById.get(id);
      const leads = leadsByPromptOutbound.get(id)?.size ?? 0;
      const replies = repliesByPrompt.get(id) ?? 0;
      return {
        prompt_id: id,
        title: p?.title ?? "(deleted prompt)",
        category: p?.category ?? null,
        uses_this_week: uses,
        leads_touched_this_week: leads,
        replies_this_week: replies,
        reply_rate_this_week: leads > 0 ? replies / leads : null,
      };
    })
    .sort((a, b) => b.uses_this_week - a.uses_this_week)
    .slice(0, 5);

  return NextResponse.json({
    week: {
      start: week.startISO,
      end: week.endISO,
      label: week.label,
    },
    outreach: {
      connection_requests_sent: connectionRequestsThisWeek,
      connections_accepted: connectionsAcceptedThisWeek,
      accept_rate: acceptRate,
    },
    engagement: {
      outbound_messages: outboundMessages,
      inbound_replies: inboundReplies,
      reply_rate: replyRate,
    },
    samples: {
      sample_requests_received: (sampleRequestsRes.data ?? []).length,
      shipments_sent: (shipmentsCreatedRes.data ?? []).length,
      shipments_delivered: (shipmentsDeliveredRes.data ?? []).length,
    },
    pipeline: {
      leads_created: (leadsCreatedRes.data ?? []).length,
      leads_parked: (leadsParkedRes.data ?? []).length,
      current_status_counts: currentStatusCounts,
    },
    top_prompts: topPrompts,
  });
}
