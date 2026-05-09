import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import PortalShell from "@/components/portal/PortalShell";
import QuickLogSlideOver from "@/components/portal/QuickLogSlideOver";
import { fetchTodayCount } from "@/lib/portal/today-queue";

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

  const [{ count: reviewCount }, todayCount] = await Promise.all([
    supabase
      .from("web_order_review")
      .select("id", { count: "exact", head: true })
      .eq("resolved", false),
    fetchTodayCount(supabase),
  ]);

  return (
    <PortalShell
      userEmail={user.email ?? ""}
      reviewCount={reviewCount ?? 0}
      todayCount={todayCount}
    >
      {children}
      <QuickLogSlideOver />
    </PortalShell>
  );
}
