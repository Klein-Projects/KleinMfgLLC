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

  if (!order.label_zpl) {
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

  // ── Default: stream the saved ZPL ───────────────────────────────────
  return new NextResponse(order.label_zpl, {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="klein-label-${shortId}.zpl"`,
      "Cache-Control": "no-store",
    },
  });
}
