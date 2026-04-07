import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { Package } from "lucide-react";
import LeadDetailClient from "./LeadDetailClient";

export default async function LeadDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();

  // Fetch lead with relations
  const { data: lead, error } = await supabase
    .from("leads")
    .select(
      `
      *,
      contact:contacts(*),
      company:companies(*),
      sample_request:sample_requests(*)
    `
    )
    .eq("id", params.id)
    .single();

  if (error || !lead) notFound();

  // Fetch activities
  const { data: activities } = await supabase
    .from("activities")
    .select("*")
    .eq("lead_id", params.id)
    .order("created_at", { ascending: false });

  return (
    <LeadDetailClient
      lead={lead}
      activities={activities ?? []}
    />
  );
}
