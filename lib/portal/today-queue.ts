import { SupabaseClient } from "@supabase/supabase-js";

// Lead statuses excluded from the Today queue.
//   invited — Phase 1.5's outreach page owns this funnel slice.
//   won/lost — terminal states.
export const TODAY_EXCLUDED_STATUSES = ["invited", "won", "lost"] as const;

// Map lead status → prompt_templates.category, with fallback when the
// primary category has no prompts. Excluded statuses don't appear here.
export const STAGE_TO_PROMPT_CATEGORY: Record<
  string,
  { primary: string; fallback?: string }
> = {
  new:         { primary: "first_contact" },
  contacted:   { primary: "follow_up", fallback: "no_reply" },
  engaged:     { primary: "follow_up", fallback: "first_contact" },
  sample_sent: { primary: "sample_followup", fallback: "follow_up" },
  quoted:      { primary: "sample_followup", fallback: "follow_up" },
  nurture:     { primary: "nurture", fallback: "follow_up" },
};

export const PROMPT_CATEGORY_LABELS: Record<string, string> = {
  first_contact:   "First Contact",
  follow_up:       "Follow-Up",
  no_reply:        "No Reply",
  sample_followup: "Sample Follow-Up",
  won:             "Won",
  nurture:         "Nurture",
};

export interface PromptRow {
  id: string;
  category: string;
  title: string;
  body: string;
  use_count: number | null;
}

export interface TodayLead {
  id: string;
  status: string;
  follow_up_date: string;
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

export interface TodayCard {
  lead_id: string;
  status: string;
  follow_up_date: string;
  days_overdue: number;
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
  recommended_prompt: {
    id: string;
    title: string;
    category: string;
    category_label: string;
    body_personalized: string;
  } | null;
}

// Personalize a prompt body. Replaces [Name] with first_name and [Company]
// with the company name. Falls back to a generic placeholder when blank.
export function personalizePrompt(
  body: string,
  firstName: string | null,
  companyName: string | null,
): string {
  return body
    .replace(/\[Name\]/g, firstName || "there")
    .replace(/\[Company\]/g, companyName || "your team");
}

function dayDiff(isoA: string, isoB: string): number {
  const a = new Date(isoA + "T00:00:00").getTime();
  const b = new Date(isoB + "T00:00:00").getTime();
  return Math.round((a - b) / 86_400_000);
}

function initialsOf(first: string, last: string): string {
  return `${first?.[0] ?? ""}${last?.[0] ?? ""}`.toUpperCase();
}

// Pick the recommended prompt for a stage. Highest use_count wins, with
// alphabetical title as a deterministic tiebreaker. Falls through to
// the fallback category when the primary returns zero prompts.
export function pickRecommendedPrompt(
  status: string,
  prompts: PromptRow[],
): PromptRow | null {
  const map = STAGE_TO_PROMPT_CATEGORY[status];
  if (!map) return null;

  const sorter = (a: PromptRow, b: PromptRow) => {
    const aCount = a.use_count ?? 0;
    const bCount = b.use_count ?? 0;
    if (aCount !== bCount) return bCount - aCount;
    return a.title.localeCompare(b.title);
  };

  const primary = prompts
    .filter((p) => p.category === map.primary)
    .sort(sorter);
  if (primary.length > 0) return primary[0];

  if (map.fallback) {
    const fallback = prompts
      .filter((p) => p.category === map.fallback)
      .sort(sorter);
    if (fallback.length > 0) return fallback[0];
  }

  return null;
}

// Today's date in America/New_York, formatted as YYYY-MM-DD. The Today
// queue and the 3pm digest both run on Sean's east-coast working day.
export function todayInNY(): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(new Date());
}

// Build a single TodayCard from a lead row + prompt list. Pure function —
// callers are responsible for filtering out excluded statuses upstream.
export function buildTodayCard(
  lead: TodayLead,
  prompts: PromptRow[],
  todayISO: string,
): TodayCard {
  const contact = lead.contact;
  const firstName = contact?.first_name ?? "";
  const lastName = contact?.last_name ?? "";

  // Lead-level columns (Phase 1 denormalization) take precedence over
  // contact-level columns when both are populated.
  const linkedinUrl = lead.linkedin_url ?? contact?.linkedin_url ?? null;
  const email = lead.email ?? contact?.email ?? null;
  const linkedinThreadId = lead.linkedin_thread_id ?? null;

  const channel: TodayCard["channel"] = linkedinUrl || linkedinThreadId
    ? "linkedin"
    : email
      ? "email"
      : "none";

  const prompt = pickRecommendedPrompt(lead.status, prompts);

  return {
    lead_id: lead.id,
    status: lead.status,
    follow_up_date: lead.follow_up_date,
    days_overdue: Math.max(0, dayDiff(todayISO, lead.follow_up_date)),
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
    recommended_prompt: prompt
      ? {
          id: prompt.id,
          title: prompt.title,
          category: prompt.category,
          category_label: PROMPT_CATEGORY_LABELS[prompt.category] ?? prompt.category,
          body_personalized: personalizePrompt(
            prompt.body,
            firstName,
            lead.company?.name ?? null,
          ),
        }
      : null,
  };
}

// Build a LinkedIn DM URL from a thread id when no profile URL is set.
// LinkedIn thread URLs follow:
//   https://www.linkedin.com/messaging/thread/<id>/
export function linkedinUrlFor(card: TodayCard): string | null {
  if (card.linkedin_url) return card.linkedin_url;
  if (card.linkedin_thread_id) {
    return `https://www.linkedin.com/messaging/thread/${card.linkedin_thread_id}/`;
  }
  return null;
}

// Fetch the full Today queue for a user-scoped Supabase client. Returns
// cards ordered by follow_up_date asc (oldest overdue first).
export async function fetchTodayQueue(
  supabase: SupabaseClient,
  options: { todayISO?: string; limit?: number } = {},
): Promise<TodayCard[]> {
  const todayISO = options.todayISO ?? todayInNY();
  const limit = options.limit ?? 100;

  const [leadsRes, promptsRes] = await Promise.all([
    supabase
      .from("leads")
      .select(
        `
        id,
        status,
        follow_up_date,
        email,
        linkedin_url,
        linkedin_thread_id,
        phone,
        contact:contacts(id, first_name, last_name, title, email, linkedin_url, phone),
        company:companies(id, name)
      `,
      )
      .lte("follow_up_date", todayISO)
      .not("status", "in", `(${TODAY_EXCLUDED_STATUSES.join(",")})`)
      .order("follow_up_date", { ascending: true })
      .limit(limit),

    supabase
      .from("prompt_templates")
      .select("id, category, title, body, use_count"),
  ]);

  if (leadsRes.error) throw new Error(leadsRes.error.message);
  if (promptsRes.error) throw new Error(promptsRes.error.message);

  const leads = (leadsRes.data ?? []) as unknown as TodayLead[];
  const prompts = (promptsRes.data ?? []) as PromptRow[];

  return leads.map((l) => buildTodayCard(l, prompts, todayISO));
}

// Live count of leads on the Today queue, used by the sidebar badge.
export async function fetchTodayCount(
  supabase: SupabaseClient,
  options: { todayISO?: string } = {},
): Promise<number> {
  const todayISO = options.todayISO ?? todayInNY();
  const { count, error } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .lte("follow_up_date", todayISO)
    .not("status", "in", `(${TODAY_EXCLUDED_STATUSES.join(",")})`);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
