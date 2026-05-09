// ============================================================
// lib/webusb-print.ts
//
// Browser → Zebra ZD421 (or any Zebra USB printer) over WebUSB.
//
// Why this exists: the prior flow downloaded a .zpl file and
// asked the user to send it to the printer manually. WebUSB
// lets us skip the round trip — base64 ZPL bytes from the
// portal go straight to the printer's bulk OUT endpoint.
//
// Permission model: navigator.usb.requestDevice prompts the
// user once per origin per device. Permission persists across
// sessions, so the "Connect Printer" click is one-time.
//
// Windows caveat: the OS print spooler claims the USB printer-
// class interface by default. If the spooler has the interface,
// device.claimInterface throws "unable to claim". We surface
// that as a clear error so the caller can fall back to the
// existing file-download path without breaking the UX.
// ============================================================

const ZEBRA_VENDOR_ID = 0x0a5f;
const PRINTER_INTERFACE_CLASS = 7;

type ClaimedEndpoint = {
  interfaceNumber: number;
  endpointNumber: number;
};

export type ConnectionState =
  | { kind: "unsupported"; reason: string }
  | { kind: "disconnected" }
  | { kind: "connected"; productName: string };

export function isWebUsbSupported(): boolean {
  return typeof navigator !== "undefined" && "usb" in navigator;
}

function findPrinterEndpoint(device: USBDevice): ClaimedEndpoint | null {
  const cfg = device.configuration;
  if (!cfg) return null;
  for (const iface of cfg.interfaces) {
    for (const alt of iface.alternates) {
      if (alt.interfaceClass !== PRINTER_INTERFACE_CLASS) continue;
      const out = alt.endpoints.find(
        (e) => e.direction === "out" && e.type === "bulk"
      );
      if (out) {
        return {
          interfaceNumber: iface.interfaceNumber,
          endpointNumber: out.endpointNumber,
        };
      }
    }
  }
  return null;
}

async function openAndClaim(device: USBDevice): Promise<ClaimedEndpoint> {
  if (!device.opened) await device.open();
  if (!device.configuration) await device.selectConfiguration(1);
  const ep = findPrinterEndpoint(device);
  if (!ep) {
    throw new Error(
      "Connected device does not expose a USB printer interface."
    );
  }
  try {
    await device.claimInterface(ep.interfaceNumber);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      "Could not claim the printer's USB interface. On Windows, the print " +
        "spooler may be holding it — close any open Zebra software and " +
        "try again. (" +
        msg +
        ")"
    );
  }
  return ep;
}

export async function getConnectionState(): Promise<ConnectionState> {
  if (!isWebUsbSupported()) {
    return {
      kind: "unsupported",
      reason: "WebUSB requires Chrome or Edge on a desktop.",
    };
  }
  const devices = await navigator.usb.getDevices();
  const zebra = devices.find((d) => d.vendorId === ZEBRA_VENDOR_ID);
  if (!zebra) return { kind: "disconnected" };
  return {
    kind: "connected",
    productName: zebra.productName ?? "Zebra printer",
  };
}

export async function requestZebraPrinter(): Promise<USBDevice> {
  if (!isWebUsbSupported()) {
    throw new Error(
      "This browser does not support WebUSB. Use Chrome or Edge on a desktop."
    );
  }
  const device = await navigator.usb.requestDevice({
    filters: [{ vendorId: ZEBRA_VENDOR_ID }],
  });
  // Open + claim immediately so any spooler-conflict surface up at
  // connect time, not later when the user tries to print.
  await openAndClaim(device);
  return device;
}

export async function printZplBytes(bytes: Uint8Array): Promise<void> {
  if (!isWebUsbSupported()) {
    throw new Error("WebUSB is not supported in this browser.");
  }
  const devices = await navigator.usb.getDevices();
  const device = devices.find((d) => d.vendorId === ZEBRA_VENDOR_ID);
  if (!device) {
    throw new Error(
      "No Zebra printer connected. Click 'Connect Printer' first."
    );
  }
  const ep = await openAndClaim(device);
  // ZD421 takes 16 KB chunks comfortably. Larger transfers can stall
  // on slower hubs.
  const CHUNK = 16 * 1024;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    const end = Math.min(offset + CHUNK, bytes.length);
    const chunk = bytes.slice(offset, end);
    const result = await device.transferOut(ep.endpointNumber, chunk);
    if (result.status !== "ok") {
      throw new Error(`USB transfer status: ${result.status}.`);
    }
  }
}

export function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
