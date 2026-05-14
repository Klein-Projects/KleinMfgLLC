import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import RevenueClient from "./RevenueClient";

export const dynamic = "force-dynamic";

export default async function RevenueDetailPage({
  params,
}: {
  params: { year: string };
}) {
  const yr = Number(params.year);
  if (!Number.isInteger(yr) || yr < 2020 || yr > 2100) notFound();

  const supabase = createClient();
  const yearStart = `${yr}-01-01`;
  const nextYearStart = `${yr + 1}-01-01`;

  const [paidRes, manualRes, leadsRes] = await Promise.all([
    // Paid web orders (non-sample) created this year.
    supabase
      .from("orders")
      .select(
        "id, customer_name, company_name, product_6in_qty, product_11in_qty, total_charged, shipped_at, status, shipping_status, created_at",
      )
      .eq("is_sample", false)
      .gte("created_at", yearStart)
      .lt("created_at", nextYearStart)
      .order("created_at", { ascending: false }),

    // Manual offline orders entered through this page.
    supabase
      .from("manual_orders")
      .select("*")
      .gte("order_date", yearStart)
      .lt("order_date", nextYearStart)
      .order("order_date", { ascending: false }),

    // Lead options for the optional "Link to existing lead" picker
    // on the Add Manual Order form. Limit to recent so the dropdown
    // stays usable; Sean can always create the lead first if it's an
    // older one and re-open the form.
    supabase
      .from("leads")
      .select(
        "id, contact:contacts(first_name, last_name), company:companies(name)",
      )
      .order("last_activity_at", { ascending: false })
      .limit(150),
  ]);

  return (
    <RevenueClient
      year={yr}
      paid={(paidRes.data ?? []) as any[]}
      manual={(manualRes.data ?? []) as any[]}
      leads={(leadsRes.data ?? []) as any[]}
    />
  );
}
