import { createClient } from "@/lib/supabase/server";
import ReviewQueueClient from "./ReviewQueueClient";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const supabase = createClient();

  const [{ data: reviews }, { data: companies }] = await Promise.all([
    supabase
      .from("web_order_review")
      .select(
        "id, created_at, notes, " +
          "order:orders(id, customer_name, customer_email, customer_phone, " +
          "company_name, product_6in_qty, product_11in_qty, total_charged, discount_code, created_at)"
      )
      .eq("resolved", false)
      .order("created_at", { ascending: false }),
    supabase.from("companies").select("id, name").order("name"),
  ]);

  return (
    <ReviewQueueClient
      reviews={(reviews as any) ?? []}
      companies={(companies as any) ?? []}
    />
  );
}
