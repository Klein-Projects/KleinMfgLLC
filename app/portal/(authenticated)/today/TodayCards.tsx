"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Copy,
  Check,
  AlertTriangle,
  Pencil,
  CheckCircle2,
  Moon,
  X,
  CalendarCheck,
} from "lucide-react";
import type { TodayCard } from "@/lib/portal/today-queue";
import { linkedinUrlFor } from "@/lib/portal/today-queue";
import ParkLeadModal from "@/components/portal/ParkLeadModal";

const STATUS_LABELS: Record<string, string> = {
  new: "New",
  invited: "Invited",
  contacted: "Contacted",
  sample_sent: "Sample Sent",
};

const STATUS_BADGE_CLASS: Record<string, string> = {
  new: "bg-navy/10 text-navy",
  invited: "bg-amber-100 text-amber-900",
  contacted: "bg-navy/10 text-navy",
  sample_sent: "bg-orange-100 text-orange-800",
};

const TRIGGER_SHORT_LABEL: Record<string, string> = {
  connection_accepted: "Accepted",
  sample_delivered:    "Delivered",
};

const UNDO_WINDOW_SECONDS = 8;

// Catch-up mode toggle.
//
// When AUTO_LOG_ON_PRIMARY is true (original behavior): clicking
// "Copy script + Open LinkedIn" copies the script, opens LinkedIn,
// AND immediately POSTs to /api/leads/:id/mark-contacted, moving
// the card to Done. Good once Sean is back in normal cadence and
// trusts that every primary click means he's actually sending.
//
// When false (catch-up mode, current setting): the primary button
// only copies + opens. Sean checks LinkedIn to see whether he's
// already messaged the person off-portal, then comes back and
// either clicks "Already sent" (backdate) or "Mark contacted"
// (log at now). The card stays in Today until he actively logs.
//
// Sean asked for catch-up mode while he works through the backlog
// of leads where the 3-day message went out off-portal weeks ago.
// Flip this back to true once the catch-up batch is cleared.
const AUTO_LOG_ON_PRIMARY = false;

interface UndoState {
  message: string;
  payload: unknown;
  leadId: string;
}

export default function TodayCards({ cards }: { cards: TodayCard[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actioned, setActioned] = useState<
    Record<
      string,
      { stamp: string; ruleName?: string; markedLost?: boolean }
    >
  >({});
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(UNDO_WINDOW_SECONDS);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingLinkedInFor, setEditingLinkedInFor] =
    useState<TodayCard | null>(null);
  const [parkingFor, setParkingFor] = useState<TodayCard | null>(null);

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

  // Shared "log this send via mark-contacted" routine. Used by the
  // auto-log primary click (when enabled), the explicit "Mark contacted"
  // secondary button, and the "Already sent" backdate flow.
  const logSendForCard = useCallback(
    async (card: TodayCard, sentAtISO: string | null) => {
      const isBackdate = sentAtISO !== null;
      const body: Record<string, unknown> = {
        rule_id: card.rule.id,
        prompt_id: card.recommended_prompt.id,
        channel: card.channel,
        action_on_send: card.rule.action_on_send,
        auto_log_summary: isBackdate
          ? `Backfilled "${card.rule.name}" (sent off-portal)`
          : `Sent via "${card.rule.name}"`,
      };
      if (isBackdate) body.sent_at = sentAtISO;

      const res = await fetch(
        `/api/leads/${card.lead_id}/mark-contacted`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      const markedLost = card.rule.action_on_send === "mark_lost";
      const stampLabel = isBackdate
        ? formatStampForSentAt(sentAtISO!)
        : nowStamp();
      setActioned((prev) => ({
        ...prev,
        [card.lead_id]: {
          stamp: stampLabel,
          ruleName: card.rule.name,
          markedLost,
        },
      }));
      showUndo({
        message: isBackdate
          ? `Logged "${card.rule.name}" for ${card.contact.full_name} as sent ${stampLabel}`
          : markedLost
            ? `Logged "${card.rule.name}" for ${card.contact.full_name} · marked Lost`
            : `Logged "${card.rule.name}" for ${card.contact.full_name}`,
        payload: data.undo,
        leadId: card.lead_id,
      });
      if (isBackdate) {
        // Backdating may flip the lead to a later-stage rule whose
        // window has already opened; refresh so it re-surfaces with
        // the right prompt instead of disappearing.
        router.refresh();
      }
    },
    [router, showUndo],
  );

  const onPrimaryClick = useCallback(
    async (card: TodayCard) => {
      if (pendingId) return;
      const promptBody = card.recommended_prompt.body_personalized;
      const linkedinUrl = linkedinUrlFor(card);

      setPendingId(card.lead_id);
      setError(null);

      try {
        await navigator.clipboard.writeText(promptBody);
      } catch {
        setError(
          AUTO_LOG_ON_PRIMARY
            ? "Couldn't copy to clipboard. Script logged anyway."
            : "Couldn't copy to clipboard.",
        );
      }

      if (linkedinUrl) {
        window.open(linkedinUrl, "_blank", "noopener,noreferrer");
      }

      // In catch-up mode (AUTO_LOG_ON_PRIMARY=false) we stop here.
      // Sean confirms the send manually via "Mark contacted" or
      // "Already sent" after checking LinkedIn.
      if (!AUTO_LOG_ON_PRIMARY) {
        setPendingId(null);
        return;
      }

      try {
        await logSendForCard(card, null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to log contact");
      } finally {
        setPendingId(null);
      }
    },
    [pendingId, logSendForCard],
  );

  const onMarkContacted = useCallback(
    async (card: TodayCard) => {
      if (pendingId) return;
      setPendingId(card.lead_id);
      setError(null);
      try {
        await logSendForCard(card, null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to log contact");
      } finally {
        setPendingId(null);
      }
    },
    [pendingId, logSendForCard],
  );

  const onAlreadySent = useCallback(
    async (card: TodayCard, sentAtISO: string) => {
      if (pendingId) return;
      setPendingId(card.lead_id);
      setError(null);
      try {
        await logSendForCard(card, sentAtISO);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to backfill");
      } finally {
        setPendingId(null);
      }
    },
    [pendingId, logSendForCard],
  );

  const onMarkNotInterested = useCallback(
    async (card: TodayCard) => {
      if (pendingId) return;
      setPendingId(card.lead_id);
      setError(null);
      try {
        const res = await fetch(
          `/api/leads/${card.lead_id}/today-action`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "mark_not_interested" }),
          },
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        setActioned((prev) => ({
          ...prev,
          [card.lead_id]: { stamp: nowStamp(), markedLost: true },
        }));
        showUndo({
          message: `Marked ${card.contact.full_name} not interested`,
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
          No cadence rules are due today. Cowork's 3pm digest will be quiet too.
        </p>
      </div>
    );
  }

  const liveCards = cards.filter((c) => !actioned[c.lead_id]);
  const doneCards = cards.filter((c) => actioned[c.lead_id]);

  return (
    <div className="max-w-3xl">
      {!AUTO_LOG_ON_PRIMARY && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-bold uppercase tracking-wide text-[11px] mr-2">
            Catch-up mode
          </span>
          The primary button only copies the script and opens LinkedIn — it
          does <span className="font-semibold">not</span> auto-log the send.
          After checking the LinkedIn thread, click{" "}
          <span className="font-semibold">Mark contacted</span> if you just
          sent it, or <span className="font-semibold">Already sent</span> to
          backdate a message you sent off-portal. Flip back to auto-log later
          by setting <code className="rounded bg-amber-100 px-1 py-0.5 text-[12px]">AUTO_LOG_ON_PRIMARY = true</code>{" "}
          in <code className="rounded bg-amber-100 px-1 py-0.5 text-[12px]">TodayCards.tsx</code>.
        </div>
      )}

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
            onMarkContacted={() => onMarkContacted(card)}
            onMarkNotInterested={() => onMarkNotInterested(card)}
            onAddLinkedIn={() => setEditingLinkedInFor(card)}
            onPark={() => setParkingFor(card)}
            onAlreadySent={(sentAtISO) => onAlreadySent(card, sentAtISO)}
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
                  ruleName={meta.ruleName}
                  markedLost={meta.markedLost}
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

      {editingLinkedInFor && (
        <AddLinkedInModal
          card={editingLinkedInFor}
          onClose={() => setEditingLinkedInFor(null)}
          onSaved={() => {
            setEditingLinkedInFor(null);
            router.refresh();
          }}
        />
      )}

      {parkingFor && (
        <ParkLeadModal
          leadId={parkingFor.lead_id}
          leadName={parkingFor.contact.full_name}
          onClose={() => setParkingFor(null)}
          onSaved={() => {
            setParkingFor(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function CardView({
  card,
  pending,
  onPrimary,
  onMarkContacted,
  onMarkNotInterested,
  onAddLinkedIn,
  onPark,
  onAlreadySent,
}: {
  card: TodayCard;
  pending: boolean;
  onPrimary: () => void;
  onMarkContacted: () => void;
  onMarkNotInterested: () => void;
  onAddLinkedIn: () => void;
  onPark: () => void;
  onAlreadySent: (sentAtISO: string) => void;
}) {
  const [showSentPicker, setShowSentPicker] = useState(false);
  const [sentDate, setSentDate] = useState<string>(() => isoDateToday());
  const linkedinUrl = linkedinUrlFor(card);
  const overdueLabel = overdueText(card.trigger.days_overdue);
  const overdueClass = overdueChipClass(card.trigger.days_overdue);
  const statusLabel = STATUS_LABELS[card.status] ?? card.status;
  const statusClass =
    STATUS_BADGE_CLASS[card.status] ?? "bg-navy/10 text-navy";
  const triggerLabel = TRIGGER_SHORT_LABEL[card.trigger.event] ?? card.trigger.event;

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
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-red/[0.06] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-red">
            {card.rule.name}
          </span>
          <span className="text-steel">
            {triggerLabel} {formatDateChip(card.trigger.date)} · day {card.trigger.days_since}
          </span>
          {card.rule.action_on_send === "mark_lost" && (
            <span className="rounded-full bg-red/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red">
              Marks lost on send
            </span>
          )}
        </div>

        <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded bg-navy/[0.06] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-navy">
            {card.recommended_prompt.category_label}
          </span>
          <span className="font-semibold text-charcoal">
            {card.recommended_prompt.title}
          </span>
        </div>
        <div className="mt-2 whitespace-pre-wrap rounded-md border border-navy/10 bg-offwhite px-3.5 py-3 text-sm leading-relaxed text-charcoal">
          {card.recommended_prompt.body_personalized}
        </div>

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
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md bg-red px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-red/90 disabled:cursor-not-allowed disabled:bg-steel disabled:opacity-70"
        >
          <Copy className="h-3.5 w-3.5" strokeWidth={2.4} />
          {primaryLabel}
        </button>
        {!linkedinUrl && (
          <button
            type="button"
            onClick={onAddLinkedIn}
            className="inline-flex items-center gap-1.5 rounded-md border border-navy/20 bg-white px-3 py-2 text-sm font-semibold text-charcoal transition-colors hover:bg-offwhite"
          >
            <Pencil className="h-3.5 w-3.5" />
            Add LinkedIn URL
          </button>
        )}
        {!AUTO_LOG_ON_PRIMARY && (
          <button
            type="button"
            onClick={onMarkContacted}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-md border border-navy/30 bg-white px-3 py-2 text-sm font-semibold text-navy transition-colors hover:bg-navy/5 disabled:opacity-50"
            title="I just sent this message — log it as sent today"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
            Mark contacted
          </button>
        )}
        <button
          onClick={() => setShowSentPicker((v) => !v)}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-navy/20 bg-white px-3 py-2 text-sm font-semibold text-charcoal transition-colors hover:bg-offwhite disabled:opacity-50"
          title="Already sent this message off-portal — backdate the log so the next-stage prompt surfaces at the right time"
        >
          <CalendarCheck className="h-3.5 w-3.5" />
          Already sent
        </button>
        <span className="ml-auto" />
        <button
          onClick={onPark}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-semibold text-steel transition-colors hover:text-navy disabled:opacity-50"
          title="Park this lead — hide from Today until a future date"
        >
          <Moon className="h-3.5 w-3.5" />
          Park
        </button>
        <button
          onClick={onMarkNotInterested}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-sm font-semibold text-steel transition-colors hover:text-red disabled:opacity-50"
        >
          Mark not interested
        </button>
      </div>

      {showSentPicker && (
        <div className="flex flex-wrap items-center gap-3 border-t border-navy/10 bg-navy/[0.03] px-5 py-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-navy">
            Sent on:
            <input
              type="date"
              value={sentDate}
              max={isoDateToday()}
              min={card.trigger.date ?? undefined}
              onChange={(e) => setSentDate(e.target.value)}
              className="rounded border border-navy/30 bg-white px-2 py-1 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </label>
          <span className="text-xs text-steel">
            Logs the {`"${card.rule.name}"`} activity at that date and re-evaluates the cadence — next-stage prompt surfaces immediately if its window has already opened.
          </span>
          <span className="ml-auto" />
          <button
            type="button"
            onClick={() => setShowSentPicker(false)}
            disabled={pending}
            className="inline-flex items-center rounded-md px-2.5 py-1.5 text-xs font-semibold text-steel hover:text-navy disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              if (!sentDate) return;
              setShowSentPicker(false);
              onAlreadySent(sentDate);
            }}
            disabled={pending || !sentDate}
            className="inline-flex items-center gap-1.5 rounded-md bg-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-navy/90 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Log as sent
          </button>
        </div>
      )}
    </article>
  );
}

function DoneCardView({
  card,
  stamp,
  ruleName,
  markedLost,
}: {
  card: TodayCard;
  stamp: string;
  ruleName?: string;
  markedLost?: boolean;
}) {
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
            {markedLost
              ? "Status → Lost"
              : ruleName
                ? `"${ruleName}"`
                : ""}
          </span>
        </div>
      </div>
    </article>
  );
}

// ── Add LinkedIn URL modal ────────────────────────────────────────────

function AddLinkedInModal({
  card,
  onClose,
  onSaved,
}: {
  card: TodayCard;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const res = await fetch(
        `/api/leads/${card.lead_id}/linkedin-url`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ linkedin_url: url.trim() }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-navy/10 px-5 py-4">
          <div>
            <h2 className="text-base font-bold text-navy">Add LinkedIn URL</h2>
            <p className="mt-0.5 text-xs text-steel">
              {card.contact.full_name}
              {card.company_name ? ` · ${card.company_name}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-steel hover:text-navy"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <form onSubmit={submit} className="space-y-4 px-5 py-4">
          <div>
            <label
              htmlFor="li-url"
              className="block text-xs font-semibold uppercase tracking-wide text-steel"
            >
              LinkedIn URL
            </label>
            <input
              id="li-url"
              ref={inputRef}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://www.linkedin.com/in/jane-doe-aero/"
              required
              className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-charcoal outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
            />
            <p className="mt-1 text-[11px] text-steel">
              Saves to both the lead and the contact's profile.
            </p>
          </div>

          {formError && (
            <div className="rounded-md border border-red bg-red/10 px-3 py-2 text-sm font-semibold text-red">
              {formError}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-navy/10 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-2 rounded-md border border-navy/20 bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !url.trim()}
              className="inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy/90 disabled:opacity-60"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
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

function isoDateToday(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatStampForSentAt(sentAtISO: string): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(sentAtISO)
    ? new Date(sentAtISO + "T12:00:00")
    : new Date(sentAtISO);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const that = new Date(parsed);
  that.setHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - that.getTime()) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 14) return `${days} days ago`;
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
