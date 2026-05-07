// ============================================================
// Klein Manufacturing LLC — EasyPost shared client + constants
// Phase 15L.2: hardcoded origin address + UPS wallet carrier ID
// ============================================================

const EASYPOST_API_BASE = "https://api.easypost.com/v2";

/**
 * Klein origin address. Used as from_address for every shipment.
 * UPS REJECTS shipments without state on the from_address — keep "CA".
 */
export const KLEIN_ORIGIN = {
  name: "Klein Manufacturing, LLC",
  company: "Klein Manufacturing, LLC",
  street1: "5621 Skyridge Drive",
  city: "Orangevale",
  state: "CA", // REQUIRED — UPS rejects without it
  zip: "95662",
  country: "US",
  phone: "916-671-4772",
} as const;

/**
 * EasyPost Wallet UPS carrier account ID.
 * Discounted UPS aggregator rates billed against your EasyPost wallet balance.
 */
export const UPS_WALLET_ACCOUNT = "ca_bfeb7521397041d8a5a69c1f8bf77ebb";

/**
 * Default parcel dimensions for Klein shipments (inches).
 * Single box size that fits both 6" and 11" scrapers, 1–30 units.
 * Adjust if you switch box sizes — affects dimensional-weight rates.
 */
export const KLEIN_PARCEL_DIMS = {
  length: 12,
  width: 9,
  height: 4,
} as const;

/**
 * Per-unit shipping weights (oz). 4oz packaging is added on top.
 * Source: Phase 15L build plan parcel weight formula.
 */
export const SCRAPER_WEIGHTS_OZ = {
  six_inch: 6,
  eleven_inch: 9,
  packaging: 4,
} as const;

/**
 * Compute total parcel weight in ounces from line item quantities.
 */
export function calcParcelWeightOz(qty6: number, qty11: number): number {
  return (
    qty6 * SCRAPER_WEIGHTS_OZ.six_inch +
    qty11 * SCRAPER_WEIGHTS_OZ.eleven_inch +
    SCRAPER_WEIGHTS_OZ.packaging
  );
}

/**
 * Authenticated request to the EasyPost v2 API.
 * EasyPost uses HTTP Basic with the API key as the username (empty password).
 */
export async function easypostFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  const apiKey = process.env.EASYPOST_API_KEY;
  if (!apiKey) {
    throw new Error("EASYPOST_API_KEY is not set");
  }
  const auth = Buffer.from(`${apiKey}:`).toString("base64");
  return fetch(`${EASYPOST_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

// EasyPost response shapes we touch (partial — only fields we read).
export type EasyPostRate = {
  id: string;
  carrier: string;
  service: string;
  rate: string; // dollars, as string
};

export type EasyPostPostageLabel = {
  label_url: string;
  label_zpl_url?: string;
  label_pdf_url?: string;
};

export type EasyPostShipment = {
  id: string;
  tracking_code?: string;
  rates?: EasyPostRate[];
  selected_rate?: EasyPostRate;
  postage_label?: EasyPostPostageLabel;
  messages?: Array<{ carrier: string; type: string; message: string }>;
};
