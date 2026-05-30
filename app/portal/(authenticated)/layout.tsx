import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PortalShell from "@/components/portal/PortalShell";
import QuickLogSlideOver from "@/components/portal/QuickLogSlideOver";
import { fetchTodayLeadCount } from "@/lib/portal/today-conversation";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/portal/login");
  }

  const [
    { count: reviewCount },
    { count: reviewQueueCount },
    todayCount,
    { count: shipmentsCount },
  ] = await Promise.all([
    supabase
      .from("web_order_review")
      .select("id", { count: "exact", head: true })
      .eq("resolved", false),
    supabase
      .from("review_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    fetchTodayLeadCount(supabase),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("shipping_status", ["pending", "label_purchased"]),
  ]);

  return (
    <PortalShell
      userEmail={user.email ?? ""}
      reviewCount={reviewCount ?? 0}
      reviewQueueCount={reviewQueueCount ?? 0}
      todayCount={todayCount}
      shipmentsCount={shipmentsCount ?? 0}
    >
      {children}
      <QuickLogSlideOver />
    </PortalShell>
  );
}
