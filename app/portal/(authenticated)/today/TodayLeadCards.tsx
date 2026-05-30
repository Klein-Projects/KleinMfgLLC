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
  CornerUpLeft,
} from "lucide-react";
import {
  linkedinUrlForParts,
  type TodayLeadCard,
} from "@/lib/portal/today-conversation";
import ParkLeadModal from "@/components/portal/ParkLeadModal";

const UNDO_WINDOW_SECONDS = 8;

interface UndoState {
  message: string;
  payload: unknown;
  leadId: string;
}

export default function TodayLeadCards({ cards }: { cards: TodayLeadCard[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [actioned, setActioned] = useState<
    Record<string, { stamp: string; label?: string; markedLost?: boolean }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [undoSeconds, setUndoSeconds] = useState(UNDO_WINDOW_SECONDS);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editingLinkedInFor, setEditingLinkedInFor] =
    useState<TodayLeadCard | null>(null);
  const [parkingFor, setParkingFor] = useState<TodayLeadCard | null>(null);

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
    undoTimer.current = setTimeout(() => setUndoSeconds((s) => s - 1), 1000);
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

  // "I just sent this" — log an outbound activity stamped with the
  // suggested prompt. No cadence rule in the conversation-state model;
  // mark-contacted records the send and bumps last_activity_at, which is
  // what the next classifier run reads.
  const onLogSent = useCallback(
    async (card: TodayLeadCard) => {
      if (pendingId || !card.prompt) return;
      setPendingId(card.lead_id);
      setError(null);
      try {
        const res = await fetch(`/api/leads/${card.lead_id}/mark-contacted`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            prompt_id: card.prompt.id,
            channel: card.channel === "email" ? "email" : "linkedin",
            action_on_send: "none",
            auto_log_summary: `Sent "${card.prompt.title}" via Today`,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        setActioned((prev) => ({
          ...prev,
          [card.lead_id]: { stamp: nowStamp(), label: card.prompt!.title },
        }));
        showUndo({
          message: `Logged "${card.prompt.title}" for ${card.contact.full_name}`,
          payload: data.undo,
          leadId: card.lead_id,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to log send");
      } finally {
        setPendingId(null);
      }
    },
    [pendingId, showUndo],
  );

  const onPrimaryClick = useCallback(
    async (card: TodayLeadCard) => {
      if (!card.prompt) return;
      const linkedinUrl = linkedinUrlForParts(
        card.linkedin_url,
        card.linkedin_thread_id,
      );
      try {
        await navigator.clipboard.writeText(card.prompt.body_personalized);
      } catch {
        setError("Couldn't copy to clipboard.");
      }
      if (linkedinUrl) {
        window.open(linkedinUrl, "_blank", "noopener,noreferrer");
      }
    },
    [],
  );

  const onMarkNotInterested = useCallback(
    async (card: TodayLeadCard) => {
      if (pendingId) return;
      setPendingId(card.lead_id);
      setError(null);
      try {
        const res = await fetch(`/api/leads/${card.lead_id}/today-action`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "mark_not_interested" }),
        });
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
      <div className="mt-6 rounded-lg border border-dashed border-navy/20 bg-white p-10 text-center">
        <CheckCircle2 className="mx-auto h-9 w-9 text-green-500" />
        <p className="mt-3 text-base font-semibold text-navy">
          Nothing in this view.
        </p>
        <p className="mt-1 text-sm text-steel">
          No classified leads match this filter right now.
        </p>
      </div>
    );
  }

  const liveCards = cards.filter((c) => !actioned[c.lead_id]);
  const doneCards = cards.filter((c) => actioned[c.lead_id]);

  return (
    <div>
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
            onLogSent={() => onLogSent(card)}
            onMarkNotInterested={() => onMarkNotInterested(card)}
            onAddLinkedIn={() => setEditingLinkedInFor(card)}
            onPark={() => setParkingFor(card)}
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
                  label={meta.label}
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
  onLogSent,
  onMarkNotInterested,
  onAddLinkedIn,
  onPark,
}: {
  card: TodayLeadCard;
  pending: boolean;
  onPrimary: () => void;
  onLogSent: () => void;
  onMarkNotInterested: () => void;
  onAddLinkedIn: () => void;
  onPark: () => void;
}) {
  const linkedinUrl = linkedinUrlForParts(
    card.linkedin_url,
    card.linkedin_thread_id,
  );
  const prompt = card.prompt;
  const primaryLabel = linkedinUrl
    ? "Copy script + Open LinkedIn"
    : "Copy script";
  const confidencePct =
    card.state_confidence != null
      ? Math.round(card.state_confidence * 100)
      : null;

  return (
    <article
      id={`lead-${card.lead_id}`}
      className="overflow-hidden rounded-lg border border-navy/10 bg-white shadow-sm"
    >
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
            className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${card.state_badge_class}`}
          >
            {card.state_label}
          </span>
          {confidencePct != null && (
            <span className="text-[10px] font-semibold text-steel">
              {confidencePct}% confident
            </span>
          )}
        </div>
      </div>

      {card.last_inbound && (
        <div className="flex items-start gap-2 border-b border-navy/[0.06] bg-navy/[0.02] px-5 py-2.5">
          <CornerUpLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-steel" />
          <p className="truncate text-sm italic text-charcoal">
            {card.last_inbound.preview}
          </p>
        </div>
      )}

      <div className="px-5 pb-3 pt-3.5">
        {prompt && (
          <>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded bg-navy/[0.06] px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-navy">
                {prompt.category_label}
              </span>
              <span className="font-semibold text-charcoal">{prompt.title}</span>
            </div>
            <div className="mt-2 whitespace-pre-wrap rounded-md border border-navy/10 bg-offwhite px-3.5 py-3 text-sm leading-relaxed text-charcoal">
              {prompt.body_personalized}
            </div>
          </>
        )}

        {!linkedinUrl && (
          <div className="mt-2.5 flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              No LinkedIn URL on file. Add one to enable one-click open, or copy
              the script and find them manually.
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
        <button
          type="button"
          onClick={onLogSent}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-navy/30 bg-white px-3 py-2 text-sm font-semibold text-navy transition-colors hover:bg-navy/5 disabled:opacity-50"
          title="I just sent this message — log it as sent"
        >
          <Check className="h-3.5 w-3.5" strokeWidth={2.4} />
          Mark sent
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
    </article>
  );
}

function DoneCardView({
  card,
  stamp,
  label,
  markedLost,
}: {
  card: TodayLeadCard;
  stamp: string;
  label?: string;
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
            {markedLost ? "Status → Lost" : label ? `"${label}"` : ""}
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
  card: TodayLeadCard;
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
      const res = await fetch(`/api/leads/${card.lead_id}/linkedin-url`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ linkedin_url: url.trim() }),
      });
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
              Saves to both the lead and the contact&apos;s profile.
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
