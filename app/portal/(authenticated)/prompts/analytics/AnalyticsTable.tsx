"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowUpDown, ArrowDown, ArrowUp } from "lucide-react";
import type { PromptAnalyticsRow } from "@/lib/portal/prompt-analytics";

const CATEGORY_LABELS: Record<string, string> = {
  first_contact: "First Contact",
  follow_up: "Follow-Up",
  no_reply: "No Reply",
  sample_followup: "Sample Follow-Up",
  won: "Closed/Won",
  nurture: "Nurture",
};

const CATEGORY_COLORS: Record<string, string> = {
  first_contact: "bg-blue-100 text-blue-800",
  follow_up: "bg-purple-100 text-purple-800",
  no_reply: "bg-orange-100 text-orange-800",
  sample_followup: "bg-teal-100 text-teal-800",
  won: "bg-green-100 text-green-800",
  nurture: "bg-yellow-100 text-yellow-800",
};

type SortKey =
  | "title"
  | "uses"
  | "leads_used"
  | "reply_rate"
  | "conv_to_sample_rate"
  | "conv_to_won_rate"
  | "accept_rate"
  | "median_days_to_accept";

type SortDir = "asc" | "desc";

function pct(v: number | null): string {
  if (v === null) return "—";
  return `${Math.round(v * 100)}%`;
}

function num(v: number | null | undefined): string {
  if (v === null || v === undefined) return "—";
  return String(v);
}

function compareNullableNumber(
  a: number | null,
  b: number | null,
  dir: SortDir,
): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1; // nulls always last
  if (b === null) return -1;
  return dir === "asc" ? a - b : b - a;
}

export default function AnalyticsTable({
  rows,
}: {
  rows: PromptAnalyticsRow[];
}) {
  // Default sort: most-used prompts first.
  const [sortKey, setSortKey] = useState<SortKey>("uses");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function setSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "title" ? "asc" : "desc");
    }
  }

  const sorted = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      switch (sortKey) {
        case "title": {
          const r = a.title.localeCompare(b.title);
          return sortDir === "asc" ? r : -r;
        }
        case "uses":
          return sortDir === "asc" ? a.uses - b.uses : b.uses - a.uses;
        case "leads_used":
          return sortDir === "asc"
            ? a.leads_used - b.leads_used
            : b.leads_used - a.leads_used;
        case "reply_rate":
          return compareNullableNumber(a.reply_rate, b.reply_rate, sortDir);
        case "conv_to_sample_rate":
          return compareNullableNumber(
            a.conv_to_sample_rate,
            b.conv_to_sample_rate,
            sortDir,
          );
        case "conv_to_won_rate":
          return compareNullableNumber(
            a.conv_to_won_rate,
            b.conv_to_won_rate,
            sortDir,
          );
        case "accept_rate":
          return compareNullableNumber(a.accept_rate, b.accept_rate, sortDir);
        case "median_days_to_accept":
          return compareNullableNumber(
            a.median_days_to_accept,
            b.median_days_to_accept,
            sortDir,
          );
      }
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-navy/20 bg-white px-6 py-16 text-center text-sm text-steel">
        No prompt templates yet. Create one in the Prompt Library to start
        tracking performance.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-navy/10 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-navy/10 bg-offwhite/40 text-left text-[11px] uppercase tracking-wide text-steel">
            <SortableHeader
              label="Template"
              active={sortKey === "title"}
              dir={sortDir}
              onClick={() => setSort("title")}
              align="left"
            />
            <SortableHeader
              label="Uses"
              active={sortKey === "uses"}
              dir={sortDir}
              onClick={() => setSort("uses")}
            />
            <SortableHeader
              label="Leads"
              active={sortKey === "leads_used"}
              dir={sortDir}
              onClick={() => setSort("leads_used")}
            />
            <SortableHeader
              label="Reply rate"
              active={sortKey === "reply_rate"}
              dir={sortDir}
              onClick={() => setSort("reply_rate")}
            />
            <SortableHeader
              label="→ Sample"
              active={sortKey === "conv_to_sample_rate"}
              dir={sortDir}
              onClick={() => setSort("conv_to_sample_rate")}
            />
            <SortableHeader
              label="→ Won"
              active={sortKey === "conv_to_won_rate"}
              dir={sortDir}
              onClick={() => setSort("conv_to_won_rate")}
            />
            <SortableHeader
              label="Accept rate"
              active={sortKey === "accept_rate"}
              dir={sortDir}
              onClick={() => setSort("accept_rate")}
              hint="First Contact only"
            />
            <SortableHeader
              label="Median days to accept"
              active={sortKey === "median_days_to_accept"}
              dir={sortDir}
              onClick={() => setSort("median_days_to_accept")}
              hint="First Contact only"
            />
          </tr>
        </thead>
        <tbody className="divide-y divide-navy/5">
          {sorted.map((r) => {
            const isFc = r.category === "first_contact";
            return (
              <tr key={r.prompt_id} className="hover:bg-offwhite/40">
                <td className="px-4 py-3">
                  <div className="flex flex-col gap-1">
                    <Link
                      href={`/portal/prompts/${r.prompt_id}`}
                      className="font-semibold text-navy hover:underline"
                    >
                      {r.title}
                    </Link>
                    <span
                      className={`inline-block w-fit rounded px-2 py-0.5 text-[10px] font-medium ${
                        CATEGORY_COLORS[r.category] ??
                        "bg-gray-100 text-gray-800"
                      }`}
                    >
                      {CATEGORY_LABELS[r.category] ?? r.category}
                    </span>
                  </div>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-charcoal">
                  {r.uses}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-charcoal">
                  {r.leads_used}
                </td>
                <Cell value={pct(r.reply_rate)} sub={`${r.reply_count}/${r.leads_used}`} />
                <Cell
                  value={pct(r.conv_to_sample_rate)}
                  sub={`${r.conv_to_sample_count}/${r.leads_used}`}
                />
                <Cell
                  value={pct(r.conv_to_won_rate)}
                  sub={`${r.conv_to_won_count}/${r.leads_used}`}
                />
                <Cell
                  value={isFc ? pct(r.accept_rate) : "—"}
                  sub={
                    isFc && r.accept_rate !== null
                      ? `${r.accepted_count}/${r.leads_used}`
                      : null
                  }
                  muted={!isFc}
                />
                <Cell
                  value={
                    isFc && r.median_days_to_accept !== null
                      ? `${r.median_days_to_accept}d`
                      : "—"
                  }
                  muted={!isFc}
                />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({
  label,
  active,
  dir,
  onClick,
  align = "right",
  hint,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
  align?: "left" | "right";
  hint?: string;
}) {
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={`whitespace-nowrap px-4 py-3 font-medium ${
        align === "right" ? "text-right" : "text-left"
      }`}
    >
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 transition-colors ${
          active ? "text-navy" : "hover:text-navy"
        }`}
        title={hint}
      >
        <span>{label}</span>
        <Icon className="h-3 w-3" strokeWidth={2.5} />
      </button>
    </th>
  );
}

function Cell({
  value,
  sub,
  muted,
}: {
  value: string;
  sub?: string | null;
  muted?: boolean;
}) {
  return (
    <td className="whitespace-nowrap px-4 py-3 text-right">
      <div
        className={`tabular-nums ${
          muted ? "text-steel" : "font-semibold text-charcoal"
        }`}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-steel">{sub}</div>}
    </td>
  );
}
