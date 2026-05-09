"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Copy,
  Clock,
  Check,
  AlertTriangle,
  Pencil,
  CheckCircle2,
} from "lucide-react";
import type { TodayCard } from "@/lib/portal/today-queue";
import { linkedinUrlFor } from "@/lib/portal/today-queue";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  engaged: "Engaged",
  sample_sent: "Sample Sent",
  quoted: "Quoted",
  nurture: "Nurture",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  new: "bg-navy/10 text-navy",
  contacted: "bg-navy/10 text-navy",
  engaged: "bg-navy/10 text-navy",
  sample_sent: "bg-orange-100 text-orange-800",
  quoted: "bg-green-100 text-green-800",
  nurture: "bg-navy/10 text-navy",
};

interface UndoState {
  message: string;
  payload: unknown;
  leadId: string;
}

const UNDO_WINDOW_SECONDS = 8;

export default function TodayCards({ cards }: { cards: TodayCard[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actioned, setActioned] = useState<
    Record<string, { stamp: string; nextDate?: string; status?: string }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(UNDO_WINDOW_SECONDS);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showUndo = useCallback((state: UndoState) => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndo(state);
    setUndoSeconds(UNDO_WINDOW_SECONDS);
  }, []);

  const dismissUndo = useCallback(() => {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    undoTimer.current = null;
    setUndo(null);
  }, []);

  // Tick the undo timer.
  useEffect(() => {
    if (!undo) return;
    if (undoSeconds <= 0) {
      dismissUndo();
      return;
    }
    undoTimer.current = setTimeout(
      () => setUndoSeconds((s) => s - 1),
      1000,
    );
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, [undo, undoSeconds, dismissUndo]);

  const onUndo = useCallback(async () => {
    if (!undo) return;
    const leadId = undo.leadId;
    dismissUndo();
    try {
      await fetch(`/api/leads/${leadId}/today-action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "undo", undo: undo.payload }),
      });
      setActioned((prev) => {
        const next = { ...prev };
        delete next[leadId];
        return next;
      });
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Undo failed");
    }
  }, [undo, dismissUndo, router]);

  const onPrimaryClick = useCallback(
    async (card: TodayCard) => {
      if (pendingId) return;
      const promptBody = card.recommended_prompt?.body_personalized;
      if (!promptBody) {
        setError("No recommended prompt available for this lead.");
        return;
      }
      const linkedinUrl = linkedinUrlFor(card);

      setPendingId(card.lead_id);
      setError(null);

      // Copy script first — must be inside the user-gesture handler.
      try {
        await navigator.clipboard.writeText(promptBody);
      } catch {
        // Fall through; logging still happens, but warn the user.
        setError("Couldn't copy to clipboard. Script logged anyway.");
      }

      // Open LinkedIn in a new tab while we still have the gesture.
      if (linkedinUrl) {
        window.open(linkedinUrl, "_blank", "noopener,noreferrer");
      }

      try {
        const res = await fetch(
          `/api/leads/${card.lead_id}/mark-contacted`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              prompt_id: card.recommended_prompt?.id ?? null,
              channel: card.channel,
              auto_log_summary: "Sent follow-up via Today page",
            }),
          },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        setActioned((prev) => ({
          ...prev,
          [card.lead_id]: {
            stamp: nowStamp(),
            nextDate: data.new_follow_up_date,
            status: data.new_status,
          },
        }));
        showUndo({
          message: `Logged contact for ${card.contact.full_name} · follow-up ${formatDateChip(
            data.new_follow_up_date,
          )}`,
          payload: data.undo,
          leadId: card.lead_id,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to log contact");
      } finally {
        setPendingId(null);
      }
    },
    [pendingId, showUndo],
  );

  const onSecondaryClick = useCallback(
    async (
      card: TodayCard,
      action: "snooze_3_days" | "skip_today" | "mark_not_interested",
    ) => {
      if (pendingId) return;
      setPendingId(card.lead_id);
      setError(null);
      try {
        const res = await fetch(
          `/api/leads/${card.lead_id}/today-action`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action }),
          },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        setActioned((prev) => ({
          ...prev,
          [card.lead_id]: {
            stamp: nowStamp(),
            nextDate: data.new_follow_up_date,
            status: data.new_status,
          },
        }));
        const verb =
          action === "snooze_3_days"
            ? "Snoozed"
            : action === "skip_today"
              ? "Skipped"
              : "Marked not interested";
        const tail =
          action === "mark_not_interested"
            ? ""
            : data.new_follow_up_date
              ? ` · follow-up ${formatDateChip(data.new_follow_up_date)}`
              : "";
        showUndo({
          message: `${verb} for ${card.contact.full_name}${tail}`,
          payload: data.undo,
          leadId: card.lead_id,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed");
      } finally {
        setPendingId(null);
      }
    },
    [pendingId, showUndo],
  );

  if (cards.length === 0) {
    return (
      <div className="mt-8 rounded-lg border border-dashed border-navy/20 bg-white p-10 text-center">
        <CheckCircle2 className="mx-auto h-9 w-9 text-green-500" />
        <p className="mt-3 text-base font-semibold text-navy">All caught up.</p>
        <p className="mt-1 text-sm text-steel">
          No follow-ups due today. Cowork's 3pm digest will be quiet too.
        </p>
      </div>
    );
  }

  const liveCards = cards.filter((c) => !actioned[c.lead_id]);
  const doneCards = cards.filter((c) => actioned[c.lead_id]);

  return (
    <div className="max-w-3xl">
      {error && (
        <div className="mt-4 rounded-md border border-red/30 bg-red/5 px-4 py-2 text-sm text-red">
          {error}
        </div>
      )}

      <div className="mt-4 space-y-4">
        {liveCards.map((card) => (
          <CardView
            key={card.lead_id}
            card={card}
            pending={pendingId === card.lead_id}
            onPrimary={() => onPrimaryClick(card)}
            onSecondary={(a) => onSecondaryClick(card, a)}
          />
        ))}
      </div>

      {doneCards.length > 0 && (
        <>
          <p className="mt-8 border-t border-dashed border-navy/15 pt-4 text-xs font-bold uppercase tracking-wider text-steel">
            Done today
          </p>
          <div className="mt-3 space-y-3">
            {doneCards.map((card) => {
              const meta = actioned[card.lead_id];
              return (
                <DoneCardView
                  key={card.lead_id}
                  card={card}
                  stamp={meta.stamp}
                  nextDate={meta.nextDate}
                  status={meta.status}
                />
              );
            })}
          </div>
        </>
      )}

      {undo && (
        <div
          role="status"
          className="fixed bottom-7 left-1/2 z-50 -translate-x-1/2 transform"
        >
          <div className="flex items-center gap-3 rounded-lg bg-navy px-4 py-2.5 pr-3 text-sm text-white shadow-2xl">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-white/30 text-[11px] font-bold text-white/80">
              {undoSeconds}
            </span>
            <span>{undo.message}</span>
            <button
              onClick={onUndo}
              className="ml-2 rounded border border-white/30 bg-white/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide hover:bg-white/20"
            >
              Undo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function CardView({
  card,
  pending,
  onPrimary,
  onSecondary,
}: {
  card: TodayCard;
  pending: boolean;
  onPrimary: () => void;
  onSecondary: (
    action: "snooze_3_days" | "skip_today" | "mark_not_interested",
  ) => void;
}) {
  const linkedinUrl = linkedinUrlFor(card);
  const overdueLabel = overdueText(card.days_overdue);
  const overdueClass = overdueChipClass(card.days_overdue);
  const statusLabel = STATUS_LABELS[card.status] ?? card.status;
  const statusClass =
    STATUS_BADGE_CLASS[card.status] ?? "bg-navy/10 text-navy";

  const canPrimary = !!card.recommended_prompt;
  const primaryLabel = linkedinUrl
    ? "Copy script + Open LinkedIn"
    : "Copy script";

  return (
    <article className="overflow-hidden rounded-lg border border-navy/10 bg-white shadow-sm">
      <div className="flex gap-3.5 border-b border-navy/10 px-5 pb-3 pt-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-navy text-sm font-bold text-white">
          {card.contact.initials}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/portal/leads/${card.lead_id}`}
            className="block text-base font-bold text-navy hover:underline"
          >
            {card.contact.full_name}
          </Link>
          <p className="mt-0.5 truncate text-sm text-steel">
            {card.contact.title ?? "—"}
            {card.company_name ? ` · ${card.company_name}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${overdueClass}`}
          >
            {overdueLabel}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusClass}`}
          >
            {statusLabel}
          </span>
        </div>
      </div>

      <div className="px-5 pb-3 pt-3.5">
        {card.recommended_prompt ? (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-navy/[0.06] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-navy">
                {card.recommended_prompt.category_label}
              </span>
              <span className="font-semibold text-charcoal">
                {card.recommended_prompt.title}
              </span>
            </div>
            <div className="whitespace-pre-wrap rounded-md border border-navy/10 bg-offwhite px-3.5 py-3 text-sm leading-relaxed text-charcoal">
              {card.recommended_prompt.body_personalized}
            </div>
          </>
        ) : (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-900">
            No prompt template found for status{" "}
            <code className="rounded bg-amber-100 px-1 py-0.5 text-xs">
              {card.status}
            </code>
            . Add one in the Prompt Library to enable one-click outreach.
          </div>
        )}

        {!linkedinUrl && (
          <div className="mt-2.5 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              No LinkedIn URL on file. Add one to enable one-click open, or
              copy the script and find them manually.
            </span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-navy/10 bg-[#FCFCFB] px-5 py-3.5">
        <button
          onClick={onPrimary}
          disabled={pending || !canPrimary}
          className="inline-flex items-center gap-1.5 rounded-md bg-red px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red/90 disabled:cursor-not-allowed disabled:bg-steel disabled:opacity-70"
        >
          {linkedinUrl ? (
            <Copy className="h-3.5 w-3.5" strokeWidth={2.4} />
          ) : (
            <Copy className="h-3.5 w-3.5" strokeWidth={2.4} />
          )}
          {primaryLabel}
        </button>
        {!linkedinUrl && (
          <Link
            href={`/portal/leads/${card.lead_id}`}
            className="inline-flex items-center gap-1.5 rounded-md border border-navy/20 bg-white px-3 py-2 text-sm font-semibold text-charcoal transition-colors hover:bg-offwhite"
          >
            <Pencil className="h-3.5 w-3.5" />
            Add LinkedIn URL
          </Link>
        )}
        <button
          onClick={() => onSecondary("snooze_3_days")}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-navy/20 bg-white px-3 py-2 text-sm font-semibold text-charcoal transition-colors hover:bg-offwhite disabled:opacity-50"
        >
          <Clock className="h-3.5 w-3.5" />
          Snooze 3 days
        </button>
        <button
          onClick={() => onSecondary("skip_today")}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-semibold text-steel transition-colors hover:text-red disabled:opacity-50"
        >
          Skip today
        </button>
        <span className="ml-auto" />
        <button
          onClick={() => onSecondary("mark_not_interested")}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-semibold text-steel transition-colors hover:text-red disabled:opacity-50"
        >
          Mark not interested
        </button>
      </div>
    </article>
  );
}

function DoneCardView({
  card,
  stamp,
  nextDate,
  status,
}: {
  card: TodayCard;
  stamp: string;
  nextDate?: string;
  status?: string;
}) {
  const showStatus = status && status !== card.status;
  return (
    <article className="overflow-hidden rounded-lg border border-navy/[0.06] bg-[#FAFAF9] shadow-sm">
      <div className="flex items-center gap-3.5 px-5 py-3.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-steel text-xs font-bold text-white">
          {card.contact.initials}
        </div>
        <div className="min-w-0 flex-1">
          <Link
            href={`/portal/leads/${card.lead_id}`}
            className="block text-sm font-bold text-steel hover:underline"
          >
            {card.contact.full_name}
          </Link>
          <p className="truncate text-xs text-steel">
            {card.contact.title ?? "—"}
            {card.company_name ? ` · ${card.company_name}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end text-right">
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700">
            <Check className="h-3.5 w-3.5" strokeWidth={2.6} />
            {stamp}
          </span>
          <span className="text-[11px] text-steel">
            {showStatus
              ? `Status → ${STATUS_LABELS[status!] ?? status}`
              : nextDate
                ? `Next: ${formatDateChip(nextDate)}`
                : ""}
          </span>
        </div>
      </div>
    </article>
  );
}

// ── Helpers ──

function nowStamp(): string {
  return new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function overdueText(daysOverdue: number): string {
  if (daysOverdue <= 0) return "Due today";
  if (daysOverdue === 1) return "1 day overdue";
  return `${daysOverdue} days overdue`;
}

function overdueChipClass(daysOverdue: number): string {
  if (daysOverdue <= 0) return "bg-navy/10 text-navy";
  if (daysOverdue <= 3) return "bg-amber-100 text-amber-800";
  return "bg-red/10 text-red";
}

function formatDateChip(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

