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

Conversation states (pick exactly one):
  awaiting_reply               — most recent message was outbound; no inbound reply.
  replied_affirmative          — they replied with positive interest.
  replied_objection            — they replied with a specific obstacle.
  replied_not_interested       — clear no, conversation should close.
  samples_in_transit           — samples shipped, not yet delivered.
  samples_received             — delivery confirmed, awaiting feedback.
  asked_question               — they asked a specific question that needs reply.
  long_cold                    — was previously engaged, 90+ days silent.

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
    .select("id, title")
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

  // Resolve the title to a prompt_templates.id. NEEDS_NEW_PROMPT and any
  // unrecognized title both yield NULL. Phase 3 distinguishes the
  // unrecognized case via state_updated_at IS NOT NULL.
  let suggestedPromptId: string | null = null;
  let matchedPrompt = false;
  if (suggestedTitle && suggestedTitle !== NEEDS_NEW_PROMPT) {
    const match = prompts.find((p) => p.title === suggestedTitle);
    if (match) {
      suggestedPromptId = match.id;
      matchedPrompt = true;
    }
    // If we didn't find a match, the classifier hallucinated a title
    // (or one was deleted between fetch and call) — treat as
    // NEEDS_NEW_PROMPT so the row goes into the banner instead of
    // pointing at a deleted/wrong template.
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
    suggested_prompt_title: matchedPrompt ? suggestedTitle : NEEDS_NEW_PROMPT,
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
