"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";

export type Column<T> = {
  key: string;
  label: string;
  sortable?: boolean;
  align?: "left" | "right";
  className?: string;
  render: (row: T) => React.ReactNode;
  // Returns the comparable value for this column. If omitted, the
  // column is treated as not sortable regardless of the sortable flag.
  sortValue?: (row: T) => string | number | null | undefined;
};

export function SortableTable<T>({
  columns,
  rows,
  defaultSort,
  emptyMessage = "No records found.",
}: {
  columns: Column<T>[];
  rows: T[];
  defaultSort?: { key: string; dir: "asc" | "desc" };
  emptyMessage?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(
    defaultSort?.key ?? null,
  );
  const [sortDir, setSortDir] = useState<"asc" | "desc">(
    defaultSort?.dir ?? "desc",
  );

  function handleSort(col: Column<T>) {
    if (col.sortable === false || !col.sortValue) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("desc");
    }
  }

  const sortedRows = (() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  })();

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-navy/10 bg-white py-12 text-center text-sm text-steel">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-navy/10 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead className="bg-offwhite text-left">
          <tr>
            {columns.map((c) => {
              const isSorted = sortKey === c.key;
              const canSort = c.sortable !== false && !!c.sortValue;
              const Indicator = isSorted
                ? sortDir === "asc"
                  ? ArrowUp
                  : ArrowDown
                : ArrowUpDown;
              return (
                <th
                  key={c.key}
                  onClick={() => handleSort(c)}
                  className={`px-3 py-2 text-[11px] font-bold uppercase tracking-wide text-steel ${
                    c.align === "right" ? "text-right" : ""
                  } ${canSort ? "cursor-pointer select-none hover:text-navy" : ""}`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {c.label}
                    {canSort && (
                      <Indicator
                        className={`h-3 w-3 ${isSorted ? "text-navy" : "text-charcoal/30"}`}
                        strokeWidth={2}
                      />
                    )}
                  </span>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-navy/5">
          {sortedRows.map((row, i) => (
            <tr key={i} className="hover:bg-offwhite/40">
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-3 py-2 ${
                    c.align === "right" ? "text-right tabular-nums" : ""
                  } ${c.className ?? ""}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
