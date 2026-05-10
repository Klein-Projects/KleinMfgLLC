"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  X,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from "lucide-react";

// "Recent Cowork activity" panel — Phase 1.5 follow-up.
//
// Mounts on /portal/today, polls GET /api/cowork/run-summary?undismissed=1
// every 60s. When the response is empty, the whole card hides.
//
// Each row collapses to: task badge · run_mode pill · relative time
// · headline · ×. Click the row body to expand into the breakdown
// (kept invitations, noise, post status, errors). The × dismisses
// optimistically and persists via POST /api/cowork/run-summary/:id/dismiss.

type RunSummary = {
  id: string;
  task_id: string;
  run_count: number;
  run_mode: "dry_run" | "live";
  observed_at: string;
  created_at: string;
  summary: Record<string, unknown>;
};

const POLL_INTERVAL_MS = 60_000;

const TASK_LABELS: Record<string, string> = {
  "klein-sent-invitations-scraper": "Sent invitations",
  "klein-dm-inbox-scraper": "DM inbox",
  "klein-deep-historical-sweep": "Historical sweep",
  "klein-weekly-digest": "Weekly digest",
};

function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  if (diff < 0) return "in the future";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const d = Math.round(hr / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

function isFailed(s: RunSummary): boolean {
  const errors = asArray(s.summary.errors);
  if (errors.length > 0) return true;
  const ps = asStr(s.summary.post_status);
  return !!ps && ps.startsWith("error_");
}

function deriveHeadline(s: RunSummary): string {
  if (isFailed(s)) {
    const errors = asArray<unknown>(s.summary.errors);
    const first = errors[0];
    const msg =
      typeof first === "string"
        ? first
        : asStr((first as Record<string, unknown> | null)?.message) ??
          asStr(s.summary.post_status) ??
          "run failed";
    return `Failed · ${msg}`;
  }

  const total =
    typeof s.summary.total === "number"
      ? (s.summary.total as number)
      : asArray(s.summary.kept_invitations).length +
        asArray(s.summary.filtered_as_noise).length;
  const kept = asArray(s.summary.kept_invitations).length;
  const noise = asArray(s.summary.filtered_as_noise).length;
  const postStatus = asStr(s.summary.post_status);

  const taskLabel = TASK_LABELS[s.task_id] ?? s.task_id;
  const noun =
    s.task_id === "klein-sent-invitations-scraper"
      ? "pending sent invitations"
      : "items observed";

  const parts: string[] = [];
  if (total > 0 || kept > 0 || noise > 0) {
    parts.push(`${total} ${noun}`);
    parts.push(`${kept} kept`);
    parts.push(`${noise} noise`);
  } else {
    parts.push(`${taskLabel} run #${s.run_count}`);
    parts.push(`0 observed`);
  }
  if (postStatus) {
    parts.push(`POST ${postStatus === "ok" ? "ok" : postStatus}`);
  } else if (s.run_mode === "dry_run") {
    parts.push("dry-run, no POST");
  }
  return parts.join(" · ");
}

export default function CoworkActivityPanel() {
  const [rows, setRows] = useState<RunSummary[] | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");

  const fetchRows = useCallback(async () => {
    try {
      const res = await fetch("/api/cowork/run-summary?undismissed=1&limit=20", {
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status !== 401) {
          setError(`Failed to load Cowork activity (${res.status})`);
        }
        return;
      }
      const data = await res.json();
      setRows((data?.rows ?? []) as RunSummary[]);
      setError("");
    } catch {
      // Silent — polling will retry. Keeps the dashboard from flashing
      // an error every minute over a transient network blip.
    }
  }, []);

  useEffect(() => {
    fetchRows();
    const handle = setInterval(fetchRows, POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [fetchRows]);

  async function dismiss(id: string) {
    setBusyId(id);
    setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    try {
      const res = await fetch(`/api/cowork/run-summary/${id}/dismiss`, {
        method: "POST",
      });
      if (!res.ok) {
        setError("Failed to dismiss; will retry on next refresh.");
        // Pull fresh state — the optimistic removal could be wrong.
        fetchRows();
      }
    } catch {
      fetchRows();
    } finally {
      setBusyId(null);
    }
  }

  function toggleExpand(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Empty state per spec: hide entirely.
  const visible = useMemo(() => rows ?? [], [rows]);
  if (visible.length === 0) return null;

  return (
    <section className="mb-6 rounded-lg border border-navy/15 bg-white shadow-sm">
      <header className="flex items-baseline justify-between border-b border-navy/10 px-4 py-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-navy">
          Recent Cowork activity
        </h2>
        <span className="text-xs text-steel">
          {visible.length} {visible.length === 1 ? "run" : "runs"}
        </span>
      </header>
      {error && (
        <div className="border-b border-red/30 bg-red/5 px-4 py-2 text-xs font-semibold text-red">
          {error}
        </div>
      )}
      <ul className="divide-y divide-navy/10">
        {visible.map((s) => (
          <RunRow
            key={s.id}
            row={s}
            expanded={expanded.has(s.id)}
            busy={busyId === s.id}
            onToggle={() => toggleExpand(s.id)}
            onDismiss={() => dismiss(s.id)}
          />
        ))}
      </ul>
    </section>
  );
}

function RunRow({
  row,
  expanded,
  busy,
  onToggle,
  onDismiss,
}: {
  row: RunSummary;
  expanded: boolean;
  busy: boolean;
  onToggle: () => void;
  onDismiss: () => void;
}) {
  const failed = isFailed(row);
  const failedClasses = failed ? "border-l-4 border-l-red" : "";

  return (
    <li className={`${failedClasses} ${busy ? "opacity-60" : ""}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          <span className="text-steel">
            {expanded ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </span>
          <span className="rounded-md bg-navy/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-navy">
            {TASK_LABELS[row.task_id] ?? row.task_id}
          </span>
          <RunModePill mode={row.run_mode} />
          {failed && (
            <span className="inline-flex items-center gap-1 rounded-md bg-red/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red">
              <AlertCircle className="h-3 w-3" /> Error
            </span>
          )}
          <span className="truncate text-sm font-medium text-navy">
            {deriveHeadline(row)}
          </span>
          <span className="ml-auto whitespace-nowrap pl-2 text-xs text-steel">
            {fmtRelative(row.observed_at)}
          </span>
        </button>
        <button
          onClick={onDismiss}
          disabled={busy}
          aria-label="Dismiss"
          title="Dismiss"
          className="ml-1 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-steel hover:bg-navy/5 hover:text-navy disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {expanded && <RunDetail row={row} />}
    </li>
  );
}

function RunModePill({ mode }: { mode: "dry_run" | "live" }) {
  if (mode === "live") {
    return (
      <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800">
        Live
      </span>
    );
  }
  return (
    <span className="rounded-md bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
      Dry run
    </span>
  );
}

function RunDetail({ row }: { row: RunSummary }) {
  const kept = asArray<Record<string, unknown>>(row.summary.kept_invitations);
  const noise = asArray<Record<string, unknown>>(row.summary.filtered_as_noise);
  const errors = asArray<unknown>(row.summary.errors);
  const postStatus = asStr(row.summary.post_status);
  const postBody = asStr(row.summary.post_response_snippet);

  return (
    <div className="space-y-4 border-t border-navy/10 bg-offwhite/40 px-4 py-4 text-sm">
      {kept.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-navy">
            Kept ({kept.length})
          </h3>
          <div className="overflow-hidden rounded-md border border-navy/10 bg-white">
            <table className="w-full text-left text-xs">
              <thead className="bg-navy/5 text-navy">
                <tr>
                  <th className="px-3 py-2 font-semibold">Name</th>
                  <th className="px-3 py-2 font-semibold">Headline</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Sent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy/10">
                {kept.slice(0, 50).map((k, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 font-medium text-navy">
                      {asStr(k.name) ?? "—"}
                    </td>
                    <td className="px-3 py-1.5 text-steel">
                      {(asStr(k.headline) ?? "").slice(0, 80)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-steel">
                      {asStr(k.sent_relative) ?? asStr(k.sent_date_estimate) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {kept.length > 50 && (
              <div className="bg-navy/5 px-3 py-1.5 text-xs text-steel">
                … and {kept.length - 50} more
              </div>
            )}
          </div>
        </div>
      )}
      {noise.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-navy">
            Filtered as noise ({noise.length})
          </h3>
          <ul className="space-y-1">
            {noise.slice(0, 20).map((n, i) => (
              <li key={i} className="text-xs text-steel">
                <span className="font-medium text-navy">
                  {asStr(n.name) ?? asStr(n.linkedin_url) ?? "—"}
                </span>
                {asStr(n.reason) && (
                  <span className="ml-2 italic">{asStr(n.reason)}</span>
                )}
              </li>
            ))}
            {noise.length > 20 && (
              <li className="text-xs text-steel">
                … and {noise.length - 20} more
              </li>
            )}
          </ul>
        </div>
      )}
      {(postStatus || postBody) && (
        <div>
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-navy">
            Downstream POST
          </h3>
          <div className="space-y-1 text-xs">
            {postStatus && (
              <div>
                <span className="font-semibold text-navy">Status:</span>{" "}
                <span className="text-steel">{postStatus}</span>
              </div>
            )}
            {postBody && (
              <pre className="overflow-x-auto rounded-md border border-navy/10 bg-white p-2 text-[11px] text-navy">
                {postBody}
              </pre>
            )}
          </div>
        </div>
      )}
      {errors.length > 0 && (
        <div>
          <h3 className="mb-2 flex items-center gap-1 text-xs font-bold uppercase tracking-wide text-red">
            <AlertCircle className="h-3.5 w-3.5" /> Errors ({errors.length})
          </h3>
          <ul className="space-y-1 text-xs text-red">
            {errors.map((e, i) => {
              const msg =
                typeof e === "string"
                  ? e
                  : asStr((e as Record<string, unknown>)?.message) ??
                    JSON.stringify(e);
              return (
                <li key={i} className="rounded-md bg-red/5 px-2 py-1.5">
                  {msg}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
