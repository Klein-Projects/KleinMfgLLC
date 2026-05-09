import { NextRequest, NextResponse } from "next/server";
import { requirePortalAuth } from "@/lib/portal-auth";
import { easypostFetch, type EasyPostShipment } from "@/lib/easypost";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type OrderRow = {
  id: string;
  shipment_id: string | null;
  label_url: string | null;
  label_zpl: string | null;
  shipping_status: string;
};

type Ctx = { params: { orderId: string } };

// ZPL II files start with `^XA`. We use this to validate that a cached
// label_zpl base64 string actually decodes to real ZPL bytes — if it
// doesn't (e.g., legacy rows from before the binary-safe fix that stored
// UTF-8-decoded label content as plain text), we self-heal by re-fetching
// from EasyPost using the order's shipment_id.
const ZPL_HEADER_HEX = "5e5841"; // "^XA"

function looksLikeZpl(bytes: Buffer): boolean {
  return (
    bytes.length >= 3 &&
    bytes.slice(0, 3).toString("hex").toLowerCase() === ZPL_HEADER_HEX
  );
}

async function fetchFreshZplBytes(
  shipmentId: string
): Promise<{ ok: true; bytes: Buffer } | { ok: false; status: number; reason: string }> {
  const convertRes = await easypostFetch(
    `/shipments/${shipmentId}/label?file_format=zpl`
  );
  if (!convertRes.ok) {
    return {
      ok: false,
      status: 502,
      reason: `EasyPost label conversion HTTP ${convertRes.status}.`,
    };
  }
  let shipment: EasyPostShipment;
  try {
    shipment = await convertRes.json();
  } catch {
    return {
      ok: false,
      status: 502,
      reason: "EasyPost returned an unreadable conversion response.",
    };
  }
  const labelZplUrl = shipment.postage_label?.label_zpl_url;
  if (!labelZplUrl) {
    return {
      ok: false,
      status: 502,
      reason: "EasyPost did not return a label_zpl_url after conversion.",
    };
  }
  const labelRes = await fetch(labelZplUrl);
  if (!labelRes.ok) {
    return {
      ok: false,
      status: 502,
      reason: `ZPL download HTTP ${labelRes.status}.`,
    };
  }
  return { ok: true, bytes: Buffer.from(await labelRes.arrayBuffer()) };
}

// GET /api/portal/shipments/[orderId]/label
//   default       → streams the saved ZPL as klein-label-<short>.zpl
//   ?format=pdf   → asks EasyPost to re-render the label as PDF and streams it,
//                   for emergency printing on a non-Zebra printer.
export async function GET(req: NextRequest, { params }: Ctx) {
  const auth = await requirePortalAuth();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  const orderId = (params.orderId ?? "").trim();
  if (!UUID_RE.test(orderId)) {
    return NextResponse.json(
      { error: "orderId must be a valid UUID." },
      { status: 400 }
    );
  }

  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .select("id, shipment_id, label_url, label_zpl, shipping_status")
    .eq("id", orderId)
    .maybeSingle<OrderRow>();

  if (orderErr) {
    console.error("[label] order lookup failed:", orderErr);
    return NextResponse.json({ error: orderErr.message }, { status: 500 });
  }
  if (!order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  if (!order.label_zpl && !order.shipment_id) {
    return NextResponse.json(
      {
        error:
          "No label on file for this order — buy a label first via the Buy & Print Label button.",
        shipping_status: order.shipping_status,
      },
      { status: 404 }
    );
  }

  // Short ID used in the download filename. The orders table has no separate
  // order number — the first 8 hex chars of the UUID are a stable identifier.
  const shortId = order.id.slice(0, 8);

  const format = (req.nextUrl.searchParams.get("format") ?? "").toLowerCase();

  // ── PDF fallback for non-Zebra printers ──────────────────────────────
  if (format === "pdf") {
    if (!order.shipment_id) {
      return NextResponse.json(
        {
          error:
            "Order has no EasyPost shipment_id, so a PDF cannot be re-rendered.",
        },
        { status: 422 }
      );
    }

    // Ask EasyPost to convert the existing label to PDF.
    const convertRes = await easypostFetch(
      `/shipments/${order.shipment_id}/label?file_format=PDF`
    );

    let shipment: EasyPostShipment;
    try {
      shipment = await convertRes.json();
    } catch {
      console.error("[label] EasyPost PDF conversion non-JSON", {
        status: convertRes.status,
      });
      return NextResponse.json(
        { error: "EasyPost returned an unreadable response." },
        { status: 502 }
      );
    }

    const pdfUrl =
      shipment.postage_label?.label_pdf_url ??
      shipment.postage_label?.label_url;

    if (!convertRes.ok || !pdfUrl) {
      console.error("[label] EasyPost PDF conversion failed", {
        status: convertRes.status,
        messages: shipment.messages,
      });
      return NextResponse.json(
        {
          error: "EasyPost failed to provide a PDF version of this label.",
          easypost: shipment,
        },
        { status: 502 }
      );
    }

    const pdfRes = await fetch(pdfUrl);
    if (!pdfRes.ok) {
      console.error("[label] PDF download failed", { status: pdfRes.status });
      return NextResponse.json(
        { error: `Failed to download PDF (HTTP ${pdfRes.status}).` },
        { status: 502 }
      );
    }
    const pdfBytes = await pdfRes.arrayBuffer();

    return new NextResponse(pdfBytes, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="klein-label-${shortId}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  }

  // ── Default: serve the cached ZPL bytes ─────────────────────────────
  // label_zpl is stored as base64 (binary-safe). If decoding it produces
  // valid ZPL bytes (starts with ^XA), serve them. Otherwise — legacy
  // rows from before the binary fix that stored UTF-8-decoded text —
  // self-heal by re-fetching from EasyPost using shipment_id and update
  // the cache for next time.
  let labelBytes: Buffer | null = null;

  if (order.label_zpl) {
    try {
      const decoded = Buffer.from(order.label_zpl, "base64");
      if (looksLikeZpl(decoded)) {
        labelBytes = decoded;
      }
    } catch {
      // base64 decode threw (very unusual) — fall through to re-fetch
    }
  }

  if (!labelBytes) {
    if (!order.shipment_id) {
      return NextResponse.json(
        {
          error:
            "Cached label is invalid and no EasyPost shipment_id is on file " +
            "to re-fetch it. Buy a fresh label or print manually from the " +
            "carrier-default label_url.",
          label_url: order.label_url,
        },
        { status: 422 }
      );
    }
    const fresh = await fetchFreshZplBytes(order.shipment_id);
    if (!fresh.ok) {
      console.error("[label] self-heal re-fetch failed", {
        orderId: order.id,
        shipmentId: order.shipment_id,
        reason: fresh.reason,
      });
      return NextResponse.json(
        {
          error:
            "Could not re-fetch the ZPL from EasyPost. " + fresh.reason,
          label_url: order.label_url,
        },
        { status: fresh.status }
      );
    }
    labelBytes = fresh.bytes;
    // Update the cache so future reprints are fast and don't hit EasyPost.
    const newBase64 = labelBytes.toString("base64");
    const { error: cacheErr } = await supabase
      .from("orders")
      .update({ label_zpl: newBase64 })
      .eq("id", order.id);
    if (cacheErr) {
      console.error("[label] cache update after self-heal failed", {
        orderId: order.id,
        error: cacheErr.message,
      });
    }
  }

  // Wrap in Uint8Array for the BodyInit type — Node's Buffer<ArrayBufferLike>
  // type isn't recognized by NextResponse's BodyInit param, even though
  // Buffer extends Uint8Array at runtime.
  return new NextResponse(new Uint8Array(labelBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="klein-label-${shortId}.zpl"`,
      "Cache-Control": "no-store",
    },
  });
}
