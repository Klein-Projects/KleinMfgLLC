"use client";

import { useTransition, useState } from "react";
import Link from "next/link";
import { createTemplate } from "../actions";

const CATEGORIES = [
  { value: "first_contact", label: "First Contact" },
  { value: "follow_up", label: "Follow-Up" },
  { value: "no_reply", label: "No Reply" },
  { value: "sample_followup", label: "Sample Follow-Up" },
  { value: "won", label: "Closed/Won" },
  { value: "nurture", label: "Nurture" },
];

export default function NewTemplatePage() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await createTemplate(formData);
      } catch (e: any) {
        setError(e.message ?? "Failed to create template");
      }
    });
  }

  return (
    <div className="p-6 lg:p-8">
      <Link
        href="/portal/prompts"
        className="text-xs text-steel hover:text-navy"
      >
        &larr; Back to Prompt Library
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-navy">Add Template</h1>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <form action={handleSubmit} className="mt-6 max-w-2xl space-y-5">
        {/* Category */}
        <div>
          <label className="block text-xs font-medium text-charcoal/60">
            Category *
          </label>
          <select
            name="category"
            required
            className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          >
            <option value="">Select a category…</option>
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-medium text-charcoal/60">
            Title *
          </label>
          <input
            type="text"
            name="title"
            required
            placeholder="e.g., LinkedIn — Cold Connect (Airline Maintenance)"
            className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>

        {/* Body */}
        <div>
          <label className="block text-xs font-medium text-charcoal/60">
            Body *
          </label>
          <textarea
            name="body"
            required
            rows={12}
            placeholder="Write the full template message here…"
            className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 font-mono text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>

        {/* Tags */}
        <div>
          <label className="block text-xs font-medium text-charcoal/60">
            Tags
          </label>
          <input
            type="text"
            name="tags"
            placeholder="e.g. airline, MRO, first-touch"
            className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          />
          <p className="mt-1 text-[11px] text-steel">
            Comma-separated keywords for organizing templates
          </p>
        </div>

        {/* Submit */}
        <button
          type="submit"
          disabled={isPending}
          className="rounded-md bg-navy px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy/90 disabled:opacity-50"
        >
          {isPending ? "Saving…" : "Create Template"}
        </button>
      </form>
    </div>
  );
}
