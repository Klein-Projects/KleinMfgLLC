import { NextResponse } from "next/server";

const ORIGIN_ZIP = "95662";
const ORIGIN_STATE = "CA"; // Required by UPS — they reject from_address without state.

// Per build plan
const WEIGHT_BASE_OZ = 1.5 * 16; // 1.5 lb box base
const WEIGHT_6IN_OZ = 1.55;
const WEIGHT_11IN_OZ = 3.55;

// Box dimensions (inches) — sized to fit the 11" scrapers; adjust if you have a real box spec
const BOX_LENGTH_IN = 12;
const BOX_WIDTH_IN = 8;
const BOX_HEIGHT_IN = 4;

const EASYPOST_BASE_URL = "https://api.easypost.com/v2";

// UPS via EasyPost Wallet (UPSDAP). Pass explicitly so EasyPost includes it.
const UPS_CARRIER_ACCOUNT_ID = "ca_bfeb7521397041d8a5a69c1f8bf77ebb";

type EasyPostRate = {
  carrier?: string;
  service?: string;
  rate?: string;
  currency?: string;
};

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { zip, qty6, qty11 } = body ?? {};

  if (typeof zip !== "string" || !/^\d{5}(-\d{4})?$/.test(zip.trim())) {
    return NextResponse.json(
      { error: "A valid 5-digit ZIP code is required." },
      { status: 400 }
    );
  }

  const q6 = Number.isInteger(qty6) ? qty6 : parseInt(qty6, 10);
  const q11 = Number.isInteger(qty11) ? qty11 : parseInt(qty11, 10);

  if (
    !Number.isFinite(q6) ||
    q6 < 0 ||
    !Number.isFinite(q11) ||
    q11 < 0 ||
    q6 + q11 < 1
  ) {
    return NextResponse.json(
      { error: "At least one scraper must be ordered." },
      { status: 400 }
    );
  }

  const apiKey = process.env.EASYPOST_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "EASYPOST_API_KEY is not set." },
      { status: 500 }
    );
  }

  const totalOz =
    WEIGHT_BASE_OZ + q6 * WEIGHT_6IN_OZ + q11 * WEIGHT_11IN_OZ;

  // Log key prefix only (EZAK_ = production, EZTK_ = test) — never log full key.
  const keyPrefix = apiKey.slice(0, 5);
  const keyMode = apiKey.startsWith("EZAK") ? "PRODUCTION" : apiKey.startsWith("EZTK") ? "TEST" : "UNKNOWN";
  console.log(
    `[shipping-rate] EasyPost key prefix=${keyPrefix} mode=${keyMode} totalOz=${totalOz.toFixed(2)} toZip=${zip.trim()}`
  );

  // EasyPost Basic auth: API key as username, empty password.
  const authHeader =
    "Basic " + Buffer.from(`${apiKey}:`).toString("base64");

  try {
    const epRes = await fetch(`${EASYPOST_BASE_URL}/shipments`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        shipment: {
          to_address: { zip: zip.trim(), country: "US" },
          from_address: { zip: ORIGIN_ZIP, state: ORIGIN_STATE, country: "US" },
          parcel: {
            length: BOX_LENGTH_IN,
            width: BOX_WIDTH_IN,
            height: BOX_HEIGHT_IN,
            weight: Number(totalOz.toFixed(2)),
          },
          carrier_accounts: [UPS_CARRIER_ACCOUNT_ID],
        },
      }),
    });

    const epBody = await epRes.json().catch(() => null);

    // Full raw response for debugging UPS visibility.
    console.log(
      "[shipping-rate] EasyPost raw response:",
      JSON.stringify(
        {
          status: epRes.status,
          rates: epBody?.rates,
          messages: epBody?.messages,
          error: epBody?.error,
        },
        null,
        2
      )
    );

    if (!epRes.ok) {
      const message =
        epBody?.error?.message ||
        epBody?.error ||
        `EasyPost returned ${epRes.status}.`;
      return NextResponse.json(
        { error: typeof message === "string" ? message : "EasyPost error." },
        { status: 502 }
      );
    }

    const rates: EasyPostRate[] = Array.isArray(epBody?.rates)
      ? epBody.rates
      : [];

    // Accept both "UPS" (paid carrier accounts) and "UPSDAP" (EasyPost Wallet UPS).
    const upsGround = rates.find(
      (r) =>
        (r.carrier === "UPS" || r.carrier === "UPSDAP") &&
        r.service === "Ground"
    );

    if (!upsGround || !upsGround.rate) {
      return NextResponse.json(
        { error: "No UPS Ground rate available for this destination." },
        { status: 502 }
      );
    }

    const amountCents = Math.round(parseFloat(upsGround.rate) * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return NextResponse.json(
        { error: "Could not parse UPS Ground rate." },
        { status: 502 }
      );
    }

    return NextResponse.json({ amountCents }, { status: 200 });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Could not fetch shipping rate.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
