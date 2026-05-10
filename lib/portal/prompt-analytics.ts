import { SupabaseClient } from "@supabase/supabase-js";

// Computes per-prompt performance metrics from activities + leads
// + shipments. Used by /portal/prompts/analytics (full table) and
// /portal/prompts (badges on cards above the usage threshold).
//
// Definitions
//   uses               — count of activities tagged with this prompt_id
//                        (any direction, any type).
//   leads_used         — distinct leads.id touched by those activities.
//   reply_rate         — fraction of leads_used where any inbound activity
//                        post-dates the most recent outbound use of this
//                        prompt. Drives the "+X% reply rate" badge.
//   conv_to_sample_rate — fraction of leads_used that ever advanced to
//                         sample_sent (or beyond — quoted/won) OR
//                         have a shipment row.
//   conv_to_won_rate   — fraction of leads_used currently at won.
//   accept_rate        — first_contact prompts only. Fraction of leads
//                        whose connection_request activity used this
//                        prompt AND whose lead.connection_accepted_at
//                        is non-null.
//   median_days_to_accept — first_contact prompts only. Median of
//                           (lead.connection_accepted_at - activity.created_at)
//                           in whole days, for accepted leads only.
//
// Badge threshold (BADGE_MIN_USES) intentionally low: Sean's volume
// is small and we want metrics to surface as soon as the data has
// any signal. Tune up as the dataset grows.
export const BADGE_MIN_USES = 5;

const ADVANCED_STATUSES = new Set(["sample_sent", "quoted", "won"]);

export type PromptCategory =
  | "first_contact"
  | "follow_up"
  | "no_reply"
  | "sample_followup"
  | "won"
  | "nurture";

export interface PromptAnalyticsRow {
  prompt_id: string;
  title: string;
  category: PromptCategory;
  uses: number;
  leads_used: number;
  reply_count: number;
  reply_rate: number | null;          // null when leads_used === 0
  conv_to_sample_count: number;
  conv_to_sample_rate: number | null;
  conv_to_won_count: number;
  conv_to_won_rate: number | null;
  accept_rate: number | null;         // first_contact only; null otherwise
  accepted_count: number;             // first_contact only
  median_days_to_accept: number | null;
  // Convenience flags for the UI.
  badges: {
    show_reply_rate: boolean;
    show_accept_rate: boolean;
  };
}

export interface PromptAnalyticsResult {
  rows: PromptAnalyticsRow[];
  byId: Record<string, PromptAnalyticsRow>;
}

interface PromptRow {
  id: string;
  title: string;
  category: string;
}

interface ActivityRow {
  lead_id: string | null;
  prompt_id: string | null;
  type: string;
  direction: "inbound" | "outbound" | null;
  created_at: string;
}

interface LeadRow {
  id: string;
  status: string;
  connection_accepted_at: string | null;
}

interface ShipmentRow {
  lead_id: string | null;
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function dayDiff(laterISO: string, earlierISO: string): number {
  const a = new Date(laterISO).getTime();
  const b = new Date(earlierISO).getTime();
  return Math.round((a - b) / 86_400_000);
}

export function computePromptAnalytics(input: {
  prompts: PromptRow[];
  activities: ActivityRow[];
  leads: LeadRow[];
  shipments: ShipmentRow[];
}): PromptAnalyticsResult {
  const { prompts, activities, leads, shipments } = input;

  // Build lead → status map and the set of leads with any shipment.
  const leadById = new Map<string, LeadRow>();
  for (const l of leads) leadById.set(l.id, l);
  const leadsWithShipment = new Set<string>();
  for (const s of shipments) {
    if (s.lead_id) leadsWithShipment.add(s.lead_id);
  }

  // Bucket activities by prompt_id, plus a global per-lead inbound
  // timestamp index used by the reply-rate calculation.
  const activitiesByPrompt = new Map<string, ActivityRow[]>();
  const inboundByLead = new Map<string, number[]>(); // ISO ms timestamps
  for (const a of activities) {
    if (a.lead_id && a.direction === "inbound") {
      let arr = inboundByLead.get(a.lead_id);
      if (!arr) inboundByLead.set(a.lead_id, (arr = []));
      arr.push(new Date(a.created_at).getTime());
    }
    if (!a.prompt_id) continue;
    let arr = activitiesByPrompt.get(a.prompt_id);
    if (!arr) activitiesByPrompt.set(a.prompt_id, (arr = []));
    arr.push(a);
  }

  const rows: PromptAnalyticsRow[] = [];
  for (const p of prompts) {
    const acts = activitiesByPrompt.get(p.id) ?? [];

    const leadsUsed = new Set<string>();
    const lastOutboundUseByLead = new Map<string, number>(); // ms
    const connectionRequestsByLead = new Map<string, number>(); // earliest ms per lead
    for (const a of acts) {
      if (!a.lead_id) continue;
      leadsUsed.add(a.lead_id);
      if (a.direction === "outbound") {
        const t = new Date(a.created_at).getTime();
        const prev = lastOutboundUseByLead.get(a.lead_id);
        if (prev === undefined || t > prev) {
          lastOutboundUseByLead.set(a.lead_id, t);
        }
      }
      if (a.type === "connection_request" && a.lead_id) {
        const t = new Date(a.created_at).getTime();
        const prev = connectionRequestsByLead.get(a.lead_id);
        if (prev === undefined || t < prev) {
          connectionRequestsByLead.set(a.lead_id, t);
        }
      }
    }

    let replyCount = 0;
    let convToSampleCount = 0;
    let convToWonCount = 0;
    leadsUsed.forEach((leadId) => {
      const lead = leadById.get(leadId);
      if (!lead) return;

      const lastOut = lastOutboundUseByLead.get(leadId);
      if (lastOut !== undefined) {
        const inbounds = inboundByLead.get(leadId) ?? [];
        if (inbounds.some((t) => t > lastOut)) replyCount++;
      }

      if (
        ADVANCED_STATUSES.has(lead.status) ||
        leadsWithShipment.has(leadId)
      ) {
        convToSampleCount++;
      }
      if (lead.status === "won") convToWonCount++;
    });

    const isFirstContact = p.category === "first_contact";
    let acceptedCount = 0;
    const daysToAccept: number[] = [];
    if (isFirstContact) {
      connectionRequestsByLead.forEach((requestMs, leadId) => {
        const lead = leadById.get(leadId);
        if (!lead?.connection_accepted_at) return;
        acceptedCount++;
        daysToAccept.push(
          dayDiff(lead.connection_accepted_at, new Date(requestMs).toISOString()),
        );
      });
    }

    const denom = leadsUsed.size;
    const acceptDenom = connectionRequestsByLead.size;

    const replyRate = denom > 0 ? replyCount / denom : null;
    const acceptRate =
      isFirstContact && acceptDenom > 0 ? acceptedCount / acceptDenom : null;

    const row: PromptAnalyticsRow = {
      prompt_id: p.id,
      title: p.title,
      category: p.category as PromptCategory,
      uses: acts.length,
      leads_used: denom,
      reply_count: replyCount,
      reply_rate: replyRate,
      conv_to_sample_count: convToSampleCount,
      conv_to_sample_rate: denom > 0 ? convToSampleCount / denom : null,
      conv_to_won_count: convToWonCount,
      conv_to_won_rate: denom > 0 ? convToWonCount / denom : null,
      accept_rate: acceptRate,
      accepted_count: acceptedCount,
      median_days_to_accept: median(daysToAccept),
      badges: {
        show_reply_rate:
          acts.length >= BADGE_MIN_USES && replyRate !== null,
        show_accept_rate:
          isFirstContact &&
          acceptDenom >= BADGE_MIN_USES &&
          acceptRate !== null,
      },
    };
    rows.push(row);
  }

  const byId: Record<string, PromptAnalyticsRow> = {};
  for (const r of rows) byId[r.prompt_id] = r;

  return { rows, byId };
}

// Server-side fetcher used by the analytics page (called directly)
// and the cookie-auth /api/prompt-analytics endpoint (called via fetch).
export async function fetchPromptAnalytics(
  supabase: SupabaseClient,
): Promise<PromptAnalyticsResult> {
  const [promptsRes, activitiesRes, leadsRes, shipmentsRes] = await Promise.all(
    [
      supabase.from("prompt_templates").select("id, title, category"),
      supabase
        .from("activities")
        .select("lead_id, prompt_id, type, direction, created_at"),
      supabase.from("leads").select("id, status, connection_accepted_at"),
      supabase.from("shipments").select("lead_id"),
    ],
  );

  if (promptsRes.error) throw new Error(promptsRes.error.message);
  if (activitiesRes.error) throw new Error(activitiesRes.error.message);
  if (leadsRes.error) throw new Error(leadsRes.error.message);
  if (shipmentsRes.error) throw new Error(shipmentsRes.error.message);

  return computePromptAnalytics({
    prompts: (promptsRes.data ?? []) as PromptRow[],
    activities: (activitiesRes.data ?? []) as ActivityRow[],
    leads: (leadsRes.data ?? []) as LeadRow[],
    shipments: (shipmentsRes.data ?? []) as ShipmentRow[],
  });
}
