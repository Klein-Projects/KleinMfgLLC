"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  X,
  Inbox,
  ExternalLink,
  UserPlus,
  MessageSquare,
  ArrowRightCircle,
  PenSquare,
  MoonStar,
  RefreshCw,
} from "lucide-react";
import type { QueueItem } from "./page";

type Kind = QueueItem["kind"];

const KIND_LABELS: Record<Kind, string> = {
  new_lead: "New leads",
  new_activity: "New activities",
  stage_change: "Stage changes",
  update_contact: "Contact updates",
  set_wake_up: "Wake-up changes",
};

// Display order matches the workflow Sean cares about most: stage
// changes first (the highest-value reconciliations), then new leads
// (cold outreach he sent off-portal), then activity logging, then
// the long-tail edits.
const KIND_ORDER: Kind[] = [
  "stage_change",
  "new_lead",
  "new_activity",
  "update_contact",
  "set_wake_up",
];

const SOURCE_LABELS: Record<string, string> = {
  linkedin_dm_scraper: "DM inbox scraper",
  sent_invitations_scraper: "Sent-invitations scraper",
};

function asStr(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  const diff = Date.now() - t;
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.round(hr / 24);
  return `${d}d ago`;
}

function fullName(lead: QueueItem["lead"]): string {
  const fn = lead?.contact?.first_name ?? "";
  const ln = lead?.contact?.last_name ?? "";
  return `${fn} ${ln}`.trim();
}

function isReconciliation(item: QueueItem): boolean {
  if (item.kind !== "stage_change") return false;
  return asStr(item.payload?.reconciled_from) === "invited_thread_match";
}

function KindIcon({ kind }: { kind: Kind }) {
  const cls = "h-4 w-4";
  switch (kind) {
    case "new_lead":
      return <UserPlus className={cls} />;
    case "new_activity":
      return <MessageSquare className={cls} />;
    case "stage_change":
      return <ArrowRightCircle className={cls} />;
    case "update_contact":
      return <PenSquare className={cls} />;
    case "set_wake_up":
      return <MoonStar className={cls} />;
  }
}

export default function ReviewQueuePageClient({
  items,
}: {
  items: QueueItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [recentlyDecided, setRecentlyDecided] = useState<
    Record<string, "approved" | "rejected">
  >({});

  const groups = useMemo(() => {
    const byKind: Record<Kind, QueueItem[]> = {
      new_lead: [],
      new_activity: [],
      stage_change: [],
      update_contact: [],
      set_wake_up: [],
    };
    for (const it of items) {
      if (recentlyDecided[it.id]) continue;
      byKind[it.kind].push(it);
    }
    return KIND_ORDER.filter((k) => byKind[k].length > 0).map((k) => ({
      kind: k,
      items: byKind[k],
    }));
  }, [items, recentlyDecided]);

  const totalRemaining = groups.reduce((n, g) => n + g.items.length, 0);

  async function decide(id: string, action: "approve" | "reject") {
    setError("");
    setBusyId(id);
    try {
      const res = await fetch(`/api/review-queue/${id}/${action}`, {
        method: "POST",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.error ?? `Failed to ${action} (${res.status})`);
        setBusyId(null);
        return;
      }
      setRecentlyDecided((prev) => ({
        ...prev,
        [id]: action === "approve" ? "approved" : "rejected",
      }));
      setBusyId(null);
      // Refresh the server data in the background so the next render
      // reflects authoritative state without yanking the row out from
      // under Sean while he's still scanning.
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to ${action}`);
      setBusyId(null);
    }
  }

  return (
    <div className="px-6 py-8 lg:px-8">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-navy">Pending changes</h1>
          <p className="mt-1 text-sm text-steel">
            Changes the LinkedIn scrapers want to make to your CRM. Approve to
            apply each one. Reject to dismiss without touching the data.
          </p>
        </div>
        <button
          onClick={() => startTransition(() => router.refresh())}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-navy/20 bg-white px-3 py-1.5 text-xs font-semibold text-navy hover:bg-navy/5 disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${pending ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </header>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red bg-red/10 px-4 py-3 text-sm font-semibold text-red"
        >
          {error}
        </div>
      )}

      {totalRemaining === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-navy/20 bg-white px-6 py-16 text-center">
          <Inbox className="h-8 w-8 text-steel" />
          <p className="text-sm font-semibold text-navy">All caught up.</p>
          <p className="text-sm text-steel">
            No pending changes waiting for review.
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.kind}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-navy">
                <KindIcon kind={g.kind} />
                {KIND_LABELS[g.kind]}
                <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-semibold text-navy">
                  {g.items.length}
                </span>
              </h2>
              <ul className="space-y-2">
                {g.items.map((it) => (
                  <ReviewRow
                    key={it.id}
                    item={it}
                    busy={busyId === it.id}
                    onApprove={() => decide(it.id, "approve")}
                    onReject={() => decide(it.id, "reject")}
                  />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewRow({
  item,
  busy,
  onApprove,
  onReject,
}: {
  item: QueueItem;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const reconciliation = isReconciliation(item);
  const sourceLabel = SOURCE_LABELS[item.source] ?? item.source;

  // Reconciliation rows get a navy left border + light navy tint to
  // call out that they're high-trust + tied to an existing invited
  // lead Sean already worked. Other rows are plain white.
  const baseClasses =
    "rounded-lg border bg-white px-4 py-3 shadow-sm transition-opacity";
  const reconClasses = reconciliation
    ? "border-navy/30 border-l-4 border-l-navy bg-navy/[0.02]"
    : "border-navy/15";

  return (
    <li className={`${baseClasses} ${reconClasses} ${busy ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <RowSummary item={item} />
            {reconciliation && (
              <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-navy">
                Reconciliation
              </span>
            )}
          </div>
          <RowDetail item={item} />
          <p className="mt-2 text-xs text-steel">
            {sourceLabel} · {fmtRelative(item.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onReject}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-navy/20 bg-white px-3 py-1.5 text-xs font-semibold text-steel hover:border-red hover:bg-red/5 hover:text-red disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            Reject
          </button>
          <button
            onClick={onApprove}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md bg-navy px-3 py-1.5 text-xs font-bold text-white hover:bg-navy/90 disabled:opacity-50"
          >
            <Check className="h-3.5 w-3.5" />
            Approve
          </button>
        </div>
      </div>
    </li>
  );
}

function RowSummary({ item }: { item: QueueItem }) {
  const lead = item.lead;
  const name = fullName(lead);
  const url = asStr(item.payload.linkedin_url);
  const headlineFromPayload = asStr(item.payload.headline);
  const proposedName = asStr(item.payload.name);

  if (item.kind === "stage_change") {
    const from = asStr(item.payload.from_status) ?? lead?.status ?? "?";
    const to = asStr(item.payload.to_status) ?? "?";
    return (
      <span className="text-sm font-semibold text-navy">
        {name || "Unknown lead"}{" "}
        <span className="font-normal text-steel">
          · {from} → {to}
        </span>
      </span>
    );
  }
  if (item.kind === "new_lead") {
    return (
      <span className="text-sm font-semibold text-navy">
        {proposedName || name || "New lead"}
        {headlineFromPayload && (
          <span className="ml-2 font-normal text-steel">
            · {headlineFromPayload}
          </span>
        )}
      </span>
    );
  }
  if (item.kind === "new_activity") {
    return (
      <span className="text-sm font-semibold text-navy">
        {name || proposedName || "Activity"}
      </span>
    );
  }
  if (item.kind === "update_contact") {
    return (
      <span className="text-sm font-semibold text-navy">
        Contact update · {name || "Lead"}
      </span>
    );
  }
  if (item.kind === "set_wake_up") {
    const at = asStr(item.payload.wake_up_at);
    return (
      <span className="text-sm font-semibold text-navy">
        Park lead · {name || "Lead"}{" "}
        {at && <span className="font-normal text-steel">until {at.slice(0, 10)}</span>}
      </span>
    );
  }
  return (
    <span className="text-sm font-semibold text-navy">
      {name || url || "Pending change"}
    </span>
  );
}

function RowDetail({ item }: { item: QueueItem }) {
  const url = asStr(item.payload.linkedin_url);
  const company =
    item.lead?.company?.name ?? asStr(item.payload.company) ?? null;
  const title = asStr(item.payload.title);

  if (item.kind === "new_activity") {
    const direction = asStr(item.payload.direction) ?? "outbound";
    const excerpt =
      asStr(item.payload.summary) ??
      asStr(item.payload.first_message_excerpt) ??
      asStr(item.payload.message_excerpt);
    return (
      <div className="mt-1 text-sm text-navy/80">
        {direction === "inbound" ? "Inbound" : "Outbound"} message
        {excerpt && <span className="ml-1 text-steel">— "{excerpt}"</span>}
      </div>
    );
  }
  if (item.kind === "update_contact") {
    const updates =
      (item.payload.updates as Record<string, unknown> | undefined) ?? null;
    if (!updates) return null;
    return (
      <div className="mt-1 text-sm text-navy/80">
        {Object.entries(updates)
          .filter(([, v]) => typeof v === "string" && v)
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ")}
      </div>
    );
  }
  if (item.kind === "set_wake_up") {
    const reason = asStr(item.payload.wake_up_reason);
    return reason ? (
      <div className="mt-1 text-sm text-navy/80">{reason}</div>
    ) : null;
  }
  if (item.kind === "stage_change") {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-steel">
        {url && <ProfileLink url={url} />}
      </div>
    );
  }
  // new_lead
  return (
    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-steel">
      {company && <span>{title ? `${title} · ${company}` : company}</span>}
      {!company && title && <span>{title}</span>}
      {url && <ProfileLink url={url} />}
    </div>
  );
}

function ProfileLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 text-navy hover:underline"
    >
      <ExternalLink className="h-3 w-3" />
      LinkedIn
    </a>
  );
}
