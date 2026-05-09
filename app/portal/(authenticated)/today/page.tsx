import { fetchTodayQueue, todayInNY } from "@/lib/portal/today-queue";
import { createClient } from "@/lib/supabase/server";
import TodayCards from "./TodayCards";

export const dynamic = "force-dynamic";

export default async function TodayPage() {
  const supabase = createClient();
  const todayISO = todayInNY();

  const cards = await fetchTodayQueue(supabase, { todayISO });

  const date = new Date(todayISO + "T00:00:00");
  const headerDate = date.toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="p-6 lg:p-8">
      <header className="mb-1">
        <h1 className="text-2xl font-bold text-navy">Today</h1>
        <p className="mt-1 text-sm text-steel">
          {headerDate} —{" "}
          {cards.length === 0
            ? "no follow-ups due"
            : `${cards.length} follow-up${cards.length === 1 ? "" : "s"} due`}
        </p>
      </header>

      <TodayCards cards={cards} />
    </div>
  );
}
