"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Mail,
  Phone,
  MapPin,
  ExternalLink,
  Pencil,
  Package,
  FileText,
  X,
  Check,
  Trash2,
} from "lucide-react";
import {
  updateLeadField,
  logActivity,
  setFollowUpDate,
  updateContact,
  deleteLead,
} from "../actions";
import { updateShipment } from "../../shipments/actions";

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

const shipmentStatusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-800",
  in_transit: "bg-blue-100 text-blue-800",
  out_for_delivery: "bg-orange-100 text-orange-800",
  delivered: "bg-green-100 text-green-800",
  exception: "bg-red-100 text-red-800",
};

const shipmentStatusLabels: Record<string, string> = {
  pending: "Pending",
  in_transit: "In Transit",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  exception: "Exception",
};

const carrierLabels: Record<string, string> = {
  usps: "USPS",
  ups: "UPS",
  fedex: "FedEx",
};

export default function LeadDetailClient({
  lead,
  activities,
  shipments,
}: {
  lead: any;
  activities: any[];
  shipments: any[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [editingContact, setEditingContact] = useState(false);
  const [contactError, setContactError] = useState<string | null>(null);
  const [editingShipmentId, setEditingShipmentId] = useState<string | null>(
    null
  );
  const [shipmentError, setShipmentError] = useState<string | null>(null);

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

  function handleSaveContact(formData: FormData) {
    if (!contact) return;
    setContactError(null);
    startTransition(async () => {
      try {
        await updateContact(contact.id, lead.id, {
          first_name: (formData.get("first_name") as string) ?? "",
          last_name: (formData.get("last_name") as string) ?? "",
          title: (formData.get("title") as string) || null,
          email: (formData.get("email") as string) || null,
          phone: (formData.get("phone") as string) || null,
          address: (formData.get("address") as string) || null,
          company_name: (formData.get("company_name") as string) || null,
          company_id: company?.id ?? null,
        });
        setEditingContact(false);
        router.refresh();
      } catch (e: any) {
        setContactError(e?.message ?? "Failed to update contact.");
      }
    });
  }

  function handleSaveShipment(shipmentId: string, formData: FormData) {
    setShipmentError(null);
    startTransition(async () => {
      try {
        await updateShipment(shipmentId, {
          carrier: formData.get("carrier") as string,
          status: formData.get("status") as string,
          delivered_at: (formData.get("delivered_at") as string) || null,
        });
        setEditingShipmentId(null);
        router.refresh();
      } catch (e: any) {
        setShipmentError(e?.message ?? "Failed to update shipment.");
      }
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
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              statusColors[lead.status] ?? "bg-gray-100 text-gray-800"
            }`}
          >
            {statusLabels[lead.status] ?? lead.status}
          </span>
          <button
            type="button"
            onClick={() => {
              const name = contact
                ? `${contact.first_name} ${contact.last_name}`
                : "this lead";
              if (
                !window.confirm(
                  `Delete ${name}? This permanently removes the lead and its activity history. This cannot be undone.`
                )
              ) {
                return;
              }
              startTransition(async () => {
                try {
                  await deleteLead(lead.id);
                } catch (e: any) {
                  window.alert(e?.message ?? "Failed to delete lead.");
                }
              });
            }}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-red/30 px-3 py-1.5 text-sm font-medium text-red transition-colors hover:bg-red hover:text-white disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" />
            Delete
          </button>
        </div>
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
              {contact && !editingContact && (
                <button
                  type="button"
                  onClick={() => {
                    setContactError(null);
                    setEditingContact(true);
                  }}
                  className="rounded p-1 text-steel hover:bg-navy/5 hover:text-navy"
                  aria-label="Edit contact"
                  title="Edit contact"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {contact ? (
              editingContact ? (
                <form
                  action={handleSaveContact}
                  className="mt-3 space-y-3"
                >
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs font-medium text-charcoal/60">
                        First Name *
                      </label>
                      <input
                        type="text"
                        name="first_name"
                        required
                        defaultValue={contact.first_name ?? ""}
                        className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-charcoal/60">
                        Last Name *
                      </label>
                      <input
                        type="text"
                        name="last_name"
                        required
                        defaultValue={contact.last_name ?? ""}
                        className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-charcoal/60">
                      Company
                    </label>
                    <input
                      type="text"
                      name="company_name"
                      defaultValue={company?.name ?? ""}
                      className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-charcoal/60">
                      Title
                    </label>
                    <input
                      type="text"
                      name="title"
                      defaultValue={contact.title ?? ""}
                      className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-charcoal/60">
                      Email
                    </label>
                    <input
                      type="email"
                      name="email"
                      defaultValue={contact.email ?? ""}
                      className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-charcoal/60">
                      Phone
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      defaultValue={contact.phone ?? ""}
                      className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-charcoal/60">
                      Address
                    </label>
                    <input
                      type="text"
                      name="address"
                      defaultValue={contact.address ?? ""}
                      className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                    />
                  </div>

                  {contactError && (
                    <p className="text-xs text-red">{contactError}</p>
                  )}

                  <div className="flex items-center gap-2">
                    <button
                      type="submit"
                      disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-md bg-navy px-3 py-1.5 text-xs font-semibold text-white hover:bg-navy/90 disabled:opacity-50"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {isPending ? "Saving…" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingContact(false);
                        setContactError(null);
                      }}
                      disabled={isPending}
                      className="inline-flex items-center gap-1 rounded-md border border-navy/20 bg-white px-3 py-1.5 text-xs font-medium text-charcoal hover:bg-offwhite disabled:opacity-50"
                    >
                      <X className="h-3.5 w-3.5" />
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
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
                  {contact.address && (
                    <p className="flex items-center gap-2 text-sm text-charcoal/70">
                      <MapPin className="h-3.5 w-3.5 text-steel" />
                      {contact.address}
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
              )
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
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {([
                    { label: "Tomorrow", days: 1 },
                    { label: "In 3 days", days: 3 },
                    { label: "Next week", days: 7 },
                    { label: "In 2 weeks", days: 14 },
                  ] as const).map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      disabled={isPending}
                      onClick={() => {
                        const d = new Date();
                        d.setDate(d.getDate() + preset.days);
                        const dateStr = d.toISOString().split("T")[0];
                        startTransition(async () => {
                          await setFollowUpDate(lead.id, dateStr);
                          router.refresh();
                        });
                      }}
                      className="rounded border border-navy/15 bg-navy/5 px-2 py-0.5 text-[11px] font-medium text-navy transition-colors hover:bg-navy/10 disabled:opacity-50"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
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

          {/* Shipments card */}
          <div className="rounded-lg border border-navy/10 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">
                Shipments
              </h2>
              <Link
                href={`/portal/shipments/new?lead_id=${lead.id}`}
                className="inline-flex items-center gap-1 rounded-md border border-navy/20 bg-white px-2.5 py-1 text-xs font-medium text-navy hover:bg-navy hover:text-white"
              >
                <Package className="h-3.5 w-3.5" />
                Add
              </Link>
            </div>

            {shipments.length === 0 ? (
              <p className="mt-3 text-sm text-steel">No shipments yet.</p>
            ) : (
              <ul className="mt-3 divide-y divide-navy/5">
                {shipments.map((s: any) => {
                  const isEditing = editingShipmentId === s.id;
                  return (
                    <li key={s.id} className="py-3">
                      {isEditing ? (
                        <form
                          action={(fd) => handleSaveShipment(s.id, fd)}
                          className="space-y-2"
                        >
                          <p className="font-mono text-xs text-charcoal/70">
                            {s.tracking_number}
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[11px] font-medium text-charcoal/60">
                                Carrier
                              </label>
                              <select
                                name="carrier"
                                defaultValue={s.carrier}
                                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-2 py-1.5 text-xs text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                              >
                                <option value="usps">USPS</option>
                                <option value="ups">UPS</option>
                                <option value="fedex">FedEx</option>
                              </select>
                            </div>
                            <div>
                              <label className="block text-[11px] font-medium text-charcoal/60">
                                Status
                              </label>
                              <select
                                name="status"
                                defaultValue={s.status}
                                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-2 py-1.5 text-xs text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                              >
                                <option value="pending">Pending</option>
                                <option value="in_transit">In Transit</option>
                                <option value="out_for_delivery">
                                  Out for Delivery
                                </option>
                                <option value="delivered">Delivered</option>
                                <option value="exception">Exception</option>
                              </select>
                            </div>
                          </div>
                          <div>
                            <label className="block text-[11px] font-medium text-charcoal/60">
                              Delivered Date
                            </label>
                            <input
                              type="date"
                              name="delivered_at"
                              defaultValue={
                                s.delivered_at
                                  ? new Date(s.delivered_at)
                                      .toISOString()
                                      .split("T")[0]
                                  : ""
                              }
                              className="mt-1 w-full rounded-md border border-navy/20 bg-white px-2 py-1.5 text-xs text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                            />
                          </div>
                          {shipmentError && editingShipmentId === s.id && (
                            <p className="text-[11px] text-red">
                              {shipmentError}
                            </p>
                          )}
                          <div className="flex items-center gap-2">
                            <button
                              type="submit"
                              disabled={isPending}
                              className="inline-flex items-center gap-1 rounded-md bg-navy px-2.5 py-1 text-xs font-semibold text-white hover:bg-navy/90 disabled:opacity-50"
                            >
                              <Check className="h-3 w-3" />
                              {isPending ? "Saving…" : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingShipmentId(null);
                                setShipmentError(null);
                              }}
                              disabled={isPending}
                              className="inline-flex items-center gap-1 rounded-md border border-navy/20 bg-white px-2.5 py-1 text-xs font-medium text-charcoal hover:bg-offwhite disabled:opacity-50"
                            >
                              <X className="h-3 w-3" />
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-mono text-xs text-charcoal">
                              {s.tracking_number}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <span className="text-xs text-charcoal/70">
                                {carrierLabels[s.carrier] ?? s.carrier}
                              </span>
                              <span
                                className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                  shipmentStatusColors[s.status] ??
                                  "bg-gray-100 text-gray-800"
                                }`}
                              >
                                {shipmentStatusLabels[s.status] ?? s.status}
                              </span>
                              {s.delivered_at && (
                                <span className="text-[11px] text-charcoal/60">
                                  Delivered {formatDate(s.delivered_at)}
                                </span>
                              )}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setShipmentError(null);
                              setEditingShipmentId(s.id);
                            }}
                            className="rounded p-1 text-steel hover:bg-navy/5 hover:text-navy"
                            aria-label="Edit shipment"
                            title="Edit shipment"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
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
