"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { updateTemplate, deleteTemplate } from "../actions";

const CATEGORIES = [
  { value: "first_contact", label: "First Contact" },
  { value: "follow_up", label: "Follow-Up" },
  { value: "no_reply", label: "No Reply" },
  { value: "sample_followup", label: "Sample Follow-Up" },
  { value: "won", label: "Closed/Won" },
  { value: "nurture", label: "Nurture" },
];

interface Template {
  id: string;
  category: string;
  title: string;
  body: string;
  tags: string[] | null;
  use_count: number;
}

export default function EditTemplatePage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.id as string;

  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("prompt_templates")
      .select("*")
      .eq("id", templateId)
      .single()
      .then(({ data, error: err }) => {
        if (err || !data) {
          setError("Template not found");
        } else {
          setTemplate(data as Template);
        }
        setLoading(false);
      });
  }, [templateId]);

  function handleUpdate(formData: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        await updateTemplate(templateId, formData);
      } catch (e: any) {
        setError(e.message ?? "Failed to update template");
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      try {
        await deleteTemplate(templateId);
      } catch (e: any) {
        setError(e.message ?? "Failed to delete template");
      }
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-navy border-t-transparent" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="p-6 lg:p-8">
        <p className="text-sm text-steel">Template not found.</p>
        <Link
          href="/portal/prompts"
          className="mt-2 inline-block text-xs text-steel hover:text-navy"
        >
          &larr; Back to Prompt Library
        </Link>
      </div>
    );
  }

  return (
    <div className="p-6 lg:p-8">
      <Link
        href="/portal/prompts"
        className="text-xs text-steel hover:text-navy"
      >
        &larr; Back to Prompt Library
      </Link>
      <div className="mt-2 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-navy">Edit Template</h1>
        <span className="text-xs text-steel">
          Used {template.use_count} time{template.use_count !== 1 ? "s" : ""}
        </span>
      </div>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <form action={handleUpdate} className="mt-6 max-w-2xl space-y-5">
        {/* Category */}
        <div>
          <label className="block text-xs font-medium text-charcoal/60">
            Category *
          </label>
          <select
            name="category"
            required
            defaultValue={template.category}
            className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          >
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
            defaultValue={template.title}
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
            defaultValue={template.body}
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
            defaultValue={template.tags?.join(", ") ?? ""}
            placeholder="e.g. airline, MRO, first-touch"
            className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          />
          <p className="mt-1 text-[11px] text-steel">
            Comma-separated keywords for organizing templates
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-navy px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy/90 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Update Template"}
          </button>

          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-red-200 px-4 py-2.5 text-sm font-medium text-red-600 transition-colors hover:bg-red-50"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
      </form>

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-navy">
              Delete Template?
            </h3>
            <p className="mt-2 text-sm text-charcoal/70">
              This will permanently delete &ldquo;{template.title}&rdquo;. This
              action cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-md border border-navy/20 px-4 py-2 text-sm font-medium text-charcoal transition-colors hover:bg-navy/5"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={isPending}
                className="rounded-md bg-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red/90 disabled:opacity-50"
              >
                {isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
