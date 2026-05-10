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

  return <ReviewQueuePageClient items={(rows as unknown as QueueItem[]) ?? []} />;
}
