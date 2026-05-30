import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { todayInNY } from "@/lib/portal/today-queue";
import {
  fetchTodayLeads,
  isChipKey,
  TODAY_CHIPS,
  type ChipKey,
  type TodayLeadCard,
} from "@/lib/portal/today-conversation";
import { createClient } from "@/lib/supabase/server";
import CoworkActivityPanel from "@/components/portal/CoworkActivityPanel";
import TodayLeadCards from "./TodayLeadCards";

export const dynamic = "force-dynamic";

export default async function TodayPage({
  searchParams,
}: {
  searchParams: { filter?: string };
}) {
  const supabase = createClient();
  const todayISO = todayInNY();

  const { cards, needsNewPrompt, counts } = await fetchTodayLeads(supabase);

  const activeChip: ChipKey = isChipKey(searchParams.filter)
    ? searchParams.filter
    : "all";
  const activeDef = TODAY_CHIPS.find((c) => c.key === activeChip)!;
  const visibleCards = cards.filter((c) =>
    activeDef.states.includes(c.conversation_state),
  );

  const date = new Date(todayISO + "T00:00:00");
  const headerDate = date.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Today</h1>
        <p className="mt-1 text-sm text-steel">
          {headerDate} —{" "}
          {counts.all === 0
            ? "no leads need a response right now"
            : counts.all === 1
              ? "1 lead needs a response"
              : `${counts.all} leads need a response`}
        </p>
      </header>

      <CoworkActivityPanel />

      <div className="max-w-3xl">
        {needsNewPrompt.length > 0 && (
          <NeedsNewPromptBanner cards={needsNewPrompt} />
        )}

        <FilterChips active={activeChip} counts={counts} />

        <TodayLeadCards cards={visibleCards} />
      </div>
    </div>
  );
}

// ── Filter chips (URL-kept via ?filter=) ───────────────────────────────

function FilterChips({
  active,
  counts,
}: {
  active: ChipKey;
  counts: Record<ChipKey, number>;
}) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {TODAY_CHIPS.map((chip) => {
        const isActive = chip.key === active;
        const href = chip.key === "all" ? "/portal/today" : `/portal/today?filter=${chip.key}`;
        return (
          <Link
            key={chip.key}
            href={href}
            aria-current={isActive ? "true" : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
              isActive
                ? "border-navy bg-navy text-white"
                : "border-navy/20 bg-white text-navy hover:bg-navy/5"
            }`}
          >
            {chip.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold ${
                isActive ? "bg-white/20 text-white" : "bg-navy/10 text-navy"
              }`}
            >
              {counts[chip.key]}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

// ── NEEDS_NEW_PROMPT banner (requirement 4) ─────────────────────────────

function NeedsNewPromptBanner({ cards }: { cards: TodayLeadCard[] }) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-amber-300 bg-amber-50">
      <div className="flex items-start gap-2.5 border-b border-amber-200 px-4 py-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
        <div>
          <p className="text-sm font-bold text-amber-900">
            {cards.length} lead{cards.length === 1 ? "" : "s"} need a new prompt
            template
          </p>
          <p className="mt-0.5 text-xs text-amber-800">
            The classifier couldn&apos;t match an existing template to these
            conversations. Add a fitting template in{" "}
            <Link href="/portal/prompts" className="font-semibold underline">
              Prompts
            </Link>{" "}
            and re-run the classifier, and they&apos;ll move into the queue.
          </p>
        </div>
      </div>
      <ul className="divide-y divide-amber-200">
        {cards.map((card) => (
          <li key={card.lead_id} className="px-4 py-2.5">
            <div className="flex items-center gap-2">
              <Link
                href={`/portal/leads/${card.lead_id}`}
                className="text-sm font-semibold text-amber-900 hover:underline"
              >
                {card.contact.full_name}
              </Link>
              {card.company_name && (
                <span className="text-xs text-amber-700">
                  · {card.company_name}
                </span>
              )}
              <span
                className={`ml-auto rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${card.state_badge_class}`}
              >
                {card.state_label}
              </span>
            </div>
            {card.state_reasoning && (
              <p className="mt-0.5 text-xs italic text-amber-800">
                {card.state_reasoning}
              </p>
            )}
            {card.last_inbound && (
              <p className="mt-0.5 truncate text-xs text-amber-700">
                ↩ {card.last_inbound.preview}
              </p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
