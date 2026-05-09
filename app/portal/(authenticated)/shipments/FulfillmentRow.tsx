"use client";

// ============================================================
// FulfillmentRow — a single Buy/Print/Mark Shipped/Void row.
// Used by both the Web Orders tab and the Open Sample Requests
// section on the Sample Tracking tab. Same handlers, same four
// endpoints — the table around it decides which list it belongs
// to via the page-level query filters.
// ============================================================

import { useState } from "react";
import {
  Printer,
  PackageCheck,
  XCircle,
} from "lucide-react";
import { revalidateShipments } from "./actions";
import type { WebOrderRow } from "./ShipmentsClient";
import {
  base64ToBytes,
  getConnectionState,
  isSpoolerConflict,
  isWebUsbBlocked,
  markWebUsbBlocked,
  printZplBytes,
} from "@/lib/webusb-print";

const SCRAPER_OZ_6 = 6;
const SCRAPER_OZ_11 = 9;
const PACKAGING_OZ = 4;

function shortId(id: string): string {
  return id.slice(0, 8);
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

function downloadLabel(orderId: string) {
  const link = document.createElement("a");
  link.href = `/api/portal/shipments/${orderId}/label`;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export default function FulfillmentRow({ order }: { order: WebOrderRow }) {
  const [error, setError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<
    "buy" | "reprint" | "ship" | "void" | null
  >(null);

  const isPending = order.shipping_status === "pending";
  const isLabelReady = order.shipping_status === "label_purchased";

  // Try direct USB print via the connected Zebra. Returns true if the
  // bytes made it onto the printer; false if WebUSB is disabled,
  // sticky-blocked, no printer paired, or the spooler is holding the
  // interface. Spooler conflicts permanently flip the sticky-blocked
  // flag so subsequent clicks don't bother trying — the download →
  // file-association auto-print path handles printing from then on.
  // Non-spooler errors propagate up so we don't silently drop them.
  async function tryDirectPrintBase64(base64: string): Promise<boolean> {
    if (isWebUsbBlocked()) return false;
    const state = await getConnectionState();
    if (state.kind !== "connected") return false;
    try {
      await printZplBytes(base64ToBytes(base64));
      return true;
    } catch (e) {
      if (isSpoolerConflict(e)) {
        markWebUsbBlocked();
        return false;
      }
      throw e;
    }
  }

  async function tryDirectPrintFromEndpoint(): Promise<boolean> {
    if (isWebUsbBlocked()) return false;
    const state = await getConnectionState();
    if (state.kind !== "connected") return false;
    const res = await fetch(`/api/portal/shipments/${order.id}/label`);
    if (!res.ok) {
      throw new Error(
        `Could not fetch label for direct print (HTTP ${res.status}).`
      );
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    try {
      await printZplBytes(bytes);
      return true;
    } catch (e) {
      if (isSpoolerConflict(e)) {
        markWebUsbBlocked();
        return false;
      }
      throw e;
    }
  }

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
      // Direct USB print if WebUSB works on this machine; otherwise
      // fall back silently to the file-download path. The download
      // either auto-opens via the .zpl file association (true one-
      // click) or the user opens it manually — both end up printing.
      let printed = false;
      if (typeof json.label_zpl_base64 === "string") {
        try {
          printed = await tryDirectPrintBase64(json.label_zpl_base64);
        } catch (printErr) {
          // Non-spooler error (e.g. transfer stall) — surface it so
          // the user knows the bytes didn't reach the printer.
          setError(
            "Label was bought, but direct print failed: " +
              (printErr instanceof Error ? printErr.message : String(printErr)) +
              " — downloading the file instead."
          );
        }
      }
      if (!printed) downloadLabel(order.id);
      await revalidateShipments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Buy & print failed.");
    } finally {
      setBusyAction(null);
    }
  }

  async function handleReprint() {
    setError(null);
    setBusyAction("reprint");
    try {
      let printed = false;
      try {
        printed = await tryDirectPrintFromEndpoint();
      } catch (printErr) {
        setError(
          "Direct print failed: " +
            (printErr instanceof Error ? printErr.message : String(printErr)) +
            " — downloading the file instead."
        );
      }
      if (!printed) downloadLabel(order.id);
    } finally {
      setBusyAction(null);
    }
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
      await revalidateShipments();
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
      await revalidateShipments();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Void failed.");
    } finally {
      setBusyAction(null);
    }
  }

  const busy = busyAction !== null;

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
                {busyAction === "buy"
                  ? "Buying & printing…"
                  : "Buy & Print Label"}
              </button>
            )}
            {isLabelReady && (
              <>
                <button
                  onClick={handleReprint}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-navy/20 bg-white px-3 py-1.5 text-xs font-medium text-navy transition-colors hover:bg-offwhite disabled:opacity-50"
                  title="Send the saved label to the connected Zebra (or re-download if none connected)"
                >
                  <Printer className="h-3.5 w-3.5" />
                  {busyAction === "reprint" ? "Reprinting…" : "Reprint"}
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
