"use client";

// ============================================================
// PrinterStatusWidget — header chip on /portal/shipments
//
// Three states:
//   - hidden        : WebUSB unsupported (no Chrome/Edge), nothing to do.
//   - "Connect"     : supported but no printer authorized yet — clicking
//                     prompts the browser's USB picker (one-time per
//                     origin/device).
//   - "Connected"   : printer is authorized; future Buy & Print / Reprint
//                     clicks will print directly via WebUSB.
// ============================================================

import { useEffect, useState } from "react";
import { Printer, CheckCircle2 } from "lucide-react";
import {
  getConnectionState,
  isWebUsbSupported,
  requestZebraPrinter,
  type ConnectionState,
} from "@/lib/webusb-print";

export default function PrinterStatusWidget() {
  const [state, setState] = useState<ConnectionState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isWebUsbSupported()) {
      setState({ kind: "unsupported", reason: "WebUSB not supported." });
      return;
    }
    getConnectionState()
      .then(setState)
      .catch(() => setState({ kind: "disconnected" }));
  }, []);

  if (!state || state.kind === "unsupported") return null;

  if (state.kind === "connected") {
    return (
      <div
        className="inline-flex items-center gap-1.5 rounded-md bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700"
        title={`${state.productName} is connected — Buy & Print / Reprint will print directly to it.`}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        <span>Printer connected</span>
      </div>
    );
  }

  async function connect() {
    setError(null);
    setBusy(true);
    try {
      await requestZebraPrinter();
      const next = await getConnectionState();
      setState(next);
    } catch (e) {
      // User-cancelled the picker is the most common case — surfaces
      // as "No device selected." which we don't treat as an error.
      const msg = e instanceof Error ? e.message : String(e);
      if (!/no device selected/i.test(msg)) setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={connect}
        disabled={busy}
        className="inline-flex items-center gap-1.5 rounded-md border border-navy/20 bg-white px-3 py-1.5 text-xs font-medium text-navy transition-colors hover:bg-offwhite disabled:opacity-50"
        title="Authorize this site to talk to your Zebra printer over USB. One-time grant — Chrome remembers it."
      >
        <Printer className="h-3.5 w-3.5" />
        {busy ? "Waiting for picker…" : "Connect Zebra Printer"}
      </button>
      {error && (
        <span className="max-w-xs text-right text-[11px] text-red">
          {error}
        </span>
      )}
    </div>
  );
}
