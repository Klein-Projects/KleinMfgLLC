"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  ExternalLink,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import FulfillmentRow from "./FulfillmentRow";
import type { WebOrderRow } from "./ShipmentsClient";

function shortId(id: string): string {
  return id.slice(0, 8);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function trackingUrl(code: string): string {
  return `https://www.ups.com/track?tracknum=${encodeURIComponent(code)}`;
}

export default function WebOrdersTab({
  pageSize,
  readyOrders,
  readyTotal,
  readyPage,
  shippedOrders,
  shippedTotal,
  shippedPage,
  isFiltered,
}: {
  pageSize: number;
  readyOrders: WebOrderRow[];
  readyTotal: number;
  readyPage: number;
  shippedOrders: WebOrderRow[];
  shippedTotal: number;
  shippedPage: number;
  isFiltered: boolean;
}) {
  return (
    <div className="space-y-8">
      <ReadyToShipSection
        orders={readyOrders}
        total={readyTotal}
        page={readyPage}
        pageSize={pageSize}
        isFiltered={isFiltered}
      />
      <RecentlyShippedSection
        orders={shippedOrders}
        total={shippedTotal}
        page={shippedPage}
        pageSize={pageSize}
        isFiltered={isFiltered}
      />
    </div>
  );
}

// ── Ready to Ship ───────────────────────────────────────────

function ReadyToShipSection({
  orders,
  total,
  page,
  pageSize,
  isFiltered,
}: {
  orders: WebOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  isFiltered: boolean;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-navy">Ready to Ship</h2>
        <p className="text-xs text-steel">
          {total} order{total === 1 ? "" : "s"} in queue
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-navy/10 bg-white shadow-sm">
        {orders.length === 0 ? (
          <div className="py-12 text-center text-sm text-steel">
            {isFiltered
              ? "No orders match your search."
              : "Nothing waiting for a label. Nice."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy/10 text-left text-xs uppercase text-steel">
                <th className="px-4 py-3 font-medium">Order #</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Ship to</th>
                <th className="px-4 py-3 font-medium">Items</th>
                <th className="px-4 py-3 font-medium">Weight</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/5">
              {orders.map((o) => (
                <FulfillmentRow key={o.id} order={o} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        param="readyPage"
      />
    </section>
  );
}

// ── Recently Shipped ────────────────────────────────────────

function RecentlyShippedSection({
  orders,
  total,
  page,
  pageSize,
  isFiltered,
}: {
  orders: WebOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  isFiltered: boolean;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-navy">Recently Shipped</h2>
        <p className="text-xs text-steel">last 30 days</p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-navy/10 bg-white shadow-sm">
        {orders.length === 0 ? (
          <div className="py-12 text-center text-sm text-steel">
            {isFiltered
              ? "No shipped orders match your search."
              : "No orders shipped in the last 30 days."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy/10 text-left text-xs uppercase text-steel">
                <th className="px-4 py-3 font-medium">Order #</th>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Tracking</th>
                <th className="px-4 py-3 font-medium">Shipped</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/5">
              {orders.map((o) => (
                <tr
                  key={o.id}
                  className="transition-colors hover:bg-offwhite"
                >
                  <td className="px-4 py-3 font-mono text-xs text-charcoal">
                    {shortId(o.id)}
                  </td>
                  <td className="px-4 py-3 text-charcoal">
                    {o.customer_name}
                  </td>
                  <td className="px-4 py-3">
                    {o.tracking_code ? (
                      <a
                        href={trackingUrl(o.tracking_code)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-mono text-xs text-navy hover:underline"
                      >
                        {o.tracking_code}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    ) : (
                      <span className="text-charcoal/50">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-charcoal/70">
                    {formatDate(o.shipped_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        param="shippedPage"
      />
    </section>
  );
}

// ── Pagination ──────────────────────────────────────────────

function Pagination({
  page,
  pageSize,
  total,
  param,
}: {
  page: number;
  pageSize: number;
  total: number;
  param: "readyPage" | "shippedPage";
}) {
  const router = useRouter();
  const params = useSearchParams();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;

  function go(next: number) {
    const sp = new URLSearchParams(params?.toString() ?? "");
    if (next <= 1) sp.delete(param);
    else sp.set(param, String(next));
    router.push(`/portal/shipments?${sp.toString()}`, { scroll: false });
  }

  return (
    <div className="mt-3 flex items-center justify-end gap-2 text-xs text-steel">
      <span>
        Page {page} of {pages}
      </span>
      <button
        onClick={() => go(page - 1)}
        disabled={page <= 1}
        className="rounded p-1 text-steel hover:bg-navy/5 hover:text-navy disabled:opacity-40"
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        onClick={() => go(page + 1)}
        disabled={page >= pages}
        className="rounded p-1 text-steel hover:bg-navy/5 hover:text-navy disabled:opacity-40"
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
