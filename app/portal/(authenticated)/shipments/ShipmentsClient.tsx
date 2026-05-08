"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Truck, Inbox } from "lucide-react";
import WebOrdersTab from "./WebOrdersTab";
import SampleTrackingTab from "./SampleTrackingTab";

export type WebOrderRow = {
  id: string;
  created_at: string;
  customer_name: string;
  customer_email: string;
  shipping_city: string;
  shipping_state: string;
  shipping_zip: string;
  product_6in_qty: number;
  product_11in_qty: number;
  shipping_status:
    | "pending"
    | "label_purchased"
    | "shipped"
    | "delivered"
    | "voided";
  shipped_at: string | null;
  tracking_code: string | null;
  carrier: string | null;
  service: string | null;
  rate_amount: string | number | null;
  label_purchased_at: string | null;
};

export type SampleShipmentRow = {
  id: string;
  tracking_number: string;
  carrier: string;
  status:
    | "pending"
    | "in_transit"
    | "out_for_delivery"
    | "delivered"
    | "exception";
  recipient_name: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  notes: string | null;
  lead_id: string | null;
  lead: {
    id: string;
    contact: { first_name: string; last_name: string } | null;
    company: { name: string } | null;
  } | null;
};

type TabKey = "web-orders" | "samples";

export default function ShipmentsClient({
  initialTab,
  pageSize,
  readyOrders,
  readyTotal,
  readyPage,
  shippedOrders,
  shippedTotal,
  shippedPage,
  samples,
}: {
  initialTab: TabKey;
  pageSize: number;
  readyOrders: WebOrderRow[];
  readyTotal: number;
  readyPage: number;
  shippedOrders: WebOrderRow[];
  shippedTotal: number;
  shippedPage: number;
  samples: SampleShipmentRow[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState<TabKey>(initialTab);
  const [query, setQuery] = useState("");

  function selectTab(next: TabKey) {
    setTab(next);
    const sp = new URLSearchParams(params?.toString() ?? "");
    if (next === "samples") sp.set("tab", "samples");
    else sp.delete("tab");
    router.replace(`/portal/shipments?${sp.toString()}`, { scroll: false });
  }

  // Client-side search filter — applies to both tabs across the rows already
  // loaded for this page. Order # match is on the first 8 hex chars of the UUID.
  const trimmed = query.trim().toLowerCase();
  const filteredReady = useMemo(
    () => filterOrders(readyOrders, trimmed),
    [readyOrders, trimmed]
  );
  const filteredShipped = useMemo(
    () => filterOrders(shippedOrders, trimmed),
    [shippedOrders, trimmed]
  );
  const filteredSamples = useMemo(
    () => filterSamples(samples, trimmed),
    [samples, trimmed]
  );

  return (
    <div className="p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-navy">Shipments</h1>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search order # or customer…"
            className="w-72 rounded-md border border-navy/20 bg-white py-2.5 pl-9 pr-3 text-sm text-charcoal placeholder:text-steel focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>
      </div>

      <div className="mt-6 flex gap-1 rounded-lg bg-navy/5 p-1">
        <TabButton
          active={tab === "web-orders"}
          onClick={() => selectTab("web-orders")}
          icon={<Truck className="h-4 w-4" />}
          label="Web Orders"
          count={readyTotal}
        />
        <TabButton
          active={tab === "samples"}
          onClick={() => selectTab("samples")}
          icon={<Inbox className="h-4 w-4" />}
          label="Sample Tracking"
          count={samples.length}
        />
      </div>

      <div className="mt-6">
        {tab === "web-orders" ? (
          <WebOrdersTab
            pageSize={pageSize}
            readyOrders={filteredReady}
            readyTotal={readyTotal}
            readyPage={readyPage}
            shippedOrders={filteredShipped}
            shippedTotal={shippedTotal}
            shippedPage={shippedPage}
            isFiltered={trimmed.length > 0}
          />
        ) : (
          <SampleTrackingTab initialShipments={filteredSamples} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
        active
          ? "bg-white text-navy shadow-sm"
          : "text-steel hover:text-navy"
      }`}
    >
      {icon}
      <span>{label}</span>
      <span
        className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-xs font-medium ${
          active ? "bg-navy/10 text-navy" : "bg-navy/5 text-steel"
        }`}
      >
        {count}
      </span>
    </button>
  );
}

function filterOrders(rows: WebOrderRow[], q: string): WebOrderRow[] {
  if (!q) return rows;
  return rows.filter((r) => {
    const shortId = r.id.slice(0, 8).toLowerCase();
    return (
      shortId.includes(q) ||
      r.id.toLowerCase().includes(q) ||
      r.customer_name.toLowerCase().includes(q) ||
      (r.tracking_code ?? "").toLowerCase().includes(q)
    );
  });
}

function filterSamples(
  rows: SampleShipmentRow[],
  q: string
): SampleShipmentRow[] {
  if (!q) return rows;
  return rows.filter((r) => {
    const tn = r.tracking_number.toLowerCase();
    const recipient = (r.recipient_name ?? "").toLowerCase();
    const contactName = r.lead?.contact
      ? `${r.lead.contact.first_name} ${r.lead.contact.last_name}`.toLowerCase()
      : "";
    const company = (r.lead?.company?.name ?? "").toLowerCase();
    return (
      tn.includes(q) ||
      recipient.includes(q) ||
      contactName.includes(q) ||
      company.includes(q)
    );
  });
}
