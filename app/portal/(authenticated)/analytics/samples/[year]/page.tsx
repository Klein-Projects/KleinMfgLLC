import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SamplesClient from "./SamplesClient";

export const dynamic = "force-dynamic";

export default async function SamplesDetailPage({
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
    .from("shipments")
    .select(
      "id, tracking_number, carrier, status, recipient_name, shipped_at, delivered_at, qty_6in, qty_11in, is_sample, notes, lead_id, lead:leads(id, contact:contacts(first_name, last_name), company:companies(name))",
    )
    .gte("shipped_at", yearStart)
    .lt("shipped_at", nextYearStart)
    .order("shipped_at", { ascending: false });

  return <SamplesClient year={yr} shipments={(data ?? []) as any[]} />;
}
