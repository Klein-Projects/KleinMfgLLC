"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Mail,
  Phone,
  ExternalLink,
  Pencil,
  Package,
  FileText,
} from "lucide-react";
import { updateLeadField, logActivity } from "../actions";

const STATUS_OPTIONS = [
  "new",
  "contacted",
  "engaged",
  "sample_sent",
  "quoted",
  "won",
  "lost",
  "nurture",
] as const;

const statusColors: Record<string, string> = {
  new: "bg-gray-100 text-gray-800",
  contacted: "bg-blue-100 text-blue-800",
  engaged: "bg-teal-100 text-teal-800",
  sample_sent: "bg-orange-100 text-orange-800",
  quoted: "bg-purple-100 text-purple-800",
  won: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
  nurture: "bg-yellow-100 text-yellow-800",
};

const statusLabels: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  engaged: "Engaged",
  sample_sent: "Sample Sent",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
  nurture: "Nurture",
};

const typeBadgeColors: Record<string, string> = {
  linkedin_message: "bg-blue-100 text-blue-800",
  email: "bg-teal-100 text-teal-800",
  phone: "bg-green-100 text-green-800",
  note: "bg-gray-100 text-gray-800",
  sample_sent: "bg-orange-100 text-orange-800",
  follow_up: "bg-purple-100 text-purple-800",
};

const typeLabels: Record<string, string> = {
  linkedin_message: "LinkedIn",
  email: "Email",
  phone: "Phone",
  note: "Note",
  sample_sent: "Sample Sent",
  follow_up: "Follow-Up",
};

const sourceLabels: Record<string, string> = {
  linkedin: "LinkedIn",
  website: "Website",
  referral: "Referral",
  other: "Other",
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function LeadDetailClient({
  lead,
  activities,
}: {
  lead: any;
  activities: any[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const contact = lead.contact;
  const company = lead.company;
  const sampleRequest = lead.sample_request;

  function handleStatusChange(newStatus: string) {
    startTransition(async () => {
      await updateLeadField(lead.id, "status", newStatus);
      router.refresh();
    });
  }

  function handleFollowUpChange(date: string) {
    startTransition(async () => {
      await updateLeadField(
        lead.id,
        "follow_up_date",
        date || null
      );
      router.refresh();
    });
  }

  function handleNotesBlur(notes: string) {
    startTransition(async () => {
      await updateLeadField(lead.id, "notes", notes || null);
    });
  }

  function handleValueBlur(value: string) {
    startTransition(async () => {
      await updateLeadField(
        lead.id,
        "value_estimate",
        value ? parseFloat(value) : null
      );
    });
  }

  async function handleLogActivity(formData: FormData) {
    startTransition(async () => {
      await logActivity(formData);
      router.refresh();
    });
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link
            href="/portal/leads"
            className="text-xs text-steel hover:text-navy"
          >
            &larr; Back to Leads
          </Link>
          <h1 className="mt-1 text-2xl font-bold text-navy">
            {contact
              ? `${contact.first_name} ${contact.last_name}`
              : "Unknown Contact"}
          </h1>
          {company && (
            <p className="text-sm text-steel">{company.name}</p>
          )}
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            statusColors[lead.status] ?? "bg-gray-100 text-gray-800"
          }`}
        >
          {statusLabels[lead.status] ?? lead.status}
        </span>
      </div>

      {/* Sample request banner */}
      {sampleRequest && (
        <div className="mt-4 rounded-md border border-blue-200 bg-blue-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-blue-600" />
            <p className="text-sm font-medium text-blue-900">
              From website sample request — {formatDate(sampleRequest.created_at)}
            </p>
          </div>
          <div className="mt-2 grid gap-1 text-xs text-blue-800">
            <p>
              <span className="font-medium">Name:</span> {sampleRequest.name}
            </p>
            {sampleRequest.company && (
              <p>
                <span className="font-medium">Company:</span>{" "}
                {sampleRequest.company}
              </p>
            )}
            <p>
              <span className="font-medium">Qty:</span>{" "}
              {sampleRequest.quantity_6inch}x 6&quot; /{" "}
              {sampleRequest.quantity_11inch}x 11&quot;
            </p>
            {sampleRequest.notes && (
              <p>
                <span className="font-medium">Notes:</span>{" "}
                {sampleRequest.notes}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Two-column layout */}
      <div className="mt-6 grid gap-6 lg:grid-cols-[2fr_3fr]">
        {/* LEFT — Contact & Lead Info */}
        <div className="space-y-6">
          {/* Contact card */}
          <div className="rounded-lg border border-navy/10 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">
                Contact
              </h2>
              <Link
                href={`/portal/leads/${lead.id}`}
                className="text-steel hover:text-navy"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Link>
            </div>

            {contact ? (
              <div className="mt-3 space-y-2">
                <p className="text-lg font-semibold text-navy">
                  {contact.first_name} {contact.last_name}
                </p>
                {contact.title && (
                  <p className="text-sm text-charcoal/70">{contact.title}</p>
                )}
                {contact.email && (
                  <p className="flex items-center gap-2 text-sm text-charcoal/70">
                    <Mail className="h-3.5 w-3.5 text-steel" />
                    <a
                      href={`mailto:${contact.email}`}
                      className="hover:text-navy hover:underline"
                    >
                      {contact.email}
                    </a>
                  </p>
                )}
                {contact.phone && (
                  <p className="flex items-center gap-2 text-sm text-charcoal/70">
                    <Phone className="h-3.5 w-3.5 text-steel" />
                    {contact.phone}
                  </p>
                )}
                {contact.linkedin_url && (
                  <p className="flex items-center gap-2 text-sm">
                    <ExternalLink className="h-3.5 w-3.5 text-steel" />
                    <a
                      href={contact.linkedin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      LinkedIn Profile
                    </a>
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-3 text-sm text-steel">No contact linked.</p>
            )}
          </div>

          {/* Lead details card */}
          <div className="rounded-lg border border-navy/10 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">
              Lead Details
            </h2>

            <div className="mt-4 space-y-4">
              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-charcoal/60">
                  Status
                </label>
                <select
                  defaultValue={lead.status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  disabled={isPending}
                  className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {statusLabels[s]}
                    </option>
                  ))}
                </select>
              </div>

              {/* Follow-up date */}
              <div>
                <label className="block text-xs font-medium text-charcoal/60">
                  Follow-Up Date
                </label>
                <input
                  type="date"
                  defaultValue={lead.follow_up_date ?? ""}
                  onBlur={(e) => handleFollowUpChange(e.target.value)}
                  className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>

              {/* Source */}
              <div>
                <label className="block text-xs font-medium text-charcoal/60">
                  Source
                </label>
                <p className="mt-1 text-sm text-charcoal">
                  <span className="rounded bg-navy/10 px-2 py-0.5 text-xs font-medium text-navy">
                    {sourceLabels[lead.source] ?? lead.source}
                  </span>
                </p>
              </div>

              {/* Value estimate */}
              <div>
                <label className="block text-xs font-medium text-charcoal/60">
                  Value Estimate ($)
                </label>
                <input
                  type="number"
                  step="0.01"
                  defaultValue={lead.value_estimate ?? ""}
                  onBlur={(e) => handleValueBlur(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>

              {/* Notes */}
              <div>
                <label className="block text-xs font-medium text-charcoal/60">
                  Notes
                </label>
                <textarea
                  rows={3}
                  defaultValue={lead.notes ?? ""}
                  onBlur={(e) => handleNotesBlur(e.target.value)}
                  placeholder="Add notes…"
                  className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>
            </div>
          </div>

          {/* Action buttons */}
          <div>
            <Link
              href={`/portal/shipments/new?lead_id=${lead.id}`}
              className="inline-flex items-center gap-2 rounded-md border border-navy/20 bg-white px-4 py-2 text-sm font-medium text-navy transition-colors hover:bg-navy hover:text-white"
            >
              <Package className="h-4 w-4" />
              Add Shipment
            </Link>
          </div>
        </div>

        {/* RIGHT — Activity Log */}
        <div className="space-y-6">
          <div className="rounded-lg border border-navy/10 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">
              Activity Log
            </h2>

            {/* Timeline */}
            {activities.length === 0 ? (
              <p className="mt-4 text-sm text-steel">
                No activity yet. Log your first interaction below.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {activities.map((activity) => {
                  const badgeColor =
                    typeBadgeColors[activity.type] ??
                    "bg-gray-100 text-gray-800";
                  return (
                    <div
                      key={activity.id}
                      className="border-l-2 border-navy/10 pl-4"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded px-2 py-0.5 text-[11px] font-medium ${badgeColor}`}
                        >
                          {typeLabels[activity.type] ?? activity.type}
                        </span>
                        <span className="text-xs text-steel">
                          {formatDateTime(activity.created_at)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-charcoal">
                        {activity.summary}
                      </p>
                      {activity.outcome && (
                        <p className="mt-0.5 text-xs text-charcoal/60">
                          <span className="font-medium">Outcome:</span>{" "}
                          {activity.outcome}
                        </p>
                      )}
                      {activity.prompt_used && (
                        <p className="mt-0.5 text-xs text-charcoal/60">
                          <span className="font-medium">Prompt:</span>{" "}
                          {activity.prompt_used}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Log Activity form */}
          <div className="rounded-lg border border-navy/10 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">
              Log Activity
            </h2>

            <form action={handleLogActivity} className="mt-4 space-y-3">
              <input type="hidden" name="lead_id" value={lead.id} />

              <div>
                <label className="block text-xs font-medium text-charcoal/60">
                  Type
                </label>
                <select
                  name="type"
                  required
                  className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                >
                  <option value="linkedin_message">LinkedIn Message</option>
                  <option value="email">Email</option>
                  <option value="phone">Phone Call</option>
                  <option value="note">Note</option>
                  <option value="sample_sent">Sample Sent</option>
                  <option value="follow_up">Follow-Up</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-charcoal/60">
                  Summary *
                </label>
                <textarea
                  name="summary"
                  required
                  rows={3}
                  placeholder="What happened?"
                  className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-charcoal/60">
                  Outcome
                </label>
                <input
                  type="text"
                  name="outcome"
                  placeholder="e.g., Agreed to try samples"
                  className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-charcoal/60">
                  Prompt Used
                </label>
                <input
                  type="text"
                  name="prompt_used"
                  placeholder="Which template message?"
                  className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>

              <button
                type="submit"
                disabled={isPending}
                className="w-full rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy/90 disabled:opacity-50"
              >
                {isPending ? "Saving…" : "Log Activity"}
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
