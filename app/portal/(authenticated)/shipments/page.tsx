// ============================================================
// /portal/shipments — server component
// Phase 15L.6: tab 1 = Web Order Fulfillment (new),
//              tab 2 = Sample Tracking (CRM, pre-existing).
// ============================================================

import { createClient } from "@/lib/supabase/server";
import ShipmentsClient, {
  type SampleShipmentRow,
  type WebOrderRow,
} from "./ShipmentsClient";

const PAGE_SIZE = 50;

const ORDER_COLUMNS =
  "id, created_at, customer_name, customer_email, " +
  "shipping_city, shipping_state, shipping_zip, " +
  "product_6in_qty, product_11in_qty, " +
  "shipping_status, shipped_at, tracking_code, carrier, service, " +
  "rate_amount, label_purchased_at";

type SearchParams = {
  tab?: string;
  readyPage?: string;
  shippedPage?: string;
};

export default async function ShipmentsPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const supabase = createClient();

  const readyPage = Math.max(
    1,
    Number.parseInt(searchParams.readyPage ?? "1", 10) || 1
  );
  const shippedPage = Math.max(
    1,
    Number.parseInt(searchParams.shippedPage ?? "1", 10) || 1
  );
  const initialTab: "web-orders" | "samples" =
    searchParams.tab === "samples" ? "samples" : "web-orders";

  const readyFrom = (readyPage - 1) * PAGE_SIZE;
  const shippedFrom = (shippedPage - 1) * PAGE_SIZE;
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  const [readyRes, shippedRes, samplesRes] = await Promise.all([
    supabase
      .from("orders")
      .select(ORDER_COLUMNS, { count: "exact" })
      .in("shipping_status", ["pending", "label_purchased"])
      .order("created_at", { ascending: true })
      .range(readyFrom, readyFrom + PAGE_SIZE - 1),
    supabase
      .from("orders")
      .select(ORDER_COLUMNS, { count: "exact" })
      .eq("shipping_status", "shipped")
      .gte("shipped_at", thirtyDaysAgo)
      .order("shipped_at", { ascending: false })
      .range(shippedFrom, shippedFrom + PAGE_SIZE - 1),
    supabase
      .from("shipments")
      .select(
        "id, tracking_number, carrier, status, recipient_name, shipped_at, delivered_at, notes, lead_id, lead:leads(id, contact:contacts(first_name, last_name), company:companies(name))"
      )
      .order("created_at", { ascending: false }),
  ]);

  return (
    <ShipmentsClient
      initialTab={initialTab}
      pageSize={PAGE_SIZE}
      readyOrders={(readyRes.data ?? []) as unknown as WebOrderRow[]}
      readyTotal={readyRes.count ?? 0}
      readyPage={readyPage}
      shippedOrders={(shippedRes.data ?? []) as unknown as WebOrderRow[]}
      shippedTotal={shippedRes.count ?? 0}
      shippedPage={shippedPage}
      samples={(samplesRes.data ?? []) as unknown as SampleShipmentRow[]}
    />
  );
}
