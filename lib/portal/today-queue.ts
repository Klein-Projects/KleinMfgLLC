import { SupabaseClient } from "@supabase/supabase-js";

// Lead statuses that never surface on the Today queue.
//   won/lost — terminal.
//   invited — Phase 1.5's outreach page owns this slice; the lead has not
//             accepted yet, so no cadence trigger fires.
//   engaged/quoted — Sean handles these conversations in real time, not
//             through a daily forcing function.
//   nurture — manual touches only.
export const TODAY_EXCLUDED_STATUSES = [
  "won",
  "lost",
  "invited",
  "engaged",
  "quoted",
  "nurture",
] as const;

// ── Types ──────────────────────────────────────────────────────────────

export type TriggerEvent = "connection_accepted" | "sample_delivered";
export type ActionOnSend = "none" | "mark_lost";

export interface CadenceRule {
  id: string;
  name: string;
  trigger_event: TriggerEvent;
  days_after_trigger: number;
  action_on_send: ActionOnSend;
  active: boolean;
  display_order: number;
  prompt: { id: string; title: string; category: string; body: string };
}

interface LeadRow {
  id: string;
  status: string;
  connection_accepted_at: string | null;
  email: string | null;
  linkedin_url: string | null;
  linkedin_thread_id: string | null;
  phone: string | null;
  contact: {
    id: string;
    first_name: string;
    last_name: string;
    title: string | null;
    email: string | null;
    linkedin_url: string | null;
    phone: string | null;
  } | null;
  company: { id: string; name: string } | null;
}

interface ActivityRow {
  lead_id: string;
  created_at: string;
  direction: "inbound" | "outbound";
  prompt_id: string | null;
}

interface ShipmentRow {
  lead_id: string;
  delivered_at: string;
}

export interface TodayCard {
  lead_id: string;
  status: string;
  contact: {
    first_name: string;
    last_name: string;
    full_name: string;
    initials: string;
    title: string | null;
  };
  company_name: string | null;
  channel: "linkedin" | "email" | "none";
  linkedin_url: string | null;
  linkedin_thread_id: string | null;
  email: string | null;
  rule: {
    id: string;
    name: string;
    trigger_event: TriggerEvent;
    days_after_trigger: number;
    action_on_send: ActionOnSend;
  };
  trigger: {
    event: TriggerEvent;
    date: string; // ISO date
    days_since: number;
    days_overdue: number; // days_since - days_after_trigger
  };
  recommended_prompt: {
    id: string;
    title: string;
    category: string;
    category_label: string;
    body_personalized: string;
  };
}

const PROMPT_CATEGORY_LABELS: Record<string, string> = {
  first_contact:   "First Contact",
  follow_up:       "Follow-Up",
  no_reply:        "No Reply",
  sample_followup: "Sample Follow-Up",
  won:             "Closed/Won",
  nurture:         "Nurture",
};

// ── Helpers ────────────────────────────────────────────────────────────

export function personalizePrompt(
  body: string,
  firstName: string | null,
  companyName: string | null,
): string {
  return body
    .replace(/\[Name\]/g, firstName || "there")
    .replace(/\[Company\]/g, companyName || "your team");
}

export function todayInNY(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function dayDiffISO(laterISO: string, earlierISO: string): number {
  const a = new Date(laterISO + "T00:00:00").getTime();
  const b = new Date(earlierISO + "T00:00:00").getTime();
  return Math.round((a - b) / 86_400_000);
}

function toISODate(timestamptz: string): string {
  return timestamptz.slice(0, 10);
}

function initialsOf(first: string, last: string): string {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
}

export function linkedinUrlFor(card: TodayCard): string | null {
  if (card.linkedin_url) return card.linkedin_url;
  if (card.linkedin_thread_id) {
    return `https://www.linkedin.com/messaging/thread/${card.linkedin_thread_id}/`;
  }
  return null;
}

// ── Reply detection ────────────────────────────────────────────────────

// Returns true when the lead has an inbound activity strictly after its
// most recent outbound activity. If there are no outbound activities at
// all and any inbound exists, also true. The cadence engine never
// surfaces these — they're conversations Sean is already handling.
function hasResponded(activities: ActivityRow[]): boolean {
  let lastOutbound = -Infinity;
  let lastInbound = -Infinity;
  for (const a of activities) {
    const t = new Date(a.created_at).getTime();
    if (a.direction === "outbound" && t > lastOutbound) lastOutbound = t;
    if (a.direction === "inbound" && t > lastInbound) lastInbound = t;
  }
  if (lastInbound === -Infinity) return false;
  return lastInbound > lastOutbound;
}

// ── Card construction ──────────────────────────────────────────────────

function buildCard(
  lead: LeadRow,
  rule: CadenceRule,
  triggerDateISO: string,
  todayISO: string,
): TodayCard {
  const contact = lead.contact;
  const firstName = contact?.first_name ?? "";
  const lastName = contact?.last_name ?? "";

  const linkedinUrl = lead.linkedin_url ?? contact?.linkedin_url ?? null;
  const email = lead.email ?? contact?.email ?? null;
  const linkedinThreadId = lead.linkedin_thread_id ?? null;

  const channel: TodayCard["channel"] = linkedinUrl || linkedinThreadId
    ? "linkedin"
    : email
      ? "email"
      : "none";

  const daysSince = dayDiffISO(todayISO, triggerDateISO);

  return {
    lead_id: lead.id,
    status: lead.status,
    contact: {
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`.trim() || "Unknown",
      initials: initialsOf(firstName, lastName) || "??",
      title: contact?.title ?? null,
    },
    company_name: lead.company?.name ?? null,
    channel,
    linkedin_url: linkedinUrl,
    linkedin_thread_id: linkedinThreadId,
    email,
    rule: {
      id: rule.id,
      name: rule.name,
      trigger_event: rule.trigger_event,
      days_after_trigger: rule.days_after_trigger,
      action_on_send: rule.action_on_send,
    },
    trigger: {
      event: rule.trigger_event,
      date: triggerDateISO,
      days_since: daysSince,
      days_overdue: daysSince - rule.days_after_trigger,
    },
    recommended_prompt: {
      id: rule.prompt.id,
      title: rule.prompt.title,
      category: rule.prompt.category,
      category_label:
        PROMPT_CATEGORY_LABELS[rule.prompt.category] ?? rule.prompt.category,
      body_personalized: personalizePrompt(
        rule.prompt.body,
        firstName,
        lead.company?.name ?? null,
      ),
    },
  };
}

// ── Engine ─────────────────────────────────────────────────────────────

interface EngineInput {
  leads: LeadRow[];
  activitiesByLead: Map<string, ActivityRow[]>;
  shipmentsByLead: Map<string, ShipmentRow[]>;
  rules: CadenceRule[];
  todayISO: string;
}

export function evaluateQueue(input: EngineInput): TodayCard[] {
  const { leads, activitiesByLead, shipmentsByLead, rules, todayISO } = input;

  const rulesByTrigger: Record<TriggerEvent, CadenceRule[]> = {
    connection_accepted: [],
    sample_delivered: [],
  };
  for (const r of rules) {
    if (!r.active) continue;
    rulesByTrigger[r.trigger_event].push(r);
  }

  const cards: TodayCard[] = [];

  for (const lead of leads) {
    const acts = activitiesByLead.get(lead.id) ?? [];

    // Skip the entire lead if they've replied since the last outbound.
    if (hasResponded(acts)) continue;

    // Resolve trigger dates available for this lead.
    const triggerDates: Partial<Record<TriggerEvent, string>> = {};
    if (lead.connection_accepted_at) {
      triggerDates.connection_accepted = toISODate(lead.connection_accepted_at);
    }
    const ships = shipmentsByLead.get(lead.id) ?? [];
    if (ships.length > 0) {
      // Most recent delivered shipment.
      const latest = ships.reduce((best, s) =>
        new Date(s.delivered_at) > new Date(best.delivered_at) ? s : best,
      );
      triggerDates.sample_delivered = toISODate(latest.delivered_at);
    }

    // Track best (smallest days_after_trigger) due, not-yet-fired rule.
    let chosen:
      | { rule: CadenceRule; triggerDate: string }
      | null = null;

    for (const trigger of ["connection_accepted", "sample_delivered"] as const) {
      const triggerDate = triggerDates[trigger];
      if (!triggerDate) continue;

      const daysSince = dayDiffISO(todayISO, triggerDate);

      for (const rule of rulesByTrigger[trigger]) {
        if (rule.days_after_trigger > daysSince) continue; // not due yet

        // Already-fired check: an outbound activity for this lead, dated
        // after the trigger, using this rule's prompt_id.
        const fired = acts.some(
          (a) =>
            a.direction === "outbound" &&
            a.prompt_id === rule.prompt.id &&
            new Date(a.created_at) >= new Date(triggerDate + "T00:00:00"),
        );
        if (fired) continue;

        if (
          !chosen ||
          rule.days_after_trigger < chosen.rule.days_after_trigger
        ) {
          chosen = { rule, triggerDate };
        }
      }
    }

    if (!chosen) continue;
    cards.push(buildCard(lead, chosen.rule, chosen.triggerDate, todayISO));
  }

  // Sort by overdue desc (most overdue first), then by lead full_name asc
  // for determinism within ties.
  cards.sort((a, b) => {
    if (a.trigger.days_overdue !== b.trigger.days_overdue) {
      return b.trigger.days_overdue - a.trigger.days_overdue;
    }
    return a.contact.full_name.localeCompare(b.contact.full_name);
  });

  return cards;
}

// ── Public fetchers ────────────────────────────────────────────────────

async function fetchEngineInputs(
  supabase: SupabaseClient,
  todayISO: string,
): Promise<EngineInput> {
  const excluded = `(${TODAY_EXCLUDED_STATUSES.join(",")})`;

  const [leadsRes, rulesRes] = await Promise.all([
    supabase
      .from("leads")
      .select(
        `
        id, status, connection_accepted_at,
        email, linkedin_url, linkedin_thread_id, phone,
        contact:contacts(id, first_name, last_name, title, email, linkedin_url, phone),
        company:companies(id, name)
      `,
      )
      .not("status", "in", excluded),
    supabase
      .from("cadence_rules")
      .select(
        "id, name, trigger_event, days_after_trigger, action_on_send, active, display_order, prompt:prompt_templates(id, title, category, body)",
      )
      .eq("active", true),
  ]);

  if (leadsRes.error) throw new Error(leadsRes.error.message);
  if (rulesRes.error) throw new Error(rulesRes.error.message);

  const leads = (leadsRes.data ?? []) as unknown as LeadRow[];
  const rules = (rulesRes.data ?? []) as unknown as CadenceRule[];

  if (leads.length === 0 || rules.length === 0) {
    return {
      leads,
      rules,
      activitiesByLead: new Map(),
      shipmentsByLead: new Map(),
      todayISO,
    };
  }

  const leadIds = leads.map((l) => l.id);

  const [actsRes, shipsRes] = await Promise.all([
    supabase
      .from("activities")
      .select("lead_id, created_at, direction, prompt_id")
      .in("lead_id", leadIds),
    supabase
      .from("shipments")
      .select("lead_id, delivered_at")
      .in("lead_id", leadIds)
      .not("delivered_at", "is", null),
  ]);

  if (actsRes.error) throw new Error(actsRes.error.message);
  if (shipsRes.error) throw new Error(shipsRes.error.message);

  const activitiesByLead = new Map<string, ActivityRow[]>();
  for (const a of (actsRes.data ?? []) as ActivityRow[]) {
    if (!a.lead_id) continue;
    let bucket = activitiesByLead.get(a.lead_id);
    if (!bucket) activitiesByLead.set(a.lead_id, (bucket = []));
    bucket.push(a);
  }

  const shipmentsByLead = new Map<string, ShipmentRow[]>();
  for (const s of (shipsRes.data ?? []) as ShipmentRow[]) {
    if (!s.lead_id) continue;
    let bucket = shipmentsByLead.get(s.lead_id);
    if (!bucket) shipmentsByLead.set(s.lead_id, (bucket = []));
    bucket.push(s);
  }

  return { leads, rules, activitiesByLead, shipmentsByLead, todayISO };
}

export async function fetchTodayQueue(
  supabase: SupabaseClient,
  options: { todayISO?: string } = {},
): Promise<TodayCard[]> {
  const todayISO = options.todayISO ?? todayInNY();
  const inputs = await fetchEngineInputs(supabase, todayISO);
  return evaluateQueue(inputs);
}

export async function fetchTodayCount(
  supabase: SupabaseClient,
  options: { todayISO?: string } = {},
): Promise<number> {
  const cards = await fetchTodayQueue(supabase, options);
  return cards.length;
}
