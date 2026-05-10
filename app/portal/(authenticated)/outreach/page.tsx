import { createClient } from "@/lib/supabase/server";
import OutreachClient from "./OutreachClient";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const supabase = createClient();

  const { data: prompts } = await supabase
    .from("prompt_templates")
    .select("id, title, category, body")
    .order("category")
    .order("title");

  // Surface the First Contact prompts up top — that's what 95% of the
  // outreach page traffic uses. Sean can still pick anything else.
  const ordered = (prompts ?? []).slice().sort((a, b) => {
    const ac = a.category === "first_contact" ? 0 : 1;
    const bc = b.category === "first_contact" ? 0 : 1;
    if (ac !== bc) return ac - bc;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.title.localeCompare(b.title);
  });

  return <OutreachClient prompts={ordered ?? []} />;
}
