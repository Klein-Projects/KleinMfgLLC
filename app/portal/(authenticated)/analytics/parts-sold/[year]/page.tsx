import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PartsSoldClient from "./PartsSoldClient";

export const dynamic = "force-dynamic";

export default async function PartsSoldDetailPage({
  params,
}: {
  params: { year: string };
}) {
  const yr = Number(params.year);
  if (!Number.isInteger(yr) || yr < 2020 || yr > 2100) notFound();

  const supabase = createClient();
  const yearStart = `${yr}-01-01`;
  const nextYearStart = `${yr + 1}-01-01`;

  const [paidRes, manualRes] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, customer_name, company_name, product_6in_qty, product_11in_qty, total_charged, created_at",
      )
      .eq("is_sample", false)
      .gte("created_at", yearStart)
      .lt("created_at", nextYearStart)
      .order("created_at", { ascending: false }),
    supabase
      .from("manual_orders")
      .select("id, customer_name, customer_company, order_date, parts, total_revenue, notes")
      .gte("order_date", yearStart)
      .lt("order_date", nextYearStart)
      .order("order_date", { ascending: false }),
  ]);

  return (
    <PartsSoldClient
      year={yr}
      paid={(paidRes.data ?? []) as any[]}
      manual={(manualRes.data ?? []) as any[]}
    />
  );
}
