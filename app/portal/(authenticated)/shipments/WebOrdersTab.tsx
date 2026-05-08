"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Printer,
  ExternalLink,
  PackageCheck,
  XCircle,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import type { WebOrderRow } from "./ShipmentsClient";

const SCRAPER_OZ_6 = 6;
const SCRAPER_OZ_11 = 9;
const PACKAGING_OZ = 4;

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

function lineItemsLabel(o: WebOrderRow): string {
  const parts: string[] = [];
  if (o.product_6in_qty > 0) parts.push(`${o.product_6in_qty}× 6"`);
  if (o.product_11in_qty > 0) parts.push(`${o.product_11in_qty}× 11"`);
  return parts.join(", ") || "—";
}

function weightLabel(o: WebOrderRow): string {
  const oz =
    o.product_6in_qty * SCRAPER_OZ_6 +
    o.product_11in_qty * SCRAPER_OZ_11 +
    PACKAGING_OZ;
  const lbs = oz / 16;
  return `${oz} oz (${lbs.toFixed(2)} lb)`;
}

function trackingUrl(code: string): string {
  return `https://www.ups.com/track?tracknum=${encodeURIComponent(code)}`;
}

function downloadLabel(orderId: string) {
  const link = document.createElement("a");
  link.href = `/api/portal/shipments/${orderId}/label`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
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
                <ReadyRow key={o.id} order={o} />
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

function ReadyRow({ order }: { order: WebOrderRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    "buy" | "reprint" | "ship" | "void" | null
  >(null);

  const isPending = order.shipping_status === "pending";
  const isLabelReady = order.shipping_status === "label_purchased";

  async function handleBuyAndPrint() {
    setError(null);
    setBusyAction("buy");
    try {
      const res = await fetch("/api/portal/shipments/buy-label", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Request failed (${res.status}).`);
      }
      downloadLabel(order.id);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Buy & print failed.");
    } finally {
      setBusyAction(null);
    }
  }

  function handleReprint() {
    downloadLabel(order.id);
  }

  async function handleMarkShipped() {
    setError(null);
    setBusyAction("ship");
    try {
      const res = await fetch("/api/portal/shipments/mark-shipped", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Request failed (${res.status}).`);
      }
      if (json.emailError) {
        setError(`Marked shipped, but email failed: ${json.emailError}`);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Mark shipped failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleVoid() {
    if (
      !window.confirm(
        "Void this label? EasyPost will refund only if UPS hasn't scanned it. " +
          "Once UPS picks up the package, the void will fail and the wallet stays debited."
      )
    ) {
      return;
    }
    setError(null);
    setBusyAction("void");
    try {
      const res = await fetch("/api/portal/shipments/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        throw new Error(json.error ?? `Request failed (${res.status}).`);
      }
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Void failed.");
    } finally {
      setBusyAction(null);
    }
  }

  const busy = pending || busyAction !== null;

  return (
    <>
      <tr className="transition-colors hover:bg-offwhite">
        <td className="px-4 py-3 font-mono text-xs text-charcoal">
          {shortId(order.id)}
        </td>
        <td className="px-4 py-3 text-charcoal">{order.customer_name}</td>
        <td className="px-4 py-3 text-charcoal/70">
          {order.shipping_city}, {order.shipping_state} {order.shipping_zip}
        </td>
        <td className="px-4 py-3 text-charcoal/70">{lineItemsLabel(order)}</td>
        <td className="px-4 py-3 text-charcoal/70">{weightLabel(order)}</td>
        <td className="px-4 py-3">
          {isPending ? (
            <span className="inline-block rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800">
              Needs label
            </span>
          ) : (
            <div className="space-y-1">
              <span className="inline-block rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                Label ready
              </span>
              {order.tracking_code && (
                <div className="font-mono text-[11px] text-charcoal/60">
                  {order.tracking_code}
                </div>
              )}
            </div>
          )}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            {isPending && (
              <button
                onClick={handleBuyAndPrint}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-red px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-red/90 disabled:opacity-50"
              >
                <Printer className="h-3.5 w-3.5" />
                {busyAction === "buy" ? "Buying…" : "Buy & Print Label"}
              </button>
            )}
            {isLabelReady && (
              <>
                <button
                  onClick={handleReprint}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-navy/20 bg-white px-3 py-1.5 text-xs font-medium text-navy transition-colors hover:bg-offwhite disabled:opacity-50"
                  title="Re-download the saved ZPL"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Reprint
                </button>
                <button
                  onClick={handleMarkShipped}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-navy/90 disabled:opacity-50"
                >
                  <PackageCheck className="h-3.5 w-3.5" />
                  {busyAction === "ship" ? "Saving…" : "Mark Shipped"}
                </button>
                <button
                  onClick={handleVoid}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-red/30 bg-white px-3 py-1.5 text-xs font-medium text-red transition-colors hover:bg-red/5 disabled:opacity-50"
                >
                  <XCircle className="h-3.5 w-3.5" />
                  {busyAction === "void" ? "Voiding…" : "Void"}
                </button>
              </>
            )}
          </div>
        </td>
      </tr>
      {error && (
        <tr>
          <td colSpan={7} className="bg-red/5 px-4 py-2 text-xs text-red">
            {error}
          </td>
        </tr>
      )}
    </>
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
