import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { fetchPromptAnalytics } from "@/lib/portal/prompt-analytics";
import AnalyticsTable from "./AnalyticsTable";

export const dynamic = "force-dynamic";

// /portal/prompts/analytics — Phase 3
//
// Server-side computes per-prompt metrics from activities + leads
// + shipments, then hands a sortable client table the rows. No
// schema changes — everything derived from existing tables.

export default async function PromptAnalyticsPage() {
  const supabase = createClient();
  const { rows } = await fetchPromptAnalytics(supabase);

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <Link
          href="/portal/prompts"
          className="inline-flex items-center gap-1 text-xs font-semibold text-steel hover:text-navy"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Prompt Library
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-navy">Prompt Analytics</h1>
        <p className="mt-1 text-sm text-steel">
          Performance per template across every lead it has ever touched.
          Click a column header to sort. First Contact prompts also show
          connection-request acceptance rate and median days to accept.
        </p>
      </header>

      <AnalyticsTable rows={rows} />
    </div>
  );
}
