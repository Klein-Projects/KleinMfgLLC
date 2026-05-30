import { SupabaseClient } from "@supabase/supabase-js";
import { personalizePrompt } from "@/lib/portal/today-queue";

// ============================================================
// Phase 3 — Today engine rebuild (conversation-state driven)
//
// The original Today queue (lib/portal/today-queue.ts) walked a
// status-to-prompt cadence map and could surface the SAME lead several
// times with several different three-day follow-up messages. That engine
// still powers the Cowork-facing contract endpoint (/api/today-queue) and
// the 3pm digest, so it stays put.
//
// This module drives the in-portal /portal/today page off the Haiku
// classifier's per-lead output (migration 022):
//   - conversation_state  — one of the 8 states below
//   - suggested_prompt_id  — FK into prompt_templates (NULL = the
//                            classifier returned NEEDS_NEW_PROMPT)
//
// One row per lead → one card per lead. No duplicates.
// ============================================================

// The 8 classifier states. Canonical source is lib/portal/classify-lead.ts
// (CONVERSATION_STATES); duplicated here as a plain const so this module —
// imported by a server component and the nav badge — does not pull in the
// Anthropic SDK that classify-lead.ts instantiates at module scope.
export const CONVERSATION_STATES = [
  "awaiting_reply",
  "replied_affirmative",
  "replied_objection",
  "replied_not_interested",
  "samples_in_transit",
  "samples_received",
  "asked_question",
  "long_cold",
] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

// Lead statuses that never surface on Today, even when classified.
// won/lost are terminal — the conversation is over.
const EXCLUDED_STATUSES = ["won", "lost"] as const;

// Human label shown on each card's conversation_state badge.
export const STATE_LABELS: Record<ConversationState, string> = {
  awaiting_reply:         "Awaiting Reply",
  replied_affirmative:    "Replied — Interested",
  replied_objection:      "Objection",
  replied_not_interested: "Not Interested",
  samples_in_transit:     "Samples In Transit",
  samples_received:       "Samples Received",
  asked_question:         "Asked a Question",
  long_cold:              "Long Cold",
};

// Badge color per state, in Klein's palette (navy / red / amber / steel /
// green / orange). Tailwind classes applied directly on the badge span.
export const STATE_BADGE_CLASS: Record<ConversationState, string> = {
  awaiting_reply:         "bg-navy/10 text-navy",
  replied_affirmative:    "bg-green-100 text-green-800",
  replied_objection:      "bg-amber-100 text-amber-900",
  replied_not_interested: "bg-red/10 text-red",
  samples_in_transit:     "bg-orange-100 text-orange-800",
  samples_received:       "bg-green-100 text-green-800",
  asked_question:         "bg-navy/10 text-navy",
  long_cold:              "bg-steel/15 text-steel",
};

// ── Filter chips (requirement 3) ───────────────────────────────────────
//
// Five chips above the list. Each non-"all" chip groups one or more of the
// 8 states so the chips partition the whole queue (every state lands in
// exactly one chip) and the chip counts sum to the All count.
export type ChipKey =
  | "all"
  | "awaiting_reply"
  | "replied"
  | "objection"
  | "long_cold";

export interface ChipDef {
  key: ChipKey;
  label: string;
  states: ConversationState[] | null; // null = "all"
}

export const TODAY_CHIPS: ChipDef[] = [
  { key: "all", label: "All", states: null },
  {
    key: "awaiting_reply",
    label: "Awaiting Reply",
    states: ["awaiting_reply", "samples_in_transit"],
  },
  {
    key: "replied",
    label: "Replied",
    states: ["replied_affirmative", "samples_received", "asked_question"],
  },
  {
    key: "objection",
    label: "Objection",
    states: ["replied_objection", "replied_not_interested"],
  },
  { key: "long_cold", label: "Long Cold", states: ["long_cold"] },
];

export function isChipKey(value: string | undefined): value is ChipKey {
  return !!value && TODAY_CHIPS.some((c) => c.key === value);
}

export function chipForState(state: ConversationState): ChipKey {
  for (const chip of TODAY_CHIPS) {
    if (chip.states && chip.states.includes(state)) return chip.key;
  }
  return "all";
}

// Default sort priority. Leads that are waiting on Sean (a question, a warm
// reply, a delivered sample, an objection to handle) sort above the big
// "already messaged, just waiting" awaiting_reply pile and the cold tail.
const STATE_PRIORITY: Record<ConversationState, number> = {
  asked_question:         0,
  replied_affirmative:    1,
  samples_received:       2,
  replied_objection:      3,
  samples_in_transit:     4,
  awaiting_reply:         5,
  long_cold:              6,
  replied_not_interested: 7,
};

const PROMPT_CATEGORY_LABELS: Record<string, string> = {
  first_contact:   "First Contact",
  follow_up:       "Follow-Up",
  no_reply:        "No Reply",
  sample_followup: "Sample Follow-Up",
  won:             "Closed/Won",
  nurture:         "Nurture",
};

// ── Types ──────────────────────────────────────────────────────────────

interface LeadRow {
  id: string;
  status: string;
  conversation_state: string | null;
  suggested_prompt_id: string | null;
  state_confidence: number | null;
  state_reasoning: string | null;
  state_updated_at: string | null;
  wake_up_at: string | null;
  linkedin_url: string | null;
  linkedin_thread_id: string | null;
  email: string | null;
  contact: {
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    linkedin_url: string | null;
    email: string | null;
  } | null;
  company: { name: string | null } | null;
  // PostgREST embeds a to-one relationship as an object (or null). The FK
  // hint disambiguates leads.suggested_prompt_id → prompt_templates.id.
  suggested_prompt: {
    id: string;
    title: string;
    category: string;
    body: string;
  } | null;
}

interface InboundRow {
  lead_id: string;
  created_at: string;
  body: string | null;
  summary: string | null;
}

export interface TodayLeadCard {
  lead_id: string;
  status: string;
  conversation_state: ConversationState;
  state_confidence: number | null;
  state_reasoning: string | null;
  state_label: string;
  state_badge_class: string;
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
  // null only for NEEDS_NEW_PROMPT cards (the banner). Main-queue cards
  // always carry a personalized prompt body.
  prompt: {
    id: string;
    title: string;
    category: string;
    category_label: string;
    body_personalized: string;
  } | null;
  last_inbound: { preview: string; created_at: string } | null;
}

export interface TodayLeadsResult {
  cards: TodayLeadCard[]; // main queue (has a suggested prompt), pre-sorted
  needsNewPrompt: TodayLeadCard[]; // banner (classified, no prompt match)
  counts: Record<ChipKey, number>; // computed over the main queue
}

// ── Helpers ────────────────────────────────────────────────────────────

function initialsOf(first: string, last: string): string {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
}

export function linkedinUrlForParts(
  linkedinUrl: string | null,
  linkedinThreadId: string | null,
): string | null {
  if (linkedinUrl) return linkedinUrl;
  if (linkedinThreadId) {
    return `https://www.linkedin.com/messaging/thread/${linkedinThreadId}/`;
  }
  return null;
}

function toPreview(body: string | null, summary: string | null): string {
  const raw = (body || summary || "").replace(/\s+/g, " ").trim();
  if (raw.length <= 140) return raw;
  return raw.slice(0, 139).trimEnd() + "…";
}

function buildCard(lead: LeadRow, inbound: InboundRow | undefined): TodayLeadCard {
  const contact = lead.contact;
  const firstName = contact?.first_name ?? "";
  const lastName = contact?.last_name ?? "";
  const companyName = lead.company?.name ?? null;

  const linkedinUrl = lead.linkedin_url ?? contact?.linkedin_url ?? null;
  const email = lead.email ?? contact?.email ?? null;
  const linkedinThreadId = lead.linkedin_thread_id ?? null;
  const channel: TodayLeadCard["channel"] =
    linkedinUrl || linkedinThreadId ? "linkedin" : email ? "email" : "none";

  const state = lead.conversation_state as ConversationState;
  const prompt = lead.suggested_prompt;

  return {
    lead_id: lead.id,
    status: lead.status,
    conversation_state: state,
    state_confidence: lead.state_confidence,
    state_reasoning: lead.state_reasoning,
    state_label: STATE_LABELS[state] ?? state,
    state_badge_class: STATE_BADGE_CLASS[state] ?? "bg-navy/10 text-navy",
    contact: {
      first_name: firstName,
      last_name: lastName,
      full_name: `${firstName} ${lastName}`.trim() || "Unknown",
      initials: initialsOf(firstName, lastName) || "??",
      title: contact?.title ?? null,
    },
    company_name: companyName,
    channel,
    linkedin_url: linkedinUrl,
    linkedin_thread_id: linkedinThreadId,
    email,
    prompt: prompt
      ? {
          id: prompt.id,
          title: prompt.title,
          category: prompt.category,
          category_label:
            PROMPT_CATEGORY_LABELS[prompt.category] ?? prompt.category,
          body_personalized: personalizePrompt(
            prompt.body,
            firstName,
            companyName,
          ),
        }
      : null,
    last_inbound: inbound
      ? { preview: toPreview(inbound.body, inbound.summary), created_at: inbound.created_at }
      : null,
  };
}

function sortMainCards(cards: TodayLeadCard[]): void {
  cards.sort((a, b) => {
    const pa = STATE_PRIORITY[a.conversation_state] ?? 99;
    const pb = STATE_PRIORITY[b.conversation_state] ?? 99;
    if (pa !== pb) return pa - pb;
    // Freshest inbound reply first within a state; nulls sort last.
    const ta = a.last_inbound ? Date.parse(a.last_inbound.created_at) : -Infinity;
    const tb = b.last_inbound ? Date.parse(b.last_inbound.created_at) : -Infinity;
    if (ta !== tb) return tb - ta;
    return a.contact.full_name.localeCompare(b.contact.full_name);
  });
}

// ── Fetch ──────────────────────────────────────────────────────────────

export async function fetchTodayLeads(
  supabase: SupabaseClient,
): Promise<TodayLeadsResult> {
  const excluded = `(${EXCLUDED_STATUSES.join(",")})`;

  // (1) Join leads → prompt_templates on suggested_prompt_id. The embed is
  // a LEFT join (nullable FK), so NEEDS_NEW_PROMPT leads come back with
  // suggested_prompt === null and land in the banner.
  const { data: leadsData, error: leadsErr } = await supabase
    .from("leads")
    .select(
      `
      id, status, conversation_state, suggested_prompt_id,
      state_confidence, state_reasoning, state_updated_at, wake_up_at,
      linkedin_url, linkedin_thread_id, email,
      contact:contacts(first_name, last_name, title, linkedin_url, email),
      company:companies(name),
      suggested_prompt:prompt_templates!leads_suggested_prompt_id_fkey(id, title, category, body)
    `,
    )
    .not("conversation_state", "is", null)
    .not("status", "in", excluded);

  if (leadsErr) throw new Error(leadsErr.message);

  const nowMs = Date.now();
  const leads = ((leadsData ?? []) as unknown as LeadRow[]).filter((l) => {
    // Skip unknown/garbage states defensively.
    if (!CONVERSATION_STATES.includes(l.conversation_state as ConversationState)) {
      return false;
    }
    // Parked leads (wake_up_at in the future) stay hidden until they wake.
    if (l.wake_up_at && new Date(l.wake_up_at).getTime() > nowMs) return false;
    return true;
  });

  // (1, cont.) Pull each lead's most recent inbound message. One query for
  // all leads, ordered newest-first; the first row seen per lead wins.
  const latestInbound = new Map<string, InboundRow>();
  const leadIds = leads.map((l) => l.id);
  if (leadIds.length > 0) {
    const { data: inboundData, error: inboundErr } = await supabase
      .from("activities")
      .select("lead_id, created_at, body, summary")
      .eq("direction", "inbound")
      .in("lead_id", leadIds)
      .order("created_at", { ascending: false });
    if (inboundErr) throw new Error(inboundErr.message);
    for (const row of (inboundData ?? []) as InboundRow[]) {
      if (!row.lead_id) continue;
      if (!latestInbound.has(row.lead_id)) latestInbound.set(row.lead_id, row);
    }
  }

  const cards: TodayLeadCard[] = [];
  const needsNewPrompt: TodayLeadCard[] = [];
  for (const lead of leads) {
    const card = buildCard(lead, latestInbound.get(lead.id));
    // (4) NEEDS_NEW_PROMPT: classified but no template matched.
    if (card.prompt) cards.push(card);
    else needsNewPrompt.push(card);
  }

  sortMainCards(cards);
  needsNewPrompt.sort((a, b) =>
    a.contact.full_name.localeCompare(b.contact.full_name),
  );

  const counts = countByChip(cards);

  return { cards, needsNewPrompt, counts };
}

function countByChip(cards: TodayLeadCard[]): Record<ChipKey, number> {
  const counts: Record<ChipKey, number> = {
    all: cards.length,
    awaiting_reply: 0,
    replied: 0,
    objection: 0,
    long_cold: 0,
  };
  for (const card of cards) {
    const key = chipForState(card.conversation_state);
    if (key !== "all") counts[key] += 1;
  }
  return counts;
}

// Nav-badge count. Mirrors the page's main queue so the "Today" badge and
// the page agree. NEEDS_NEW_PROMPT (banner-only) leads are excluded.
export async function fetchTodayLeadCount(
  supabase: SupabaseClient,
): Promise<number> {
  const { cards } = await fetchTodayLeads(supabase);
  return cards.length;
}
