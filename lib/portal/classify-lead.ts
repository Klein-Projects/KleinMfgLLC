import { SupabaseClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

// ── Conversation state enum (Phase 0, Decision 1) ──────────────────────
//
// Plain-text in Postgres so we can extend without a migration, but the
// classify path validates against this list and rejects anything else
// (which means the classifier hit a hallucinated state — we'd rather
// see a 500 in the logs than silently store garbage on the lead row).
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

// Sentinel the classifier may return for suggested_prompt when no
// existing template fits the conversation. We store this as a NULL
// suggested_prompt_id (with state_updated_at set), and Phase 3 surfaces
// these leads in a "needs new prompt" banner.
export const NEEDS_NEW_PROMPT = "NEEDS_NEW_PROMPT";

const HAIKU_MODEL = "claude-haiku-4-5";

// ── Appendix A — Haiku classifier system prompt ────────────────────────
//
// Verbatim from the Klein Conversation-Aware Build Plan v2 (May 16, 2026).
// The "Available prompt template titles" line is replaced at runtime
// with the live list of titles from prompt_templates.
function buildSystemPrompt(titles: string[]): string {
  const titleBlock = titles.length
    ? titles.map((t) => `  - ${t}`).join("\n")
    : "  (no templates available — return NEEDS_NEW_PROMPT)";
  return `You are classifying the current conversation state of a sales lead for Klein Manufacturing, a US manufacturer of handcrafted phenolic scrapers used in aircraft maintenance. The customer is Sean Klein, the owner. The leads are mostly Directors of Maintenance, Chief Pilots, MRO leadership, A&P shop owners, and aircraft detailing franchise owners.

Your job: read the lead's recent activity log and output exactly one conversation state, a suggested prompt template title, a confidence score, and a one-sentence reason.

RULE 1 (overrides everything else): If the direction of the MOST RECENT activity is OUTBOUND from Sean, the state is awaiting_reply — UNLESS shipment status forces samples_in_transit or samples_received. Do not classify as asked_question under any circumstance when the most recent activity is outbound. Determine the most recent activity's direction FIRST, then choose the state. This is a mechanical rule, not a judgment call: an outbound message that contains a question from Sean (for an address, a meeting time, clarification, anything) is still awaiting_reply.

Conversation states (pick exactly one):
  awaiting_reply
    The most recent activity in this thread is OUTBOUND from Sean, and
    no inbound activity has been received since. This state takes
    precedence over asked_question whenever Sean's outbound is the
    most recent message — the assumption is Sean's outbound either
    answered the prospect's last question or moved the ball forward,
    and we are now waiting on them.
  replied_affirmative
    The most recent activity is INBOUND and expresses positive interest
    (e.g. "yes, send samples", or shares a shipping address).
  replied_objection
    The most recent activity is INBOUND and raises a specific obstacle
    (already have a vendor, price, not the buyer for tools, etc.) — the
    door is not fully closed.
  replied_not_interested
    The most recent activity is INBOUND and is a clear no; the
    conversation should close. Be conservative — a polite "not right
    now" is replied_objection, not this.
  samples_in_transit
    Samples have shipped but delivery is not yet confirmed. Keyed off
    the shipment status, not message direction.
  samples_received
    Delivery is confirmed and Sean is awaiting feedback; there is no
    unanswered inbound question sitting on top.
  asked_question
    The most recent activity is INBOUND, and that inbound contains a
    direct question (request for info, clarification, pricing, samples,
    etc.) that Sean has NOT yet answered. If the most recent activity is
    OUTBOUND from Sean, classify as awaiting_reply regardless of whether
    the prior inbound contained a question. The question must come FROM
    the prospect, not from Sean. Questions Sean asks the prospect (e.g.
    for a shipping address, for a meeting time, for clarification) do not
    count — those are part of an outbound message and the resulting state
    is awaiting_reply.
  long_cold
    Was previously engaged but has been silent 90+ days, with no recent
    inbound or outbound to act on.

Worked example (correctly classified as awaiting_reply, NOT asked_question):
  Activity 1 (outbound, Apr 23): Sean's connection-intro message
  Activity 2 (inbound, May 4): "Good day, I might be interested,
    could you please send some information? Thanks"
  Activity 3 (outbound, May 4): Sean replied with product info and
    asked for the prospect's shipping address
  Correct state: awaiting_reply
  Correct reason: "Sean's May 4 outbound is the most recent activity;
    no inbound has been received since."
  Incorrect (do not do this): classifying as asked_question because
    Sean's outbound contains a question to the prospect. Sean's
    questions to the prospect never produce asked_question — they
    produce awaiting_reply.

Available prompt template titles (use the EXACT title shown, or ${NEEDS_NEW_PROMPT}):
${titleBlock}

Input: lead metadata + last 5 activities in chronological order.

Output JSON only, no prose:
  {"conversation_state":"...","suggested_prompt":"...","confidence":0.0-1.0,"reason":"..."}

Rules:
  - Confidence reflects how unambiguous the state is from the activity history.
  - If no existing prompt fits, set suggested_prompt to ${NEEDS_NEW_PROMPT}.
  - Be conservative on replied_not_interested. A polite "not right now" is closer to replied_objection than not_interested.
  - Treat any inbound message containing a US street address as replied_affirmative if samples were offered upstream.`;
}

// ── Types ──────────────────────────────────────────────────────────────

interface LeadRow {
  id: string;
  status: string;
  source: string | null;
  invited_at: string | null;
  connection_accepted_at: string | null;
  last_activity_at: string | null;
  wake_up_at: string | null;
  contact: {
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    linkedin_profile_text: string | null;
  } | null;
  company: { name: string | null } | null;
}

interface ActivityRow {
  id: string;
  created_at: string;
  type: string;
  direction: string | null;
  summary: string | null;
  body: string | null;
  outcome: string | null;
}

interface PromptRow {
  id: string;
  title: string;
  default_for_state: string | null;
}

interface ClassifierJson {
  conversation_state: string;
  suggested_prompt: string;
  confidence: number;
  reason: string;
}

export interface ClassifyResult {
  lead_id: string;
  conversation_state: ConversationState;
  suggested_prompt_id: string | null;
  suggested_prompt_title: string;
  state_confidence: number;
  state_reasoning: string;
  state_updated_at: string;
  matched_prompt: boolean;
}

export class ClassifyError extends Error {
  public readonly httpStatus: number;
  constructor(message: string, httpStatus: number) {
    super(message);
    this.httpStatus = httpStatus;
  }
}

// ── Core: fetch context, call Haiku, persist, return result ────────────

export async function classifyLead(
  supabase: SupabaseClient,
  leadId: string,
): Promise<ClassifyResult> {
  // Lead with contact + company (used in the user message we send to Haiku).
  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select(
      `id, status, source, invited_at, connection_accepted_at,
       last_activity_at, wake_up_at,
       contact:contacts(first_name, last_name, title, linkedin_profile_text),
       company:companies(name)`,
    )
    .eq("id", leadId)
    .maybeSingle();
  if (leadErr) throw new ClassifyError(leadErr.message, 500);
  if (!lead) throw new ClassifyError(`Lead ${leadId} not found`, 404);

  // Last 5 activities for this lead, newest first. The classifier sees
  // them in chronological (oldest→newest) order so "most recent" reads
  // naturally at the bottom.
  const { data: activitiesDesc, error: actErr } = await supabase
    .from("activities")
    .select("id, created_at, type, direction, summary, body, outcome")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(5);
  if (actErr) throw new ClassifyError(actErr.message, 500);
  const activities = ((activitiesDesc ?? []) as ActivityRow[]).slice().reverse();

  // All prompt templates — id + title only for now. Phase 4 adds
  // default_for_state mapping; this endpoint stays the same.
  const { data: promptsData, error: promptsErr } = await supabase
    .from("prompt_templates")
    .select("id, title, default_for_state")
    .order("title", { ascending: true });
  if (promptsErr) throw new ClassifyError(promptsErr.message, 500);
  const prompts = (promptsData ?? []) as PromptRow[];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new ClassifyError("Server not configured (ANTHROPIC_API_KEY unset)", 500);
  }
  const anthropic = new Anthropic({ apiKey });

  const titles = prompts.map((p) => p.title);
  const systemPrompt = buildSystemPrompt(titles);
  const userMessage = renderUserMessage(lead as unknown as LeadRow, activities);

  // Haiku call. max_tokens kept tight — the JSON response is small.
  let raw: string;
  try {
    const resp = await anthropic.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 512,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    });
    raw = resp.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Haiku call failed";
    throw new ClassifyError(`Classifier model error: ${msg}`, 502);
  }

  const parsed = parseClassifierJson(raw);
  if (!CONVERSATION_STATES.includes(parsed.conversation_state as ConversationState)) {
    throw new ClassifyError(
      `Classifier returned unknown conversation_state: ${parsed.conversation_state}`,
      502,
    );
  }
  const conversationState = parsed.conversation_state as ConversationState;
  const confidence = clampConfidence(parsed.confidence);
  const reasoning = (parsed.reason ?? "").toString().slice(0, 500);
  const suggestedTitle = (parsed.suggested_prompt ?? "").toString();

  // Resolve the suggested prompt to a prompt_templates.id, in order
  // (Phase 4 Step 2):
  //   1. exact title match on what the classifier returned
  //   2. the state-level default — the template whose default_for_state
  //      equals this lead's conversation_state. Covers both the
  //      NEEDS_NEW_PROMPT sentinel and any unrecognized/hallucinated or
  //      since-deleted title.
  //   3. neither resolves → NULL → NEEDS_NEW_PROMPT banner (distinguished
  //      from never-classified via state_updated_at IS NOT NULL).
  // The classifier's STATE output stays source-of-truth; the fallback
  // only fills the prompt.
  let suggestedPromptId: string | null = null;
  let resolvedTitle: string = NEEDS_NEW_PROMPT;
  let matchedPrompt = false;

  if (suggestedTitle && suggestedTitle !== NEEDS_NEW_PROMPT) {
    const byTitle = prompts.find((p) => p.title === suggestedTitle);
    if (byTitle) {
      suggestedPromptId = byTitle.id;
      resolvedTitle = byTitle.title;
      matchedPrompt = true;
    }
  }
  if (!suggestedPromptId) {
    const byState = prompts.find(
      (p) => p.default_for_state === conversationState,
    );
    if (byState) {
      suggestedPromptId = byState.id;
      resolvedTitle = byState.title;
      matchedPrompt = true;
    }
  }

  const stateUpdatedAt = new Date().toISOString();

  // Persist. Service-role or authenticated supabase client — caller's
  // choice (we don't care which auth context wrote the row).
  const { error: updErr } = await supabase
    .from("leads")
    .update({
      conversation_state: conversationState,
      suggested_prompt_id: suggestedPromptId,
      state_confidence: confidence,
      state_reasoning: reasoning,
      state_updated_at: stateUpdatedAt,
    })
    .eq("id", leadId);
  if (updErr) throw new ClassifyError(updErr.message, 500);

  return {
    lead_id: leadId,
    conversation_state: conversationState,
    suggested_prompt_id: suggestedPromptId,
    suggested_prompt_title: resolvedTitle,
    state_confidence: confidence,
    state_reasoning: reasoning,
    state_updated_at: stateUpdatedAt,
    matched_prompt: matchedPrompt,
  };
}

// ── helpers ────────────────────────────────────────────────────────────

function renderUserMessage(lead: LeadRow, activities: ActivityRow[]): string {
  const contactName = lead.contact
    ? [lead.contact.first_name, lead.contact.last_name].filter(Boolean).join(" ").trim()
    : "";
  const headerLines: string[] = [
    `Lead status: ${lead.status}`,
    `Contact: ${contactName || "(unknown)"}${lead.contact?.title ? ` — ${lead.contact.title}` : ""}`,
    `Company: ${lead.company?.name ?? "(unknown)"}`,
    `Source: ${lead.source ?? "(unknown)"}`,
  ];
  if (lead.invited_at) headerLines.push(`Invited at: ${lead.invited_at}`);
  if (lead.connection_accepted_at) {
    headerLines.push(`Connection accepted at: ${lead.connection_accepted_at}`);
  }
  if (lead.last_activity_at) {
    headerLines.push(`Last activity at: ${lead.last_activity_at}`);
  }
  if (lead.contact?.linkedin_profile_text) {
    headerLines.push(`LinkedIn headline: ${lead.contact.linkedin_profile_text}`);
  }

  const activityBlock =
    activities.length === 0
      ? "(no activity yet)"
      : activities
          .map((a, i) => {
            const dir = a.direction ? ` [${a.direction}]` : "";
            const text = (a.body || a.summary || "").trim();
            const outcome = a.outcome ? `\n      outcome: ${a.outcome}` : "";
            return `  ${i + 1}. ${a.created_at} — ${a.type}${dir}\n      ${text || "(no text)"}${outcome}`;
          })
          .join("\n");

  return `Lead metadata:
${headerLines.map((l) => `  ${l}`).join("\n")}

Last ${activities.length} activities (chronological, oldest first):
${activityBlock}

Return the JSON now.`;
}

function parseClassifierJson(raw: string): ClassifierJson {
  // Haiku is usually well-behaved with "Output JSON only" but cope with
  // a stray ```json fence or surrounding prose by extracting the first
  // {...} block.
  let text = raw.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new ClassifyError(`Classifier returned non-JSON: ${truncate(raw, 200)}`, 502);
  }
  const slice = text.slice(firstBrace, lastBrace + 1);
  let obj: unknown;
  try {
    obj = JSON.parse(slice);
  } catch (e) {
    throw new ClassifyError(`Classifier JSON parse failed: ${truncate(raw, 200)}`, 502);
  }
  if (!obj || typeof obj !== "object") {
    throw new ClassifyError(`Classifier JSON not an object: ${truncate(raw, 200)}`, 502);
  }
  const o = obj as Record<string, unknown>;
  return {
    conversation_state: String(o.conversation_state ?? ""),
    suggested_prompt: String(o.suggested_prompt ?? ""),
    confidence: typeof o.confidence === "number" ? o.confidence : Number(o.confidence ?? 0),
    reason: String(o.reason ?? ""),
  };
}

function clampConfidence(c: number): number {
  if (Number.isNaN(c) || !Number.isFinite(c)) return 0;
  if (c < 0) return 0;
  if (c > 1) return 1;
  return Math.round(c * 1000) / 1000;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + "…";
}
