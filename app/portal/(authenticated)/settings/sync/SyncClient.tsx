"use client";

import { useState } from "react";
import { Send, Inbox, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";

interface TaskInfo {
  task: string;
  envVar: string;
  configured: boolean;
}

interface TaskResult {
  ok: boolean;
  message: string;
  runId: string | null;
  firedAt: string;
}

const TASK_META: Record<
  string,
  { label: string; description: string; icon: typeof Send }
> = {
  "sent-invitations": {
    label: "Sync sent invitations now",
    description:
      "Walks linkedin.com/mynetwork/invitation-manager/sent/ and posts every still-pending invitation to the review queue. Runs nightly at 10pm Pacific automatically; this button fires it on demand.",
    icon: Send,
  },
  "dm-inbox": {
    label: "Sync DM inbox now",
    description:
      "Phase 2 task. Walks linkedin.com/messaging/, captures replies and inbound activity since the last run, and posts proposals to the review queue.",
    icon: Inbox,
  },
};

export default function SyncClient({ tasks }: { tasks: TaskInfo[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, TaskResult>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});

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
      setResults((prev) => ({
        ...prev,
        [task]: {
          ok: true,
          message: "Cowork accepted the trigger.",
          runId: data?.run_id ?? null,
          firedAt: data?.fired_at ?? new Date().toISOString(),
        },
      }));
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
          Manual triggers for the Cowork scraper tasks. Each task runs on its
          own schedule automatically; use these buttons when you want to fire
          one mid-day (e.g. after a paste-heavy outreach session).
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
          const result = results[t.task];
          const error = errors[t.task];
          const isBusy = busy === t.task;
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
                  <h2 className="text-base font-bold text-navy">{meta.label}</h2>
                  <p className="mt-1 text-sm text-steel">{meta.description}</p>
                  {!t.configured && (
                    <div className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Cowork task not yet configured (env var{" "}
                      <code className="font-mono">{t.envVar}</code> unset).
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => fire(t.task)}
                  disabled={!t.configured || isBusy}
                  className="inline-flex items-center gap-1.5 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy/90 disabled:cursor-not-allowed disabled:bg-steel/40"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isBusy ? "animate-spin" : ""}`}
                  />
                  {isBusy ? "Firing…" : "Sync now"}
                </button>
              </div>

              {result?.ok && (
                <div className="mt-3 flex items-start gap-2 rounded-md bg-green-50 px-3 py-2 text-xs text-green-800">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">{result.message}</p>
                    <p className="mt-0.5 text-green-700">
                      Fired at{" "}
                      {new Date(result.firedAt).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                      {result.runId ? ` · run ${result.runId}` : ""}.
                    </p>
                  </div>
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
        <em>Sync now</em> POSTs to{" "}
        <code className="font-mono">/api/cowork/trigger-sync?task=…</code>,
        which forwards a webhook ping to Cowork. Cowork acknowledges the
        trigger, runs the task in the background, and emails you a summary
        when it&apos;s done. The webhook URL for each task is set per-env in
        Vercel; once Cowork builds a task it provides the URL and the matching
        button here goes live with no code change.
      </div>
    </div>
  );
}
