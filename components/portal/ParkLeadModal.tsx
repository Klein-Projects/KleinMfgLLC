"use client";

import { useEffect, useRef, useState } from "react";
import { X, Calendar } from "lucide-react";

// Shared modal for parking a lead with a future wake_up_at + reason.
// Wired from /portal/today (Park action on a card) and /portal/leads/:id
// (Park button next to Delete in the header).
//
// On submit, POSTs to /api/leads/:id/wake-up with { wake_up_at, wake_up_reason }
// then calls onSaved(). The caller is responsible for refreshing the page.

type Preset = "30" | "60" | "90" | "custom";

function addDaysISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function ParkLeadModal({
  leadId,
  leadName,
  onClose,
  onSaved,
}: {
  leadId: string;
  leadName: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [preset, setPreset] = useState<Preset>("30");
  const [customDate, setCustomDate] = useState<string>(addDaysISO(30));
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  function resolvedDate(): string {
    if (preset === "custom") return customDate;
    return addDaysISO(Number(preset));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const wakeUpAt = resolvedDate();
    if (!wakeUpAt || !/^\d{4}-\d{2}-\d{2}$/.test(wakeUpAt)) {
      setError("Pick a valid wake-up date.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/wake-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wake_up_at: wakeUpAt,
          wake_up_reason: reason.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to park lead");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="park-lead-title"
        className="w-full max-w-md rounded-lg bg-white shadow-xl"
      >
        <form onSubmit={submit}>
          <div className="flex items-start justify-between border-b border-navy/10 px-5 py-4">
            <div>
              <h2 id="park-lead-title" className="text-base font-bold text-navy">
                Park lead
              </h2>
              <p className="mt-0.5 text-xs text-steel">
                Hide <span className="font-semibold text-charcoal">{leadName}</span>{" "}
                from the Today queue until the date below. Lead reappears
                automatically on that day.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-steel hover:bg-offwhite hover:text-charcoal"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="px-5 py-4">
            <fieldset className="grid grid-cols-4 gap-2" aria-label="Wake up after">
              {(["30", "60", "90", "custom"] as const).map((p) => {
                const selected = preset === p;
                return (
                  <label
                    key={p}
                    className={`cursor-pointer rounded-md border px-3 py-2 text-center text-sm font-semibold transition ${
                      selected
                        ? "border-navy bg-navy text-white"
                        : "border-navy/20 bg-white text-navy hover:border-navy/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="preset"
                      value={p}
                      checked={selected}
                      onChange={() => setPreset(p)}
                      className="sr-only"
                    />
                    {p === "custom" ? "Custom" : `${p} days`}
                  </label>
                );
              })}
            </fieldset>

            {preset === "custom" && (
              <div className="mt-3 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-steel" />
                <input
                  type="date"
                  value={customDate}
                  min={addDaysISO(1)}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="flex-1 rounded-md border border-navy/20 px-2.5 py-1.5 text-sm text-charcoal outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
                />
              </div>
            )}

            <div className="mt-2 text-xs text-steel">
              Resurface on{" "}
              <span className="font-semibold text-charcoal">
                {new Date(resolvedDate() + "T00:00:00").toLocaleDateString([], {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </span>
              .
            </div>

            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-steel">
              Reason (optional)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Said wait until Q3 budget reset"
              rows={2}
              maxLength={240}
              className="mt-1 w-full rounded-md border border-navy/20 px-2.5 py-1.5 text-sm text-charcoal outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
            />

            {error && (
              <p className="mt-2 text-xs font-semibold text-red">{error}</p>
            )}
          </div>

          <div className="flex justify-end gap-2 border-t border-navy/10 bg-offwhite px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-md border border-navy/20 bg-white px-3 py-1.5 text-sm font-semibold text-navy hover:border-navy disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-md bg-navy px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-navy/90 disabled:opacity-50"
            >
              {submitting ? "Parking…" : "Park lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
