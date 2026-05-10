"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Send,
  Inbox,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Loader2,
} from "lucide-react";

interface TaskInfo {
  task: string;
}

type FireStatus = "queued" | "firing" | "complete" | "failed";

interface TriggerStatus {
  id: string;
  task_id: string;
  fire_status: FireStatus;
  requested_at: string;
  fired_at: string | null;
  finished_at: string | null;
  fire_error: string | null;
}

interface TaskBucket {
  latest: TriggerStatus | null;
  queuedCount: number;
  firingCount: number;
}

const TASK_META: Record<
  string,
  { label: string; description: string; icon: typeof Send }
> = {
  "sent-invitations": {
    label: "Sync sent invitations now",
    description:
      "Walks linkedin.com/mynetwork/invitation-manager/sent/ and posts every still-pending invitation to the review queue. Runs nightly at 10pm Pacific automatically; this button queues an on-demand run that fires within about 5 minutes.",
    icon: Send,
  },
  "dm-inbox": {
    label: "Sync DM inbox now",
    description:
      "Walks linkedin.com/messaging/, captures replies and inbound activity since the last run, and posts proposals to the review queue. Runs weekday mornings at 7am Eastern; this button queues an on-demand run that fires within about 5 minutes.",
    icon: Inbox,
  },
};

function fmtRelative(iso: string | null): string {
  if (!iso) return "-";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "-";
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

function statusPill(status: FireStatus): { label: string; className: string } {
  switch (status) {
    case "queued":
      return { label: "Queued", className: "bg-amber-50 text-amber-800" };
    case "firing":
      return { label: "Running", className: "bg-blue-50 text-blue-800" };
    case "complete":
      return { label: "Complete", className: "bg-green-50 text-green-800" };
    case "failed":
      return { label: "Failed", className: "bg-red/10 text-red" };
  }
}

export default function SyncClient({ tasks }: { tasks: TaskInfo[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [byTask, setByTask] = useState<Record<string, TaskBucket>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

  const refreshStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/cowork/trigger-sync", { method: "GET" });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.byTask) setByTask(data.byTask);
    } catch {
      /* ignore - next tick will retry */
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const id = setInterval(refreshStatus, 15_000);
    return () => clearInterval(id);
  }, [refreshStatus]);

  async function fire(task: string) {
    setBusy(task);
    setErrors((prev) => {
      const next = { ...prev };
      delete next[task];
      return next;
    });
    try {
      const res = await fetch(
        `/api/cowork/trigger-sync?task=${encodeURIComponent(task)}`,
        { method: "POST" },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(
          data?.message || data?.error || `Server returned ${res.status}`,
        );
      }
      refreshStatus();
    } catch (e) {
      setErrors((prev) => ({
        ...prev,
        [task]: e instanceof Error ? e.message : "Trigger failed",
      }));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-6 py-8 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Sync</h1>
        <p className="mt-1 text-sm text-steel">
          Manual triggers for the Cowork scraper tasks. Each task runs on
          its own schedule automatically; use these buttons to fire one
          mid-day. The Cowork poller picks up queued requests within
          about 5 minutes.
        </p>
      </div>

      <div className="space-y-4">
        {tasks.map((t) => {
          const meta = TASK_META[t.task] ?? {
            label: t.task,
            description: "",
            icon: RefreshCw,
          };
          const Icon = meta.icon;
          const bucket = byTask[t.task];
          const latest = bucket?.latest ?? null;
          const queuedCount = bucket?.queuedCount ?? 0;
          const firingCount = bucket?.firingCount ?? 0;
          const isBusy = busy === t.task;
          const error = errors[t.task];
          const buttonDisabled =
            isBusy || queuedCount > 0 || firingCount > 0;
          const pill = latest ? statusPill(latest.fire_status) : null;
          return (
            <article
              key={t.task}
              className="rounded-lg border border-navy/10 bg-white p-5 shadow-sm"
            >
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-navy/5 text-navy">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold text-navy">
                    {meta.label}
                  </h2>
                  <p className="mt-1 text-sm text-steel">
                    {meta.description}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-steel">
                    {pill && (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-semibold ${pill.className}`}
                      >
                        {latest?.fire_status === "firing" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : latest?.fire_status === "queued" ? (
                          <Clock className="h-3 w-3" />
                        ) : null}
                        {pill.label}
                      </span>
                    )}
                    {latest && (
                      <span>
                        {latest.fire_status === "complete"
                          ? `Last run finished ${fmtRelative(latest.finished_at)}`
                          : latest.fire_status === "failed"
                          ? `Last attempt failed ${fmtRelative(latest.finished_at)}`
                          : latest.fire_status === "firing"
                          ? `Started ${fmtRelative(latest.fired_at)}`
                          : `Queued ${fmtRelative(latest.requested_at)}`}
                      </span>
                    )}
                    {!latest && (
                      <span className="text-steel/70">
                        No on-demand runs yet. Scheduled runs continue on
                        their normal cadence.
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => fire(t.task)}
                  disabled={buttonDisabled}
                  className="inline-flex items-center gap-1.5 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy/90 disabled:cursor-not-allowed disabled:bg-steel/40"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isBusy ? "animate-spin" : ""}`}
                  />
                  {isBusy
                    ? "Queuing..."
                    : queuedCount > 0
                    ? "Queued"
                    : firingCount > 0
                    ? "Running..."
                    : "Sync now"}
                </button>
              </div>

              {queuedCount > 0 && !error && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <Clock className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">
                      Queued. The Cowork poller runs every ~5 minutes
                      and will pick this up on its next tick.
                    </p>
                    <p className="mt-0.5 text-amber-800/80">
                      You can leave this page; the run continues in the
                      background and the result lands on /portal/today.
                    </p>
                  </div>
                </div>
              )}

              {latest?.fire_status === "failed" && latest.fire_error && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-red/5 px-3 py-2 text-xs text-red">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">Last run failed.</p>
                    <p className="mt-0.5 break-words">{latest.fire_error}</p>
                  </div>
                </div>
              )}

              {latest?.fire_status === "complete" && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    Last run completed {fmtRelative(latest.finished_at)}.
                    See the &quot;Recent Cowork activity&quot; panel on
                    /portal/today for the summary.
                  </p>
                </div>
              )}

              {error && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-red/5 px-3 py-2 text-xs text-red">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    <strong>Trigger failed.</strong> {error}
                  </p>
                </div>
              )}
            </article>
          );
        })}
      </div>

      <div className="mt-8 rounded-md border border-navy/10 bg-offwhite px-4 py-3 text-xs text-steel">
        <strong className="text-navy">How this works.</strong> Clicking{" "}
        <em>Sync now</em> writes a row to the <code>sync_triggers</code>{" "}
        table. The <code>klein-sync-poller</code> Cowork task checks
        that table every 5 minutes; when it finds a queued row it runs
        the matching scrape on Sean&apos;s desktop, updates the row to
        complete or failed, and posts a run summary to /portal/today.
        The 60-second cooldown prevents accidental double-clicks from
        spamming the queue.
      </div>
    </div>
  );
}
