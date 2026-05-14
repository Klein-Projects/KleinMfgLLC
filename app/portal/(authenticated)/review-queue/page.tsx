import { createClient } from "@/lib/supabase/server";
import ReviewQueuePageClient from "./ReviewQueuePageClient";

export const dynamic = "force-dynamic";

// /portal/review-queue — Phase 2
//
// Lists pending review_queue rows from the LinkedIn scrapers
// (10pm sent-invitations + 7am DM inbox), grouped by kind.
// Approve/reject buttons hit the Phase 2 endpoints. Stage-change
// rows that came from invited→contacted/engaged reconciliation
// get a distinct visual treatment (the build plan calls these out
// as "reconciliation items" — they're the highest-trust proposals
// because they're near-deterministic, but Sean still confirms each
// one until trust is earned).

export interface QueueItem {
  id: string;
  created_at: string;
  kind: "new_lead" | "new_activity" | "stage_change" | "update_contact" | "set_wake_up";
  source: string;
  payload: Record<string, unknown>;
  lead_id: string | null;
  linkedin_thread_id: string | null;
  lead: {
    id: string;
    status: string;
    contact: {
      first_name: string | null;
      last_name: string | null;
    } | null;
    company: { name: string | null } | null;
  } | null;
}

export default async function ReviewQueuePage() {
  const supabase = createClient();

  const { data: rows, error } = await supabase
    .from("review_queue")
    .select(
      `
      id, created_at, kind, source, payload, lead_id, linkedin_thread_id,
      lead:leads(
        id, status,
        contact:contacts(first_name, last_name),
        company:companies(name)
      )
    `,
    )
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    return (
      <div className="px-6 py-8 lg:px-8">
        <h1 className="text-2xl font-bold text-navy">Review Queue</h1>
        <div className="mt-4 rounded-md border border-red bg-red/10 px-4 py-3 text-sm font-semibold text-red">
          Failed to load queue: {error.message}
        </div>
      </div>
    );
  }

  const items = (rows as unknown as QueueItem[]) ?? [];

  // Second pass: scraped new_activity / stage_change rows arrive with
  // lead_id=null because the scraper stages them by linkedin_thread_id
  // and lets the approve step resolve. Until then, the FK join above
  // returns no lead so the row reads as "Activity" with no recipient.
  // Resolve those by thread_id here so the UI can show "To: X" / "From: X".
  const threadIds = Array.from(
    new Set(
      items
        .filter((it) => !it.lead && it.linkedin_thread_id)
        .map((it) => it.linkedin_thread_id as string),
    ),
  );
  if (threadIds.length > 0) {
    const { data: byThread } = await supabase
      .from("leads")
      .select(
        `id, status, linkedin_thread_id,
         contact:contacts(first_name, last_name),
         company:companies(name)`,
      )
      .in("linkedin_thread_id", threadIds);

    const threadMap = new Map<string, QueueItem["lead"]>();
    for (const r of (byThread ?? []) as unknown as Array<
      QueueItem["lead"] & { linkedin_thread_id: string }
    >) {
      if (r?.linkedin_thread_id) {
        const { linkedin_thread_id: _drop, ...rest } = r as any;
        threadMap.set(r.linkedin_thread_id, rest as QueueItem["lead"]);
      }
    }
    for (const it of items) {
      if (!it.lead && it.linkedin_thread_id) {
        const resolved = threadMap.get(it.linkedin_thread_id);
        if (resolved) it.lead = resolved;
      }
    }
  }

  return <ReviewQueuePageClient items={items} />;
}
