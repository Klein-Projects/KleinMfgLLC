"use client";

import { useMemo } from "react";
import {
  AnalyticsShell,
  SummaryCards,
  SourceTag,
  formatDate,
  formatUSD,
} from "../../_shared/Shell";
import { SortableTable, type Column } from "../../_shared/SortableTable";

type PaidOrder = {
  id: string;
  customer_name: string;
  company_name: string | null;
  product_6in_qty: number;
  product_11in_qty: number;
  total_charged: number;
  created_at: string;
};

type ManualOrder = {
  id: string;
  customer_name: string;
  customer_company: string | null;
  order_date: string;
  parts: Array<{ size: "6in" | "11in"; qty: number; unit_price: number }>;
  total_revenue: number;
  notes: string | null;
};

type LineRow = {
  rowKey: string;
  source: "web" | "manual";
  date: string;
  customer: string;
  company: string;
  size: "6in" | "11in";
  qty: number;
  unitPrice: number | null;
  lineTotal: number | null;
};

export default function PartsSoldClient({
  year,
  paid,
  manual,
}: {
  year: number;
  paid: PaidOrder[];
  manual: ManualOrder[];
}) {
  const rows = useMemo<LineRow[]>(() => {
    const out: LineRow[] = [];
    for (const o of paid) {
      if (o.product_6in_qty > 0) {
        out.push({
          rowKey: `web:${o.id}:6`,
          source: "web",
          date: o.created_at,
          customer: o.customer_name,
          company: o.company_name ?? "",
          size: "6in",
          qty: o.product_6in_qty,
          unitPrice: null,
          lineTotal: null,
        });
      }
      if (o.product_11in_qty > 0) {
        out.push({
          rowKey: `web:${o.id}:11`,
          source: "web",
          date: o.created_at,
          customer: o.customer_name,
          company: o.company_name ?? "",
          size: "11in",
          qty: o.product_11in_qty,
          unitPrice: null,
          lineTotal: null,
        });
      }
    }
    for (const m of manual) {
      const parts = Array.isArray(m.parts) ? m.parts : [];
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        const qty = Number(p.qty) || 0;
        if (qty <= 0) continue;
        const unit = Number(p.unit_price) || 0;
        out.push({
          rowKey: `manual:${m.id}:${i}`,
          source: "manual",
          date: m.order_date,
          customer: m.customer_name,
          company: m.customer_company ?? "",
          size: p.size,
          qty,
          unitPrice: unit,
          lineTotal: qty * unit,
        });
      }
    }
    return out;
  }, [paid, manual]);

  const total6 = rows
    .filter((r) => r.size === "6in")
    .reduce((s, r) => s + r.qty, 0);
  const total11 = rows
    .filter((r) => r.size === "11in")
    .reduce((s, r) => s + r.qty, 0);
  const totalAll = total6 + total11;

  const columns: Column<LineRow>[] = [
    {
      key: "date",
      label: "Order date",
      render: (r) => formatDate(r.date),
      sortValue: (r) => r.date,
    },
    {
      key: "source",
      label: "Source",
      render: (r) =>
        r.source === "web" ? (
          <SourceTag variant="web">Web · Stripe</SourceTag>
        ) : (
          <SourceTag variant="manual">Manual</SourceTag>
        ),
      sortValue: (r) => r.source,
    },
    {
      key: "customer",
      label: "Customer",
      render: (r) => r.customer,
      sortValue: (r) => r.customer.toLowerCase(),
    },
    {
      key: "company",
      label: "Company",
      render: (r) => r.company || "—",
      sortValue: (r) => r.company.toLowerCase(),
    },
    {
      key: "size",
      label: "Size",
      render: (r) => r.size,
      sortValue: (r) => r.size,
    },
    {
      key: "qty",
      label: "Qty",
      align: "right",
      render: (r) => r.qty,
      sortValue: (r) => r.qty,
    },
    {
      key: "unit",
      label: "Unit price",
      align: "right",
      render: (r) =>
        r.unitPrice == null ? (
          <span className="text-steel">—</span>
        ) : (
          formatUSD(r.unitPrice)
        ),
      sortValue: (r) => r.unitPrice ?? -1,
    },
    {
      key: "linetotal",
      label: "Line total",
      align: "right",
      render: (r) =>
        r.lineTotal == null ? (
          <span className="text-steel">—</span>
        ) : (
          <span className="font-semibold">{formatUSD(r.lineTotal)}</span>
        ),
      sortValue: (r) => r.lineTotal ?? -1,
    },
  ];

  return (
    <AnalyticsShell
      metric="Parts sold"
      year={year}
      title={`Parts sold · ${year}`}
      subtitle="Every line item across web orders (Stripe) and manual offline orders. Free samples are tracked separately."
      summary={
        <SummaryCards
          cards={[
            {
              label: "6-inch parts",
              value: total6.toLocaleString(),
              hint: `${rows.filter((r) => r.size === "6in").length} line${
                rows.filter((r) => r.size === "6in").length === 1 ? "" : "s"
              }`,
            },
            {
              label: "11-inch parts",
              value: total11.toLocaleString(),
              hint: `${rows.filter((r) => r.size === "11in").length} line${
                rows.filter((r) => r.size === "11in").length === 1 ? "" : "s"
              }`,
            },
            {
              label: `Total parts · ${year}`,
              value: totalAll.toLocaleString(),
              hint: "6in + 11in across web + manual",
              emphasis: true,
            },
          ]}
        />
      }
    >
      <h3 className="mb-3 text-sm font-semibold text-navy">
        All parts shipped ({rows.length} line{rows.length === 1 ? "" : "s"})
      </h3>
      <SortableTable
        columns={columns}
        rows={rows}
        defaultSort={{ key: "date", dir: "desc" }}
        emptyMessage={`No parts sold in ${year} yet. Add a web order or a manual order to get started.`}
      />
    </AnalyticsShell>
  );
}
