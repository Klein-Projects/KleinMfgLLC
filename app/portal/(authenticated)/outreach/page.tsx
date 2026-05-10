import { createClient } from "@/lib/supabase/server";
import OutreachClient from "./OutreachClient";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const supabase = createClient();

  const [
    { data: prompts },
    { data: contactTitleRows },
    { data: companyRows },
  ] = await Promise.all([
    supabase
      .from("prompt_templates")
      .select("id, title, category, body")
      .order("category")
      .order("title"),
    // Distinct contact titles power the per-card title datalist. Pulling
    // contacts.title directly (rather than a curated table) means every
    // title Sean has typed before re-appears as a suggestion next time.
    supabase
      .from("contacts")
      .select("title")
      .not("title", "is", null),
    supabase
      .from("companies")
      .select("name")
      .order("name"),
  ]);

  // Surface the First Contact prompts up top — that's what 95% of the
  // outreach page traffic uses. Sean can still pick anything else.
  const ordered = (prompts ?? []).slice().sort((a, b) => {
    const ac = a.category === "first_contact" ? 0 : 1;
    const bc = b.category === "first_contact" ? 0 : 1;
    if (ac !== bc) return ac - bc;
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.title.localeCompare(b.title);
  });

  // Dedupe + trim title strings (case-insensitive equality, original casing
  // preserved on the first occurrence).
  const titleSeen = new Set<string>();
  const titleSuggestions: string[] = [];
  for (const row of (contactTitleRows ?? []) as Array<{ title: string | null }>) {
    const t = (row.title ?? "").trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (titleSeen.has(key)) continue;
    titleSeen.add(key);
    titleSuggestions.push(t);
  }
  titleSuggestions.sort((a, b) => a.localeCompare(b));

  const companySuggestions = (companyRows ?? [])
    .map((c: { name: string }) => c.name)
    .filter((n): n is string => !!n);

  return (
    <OutreachClient
      prompts={ordered ?? []}
      titleSuggestions={titleSuggestions}
      companySuggestions={companySuggestions}
    />
  );
}
