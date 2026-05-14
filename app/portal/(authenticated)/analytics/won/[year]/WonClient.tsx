"use client";

import Link from "next/link";
import {
  AnalyticsShell,
  SummaryCards,
  formatDate,
  formatUSD,
} from "../../_shared/Shell";
import { SortableTable, type Column } from "../../_shared/SortableTable";

type WonLead = {
  id: string;
  closed_won_at: string;
  status: string;
  value_estimate: number | null;
  contact: { first_name: string; last_name: string } | null;
  company: { name: string } | null;
  // Linked manual_orders rows the dashboard pulls deal value from.
  manual_orders: Array<{
    id: string;
    total_revenue: number;
    order_date: string;
  }>;
};

export default function WonClient({
  year,
  leads,
}: {
  year: number;
  leads: WonLead[];
}) {
  const enriched = leads.map((l) => {
    const dealValue = (l.manual_orders ?? []).reduce(
      (s, m) => s + Number(m.total_revenue ?? 0),
      0,
    );
    return { ...l, dealValue };
  });

  const totalDealValue = enriched.reduce((s, l) => s + l.dealValue, 0);
  const withDealValue = enriched.filter((l) => l.dealValue > 0).length;

  const columns: Column<typeof enriched[number]>[] = [
    {
      key: "closed_won_at",
      label: "Closed",
      render: (r) => formatDate(r.closed_won_at),
      sortValue: (r) => r.closed_won_at,
    },
    {
      key: "customer",
      label: "Customer",
      render: (r) => {
        const name = r.contact
          ? `${r.contact.first_name} ${r.contact.last_name}`
          : "—";
        return (
          <Link
            href={`/portal/leads/${r.id}`}
            className="font-semibold text-navy underline-offset-2 hover:underline"
          >
            {name}
          </Link>
        );
      },
      sortValue: (r) =>
        r.contact
          ? `${r.contact.first_name} ${r.contact.last_name}`.toLowerCase()
          : "",
    },
    {
      key: "company",
      label: "Company",
      render: (r) => r.company?.name ?? "—",
      sortValue: (r) => r.company?.name?.toLowerCase() ?? "",
    },
    {
      key: "deal_value",
      label: "Deal value",
      align: "right",
      render: (r) =>
        r.dealValue > 0 ? (
          <span className="font-semibold">{formatUSD(r.dealValue)}</span>
        ) : (
          <span className="text-steel">—</span>
        ),
      sortValue: (r) => r.dealValue,
    },
    {
      key: "value_estimate",
      label: "Estimate",
      align: "right",
      render: (r) =>
        r.value_estimate ? formatUSD(Number(r.value_estimate)) : "—",
      sortValue: (r) => Number(r.value_estimate ?? 0),
    },
    {
      key: "manual_count",
      label: "Manual orders",
      align: "right",
      render: (r) => (r.manual_orders?.length ?? 0) || "—",
      sortValue: (r) => r.manual_orders?.length ?? 0,
    },
    {
      key: "lead",
      label: "Lead",
      render: (r) => (
        <Link
          href={`/portal/leads/${r.id}`}
          className="text-navy underline-offset-2 hover:underline"
        >
          View →
        </Link>
      ),
      sortable: false,
    },
  ];

  return (
    <AnalyticsShell
      metric="Won deals"
      year={year}
      title={`Won deals · ${year}`}
      subtitle="Every lead with status='won' AND closed_won_at in this year. Deal value joined from linked manual_orders."
      summary={
        <SummaryCards
          cards={[
            {
              label: "Won leads",
              value: leads.length.toLocaleString(),
              hint: `${withDealValue} with deal value attached`,
            },
            {
              label: "Manual-order revenue",
              value: formatUSD(totalDealValue),
              hint: "Across all won leads in this year",
            },
            {
              label: `Wins · ${year}`,
              value: leads.length.toLocaleString(),
              hint: "status='won' · year(closed_won_at) = year",
              emphasis: true,
            },
          ]}
        />
      }
    >
      <h3 className="mb-3 text-sm font-semibold text-navy">
        All won deals ({leads.length})
      </h3>
      <SortableTable
        columns={columns}
        rows={enriched}
        defaultSort={{ key: "closed_won_at", dir: "desc" }}
        emptyMessage={`No leads marked 'won' in ${year} yet. Use "Mark as Won" on a lead detail page to log one.`}
      />
      <p className="mt-3 text-[11px] text-steel">
        Web-order revenue (Stripe) isn&apos;t attached here yet because{" "}
        <code className="rounded bg-offwhite px-1 py-0.5">orders</code>{" "}
        doesn&apos;t carry a <code>lead_id</code> FK. Add a manual order from
        the Revenue page and link it to this lead to populate Deal value.
      </p>
    </AnalyticsShell>
  );
}
