import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import WonClient from "./WonClient";

export const dynamic = "force-dynamic";

export default async function WonDetailPage({
  params,
}: {
  params: { year: string };
}) {
  const yr = Number(params.year);
  if (!Number.isInteger(yr) || yr < 2020 || yr > 2100) notFound();

  const supabase = createClient();
  const yearStart = `${yr}-01-01T00:00:00.000Z`;
  const nextYearStart = `${yr + 1}-01-01T00:00:00.000Z`;

  const { data } = await supabase
    .from("leads")
    .select(
      "id, closed_won_at, status, value_estimate, contact:contacts(first_name, last_name), company:companies(name), manual_orders(id, total_revenue, order_date)",
    )
    .eq("status", "won")
    .gte("closed_won_at", yearStart)
    .lt("closed_won_at", nextYearStart)
    .order("closed_won_at", { ascending: false });

  return <WonClient year={yr} leads={(data ?? []) as any[]} />;
}
