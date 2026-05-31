"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Undo2, CornerDownLeft, CornerUpRight, Sparkles } from "lucide-react";

// "Recently Applied" feed — Phase 5 Part B.
//
// Mounts on /portal/today. Lists the last ~20 activities the DM-scraper
// pipeline applied to the CRM via /api/inbox-sync. Each row has a
// one-click Undo that reverts the insert (DELETE /api/inbox-sync/recent/:id).
// The whole card hides when there's nothing applied.

type AppliedRow = {
  id: string;
  created_at: string;
  type: string;
  direction: string | null;
  preview: string;
  lead_id: string | null;
  lead_name: string;
  company_name: string | null;
};

const TYPE_LABELS: Record<string, string> = {
  linkedin_message: "LinkedIn DM",
  connection_request: "Connection",
  email: "Email",
  phone: "Call",
  note: "Note",
  sample_sent: "Sample sent",
  follow_up: "Follow-up",
  web_order: "Web order",
};

function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const d = Math.round(hr / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export default function RecentlyAppliedPanel() {
  const router = useRouter();
  const [rows, setRows] = useState<AppliedRow[] | null>(null);
  const [undoneId, setUndoneId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch("/api/inbox-sync/recent", { cache: "no-store" });
      if (!res.ok) {
        if (res.status !== 401) setError(`Failed to load (${res.status})`);
        return;
      }
      const data = await res.json();
      setRows((data?.rows ?? []) as AppliedRow[]);
      setError("");
    } catch {
      // Silent — leave whatever we last had.
    }
  }, []);

  useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const onUndo = useCallback(
    async (row: AppliedRow) => {
      if (busyId) return;
      setBusyId(row.id);
      setError("");
      // Optimistic removal.
      setRows((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev));
      try {
        const res = await fetch(`/api/inbox-sync/recent/${row.id}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        setUndoneId(row.id);
        // Refresh the Today queue — the reverted activity may flip the
        // lead back out of (or into) the conversation-state queue.
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Undo failed");
        // Put it back and re-sync from the server.
        fetchRows();
      } finally {
        setBusyId(null);
      }
    },
    [busyId, fetchRows, router],
  );

  // Empty state: hide entirely.
  if (!rows || rows.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg border border-navy/15 bg-white shadow-sm">
      <header className="flex items-baseline justify-between border-b border-navy/10 px-4 py-3">
        <h2 className="flex items-center gap-1.5 text-sm font-bold uppercase tracking-wide text-navy">
          <Sparkles className="h-3.5 w-3.5 text-navy/60" />
          Recently applied
        </h2>
        <span className="text-xs text-steel">
          last {rows.length} {rows.length === 1 ? "sync" : "syncs"}
        </span>
      </header>

      {error && (
        <div className="border-b border-red/30 bg-red/5 px-4 py-2 text-xs font-semibold text-red">
          {error}
        </div>
      )}

      <ul className="divide-y divide-navy/10">
        {rows.map((row) => {
          const inbound = row.direction === "inbound";
          return (
            <li
              key={row.id}
              className={`flex items-start gap-3 px-4 py-3 ${
                busyId === row.id ? "opacity-60" : ""
              }`}
            >
              <span
                className="mt-0.5 shrink-0 text-steel"
                title={inbound ? "Inbound" : "Outbound"}
              >
                {inbound ? (
                  <CornerDownLeft className="h-4 w-4" />
                ) : (
                  <CornerUpRight className="h-4 w-4" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  {row.lead_id ? (
                    <Link
                      href={`/portal/leads/${row.lead_id}`}
                      className="text-sm font-bold text-navy hover:underline"
                    >
                      {row.lead_name}
                    </Link>
                  ) : (
                    <span className="text-sm font-bold text-navy">
                      {row.lead_name}
                    </span>
                  )}
                  {row.company_name && (
                    <span className="text-xs text-steel">
                      · {row.company_name}
                    </span>
                  )}
                  <span className="rounded bg-navy/[0.06] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-navy">
                    {TYPE_LABELS[row.type] ?? row.type}
                  </span>
                  <span className="ml-auto whitespace-nowrap text-xs text-steel">
                    {fmtRelative(row.created_at)}
                  </span>
                </div>
                {row.preview && (
                  <p className="mt-0.5 truncate text-sm italic text-charcoal">
                    {row.preview}
                  </p>
                )}
              </div>

              <button
                onClick={() => onUndo(row)}
                disabled={busyId === row.id}
                title="Undo — remove this synced activity"
                className="ml-1 inline-flex shrink-0 items-center gap-1.5 rounded-md border border-navy/20 bg-white px-2.5 py-1.5 text-xs font-semibold text-navy transition-colors hover:bg-navy/5 disabled:opacity-50"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Undo
              </button>
            </li>
          );
        })}
      </ul>

      {undoneId && (
        <div className="border-t border-navy/10 bg-offwhite/40 px-4 py-2 text-xs text-steel">
          Removed the synced activity. It will re-appear if the next sync
          re-detects the same message.
        </div>
      )}
    </section>
  );
}
