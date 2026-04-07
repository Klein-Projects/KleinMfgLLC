"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { Search, Plus, Copy, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { incrementUseCount } from "./actions";

type Category =
  | "first_contact"
  | "follow_up"
  | "no_reply"
  | "sample_followup"
  | "won"
  | "nurture";

interface Template {
  id: string;
  category: Category;
  title: string;
  body: string;
  tags: string[] | null;
  use_count: number;
}

const CATEGORIES: { value: Category | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "first_contact", label: "First Contact" },
  { value: "follow_up", label: "Follow-Up" },
  { value: "no_reply", label: "No Reply" },
  { value: "sample_followup", label: "Sample Follow-Up" },
  { value: "won", label: "Closed/Won" },
  { value: "nurture", label: "Nurture" },
];

const categoryBadgeColors: Record<string, string> = {
  first_contact: "bg-blue-100 text-blue-800",
  follow_up: "bg-purple-100 text-purple-800",
  no_reply: "bg-orange-100 text-orange-800",
  sample_followup: "bg-teal-100 text-teal-800",
  won: "bg-green-100 text-green-800",
  nurture: "bg-yellow-100 text-yellow-800",
};

const categoryLabels: Record<string, string> = {
  first_contact: "First Contact",
  follow_up: "Follow-Up",
  no_reply: "No Reply",
  sample_followup: "Sample Follow-Up",
  won: "Closed/Won",
  nurture: "Nurture",
};

export default function PromptLibraryPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<Category | "all">("all");
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("prompt_templates")
      .select("*")
      .order("category")
      .order("use_count", { ascending: false })
      .then(({ data }) => {
        setTemplates((data as Template[]) ?? []);
        setLoading(false);
      });
  }, []);

  // Category counts
  const counts: Record<string, number> = { all: templates.length };
  for (const t of templates) {
    counts[t.category] = (counts[t.category] || 0) + 1;
  }

  // Filter
  const filtered = templates.filter((t) => {
    if (activeCategory !== "all" && t.category !== activeCategory) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        t.title.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q)
      );
    }
    return true;
  });

  async function handleCopy(template: Template) {
    await navigator.clipboard.writeText(template.body);
    setCopiedId(template.id);
    startTransition(() => incrementUseCount(template.id));

    // Update local count optimistically
    setTemplates((prev) =>
      prev.map((t) =>
        t.id === template.id ? { ...t, use_count: t.use_count + 1 } : t
      )
    );

    setTimeout(() => setCopiedId(null), 2000);
  }

  return (
    <div className="p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">Prompt Library</h1>
        <Link
          href="/portal/prompts/new"
          className="inline-flex items-center gap-2 rounded-md bg-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red/90"
        >
          <Plus className="h-4 w-4" />
          Add Template
        </Link>
      </div>

      <div className="mt-6 flex gap-6">
        {/* LEFT SIDEBAR — Category Filter */}
        <div className="hidden w-[200px] shrink-0 lg:block">
          <div className="space-y-1">
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.value;
              return (
                <button
                  key={cat.value}
                  onClick={() => setActiveCategory(cat.value)}
                  className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-red text-white"
                      : "text-charcoal/70 hover:bg-navy/5 hover:text-navy"
                  }`}
                >
                  {cat.label}
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                      isActive
                        ? "bg-white/20 text-white"
                        : "bg-navy/10 text-navy"
                    }`}
                  >
                    {counts[cat.value] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* MAIN AREA */}
        <div className="flex-1">
          {/* Mobile category filter */}
          <div className="mb-4 flex flex-wrap gap-1.5 lg:hidden">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.value}
                onClick={() => setActiveCategory(cat.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeCategory === cat.value
                    ? "bg-red text-white"
                    : "bg-navy/10 text-navy"
                }`}
              >
                {cat.label} ({counts[cat.value] ?? 0})
              </button>
            ))}
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search templates…"
              className="w-full rounded-md border border-navy/20 bg-white py-2.5 pl-10 pr-4 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>

          {/* Template Grid */}
          {loading ? (
            <div className="mt-8 flex justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-navy border-t-transparent" />
            </div>
          ) : filtered.length === 0 ? (
            <p className="mt-8 text-center text-sm text-steel">
              No templates found.
            </p>
          ) : (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {filtered.map((template) => (
                <div
                  key={template.id}
                  className="rounded-lg border border-navy/10 bg-white p-5 shadow-sm"
                >
                  {/* Category badge */}
                  <span
                    className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${
                      categoryBadgeColors[template.category] ??
                      "bg-gray-100 text-gray-800"
                    }`}
                  >
                    {categoryLabels[template.category] ?? template.category}
                  </span>

                  {/* Title */}
                  <Link
                    href={`/portal/prompts/${template.id}`}
                    className="mt-2 block text-base font-bold text-navy hover:underline"
                  >
                    {template.title}
                  </Link>

                  {/* Body preview */}
                  <p className="mt-2 text-sm leading-relaxed text-charcoal/70">
                    {template.body.length > 120
                      ? template.body.slice(0, 120) + "…"
                      : template.body}
                  </p>

                  {/* Bottom row */}
                  <div className="mt-4 flex items-center justify-between">
                    <span className="text-xs text-steel">
                      Used {template.use_count} time
                      {template.use_count !== 1 ? "s" : ""}
                    </span>
                    <button
                      onClick={() => handleCopy(template)}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                        copiedId === template.id
                          ? "bg-green-100 text-green-700"
                          : "bg-red text-white hover:bg-red/90"
                      }`}
                    >
                      {copiedId === template.id ? (
                        <>
                          <Check className="h-3.5 w-3.5" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
