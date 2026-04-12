"use client";

import { useState, useEffect, useMemo, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Package } from "lucide-react";
import { createShipment } from "../actions";

interface LeadOption {
  id: string;
  contact: { first_name: string; last_name: string } | null;
  company: { name: string } | null;
}

export default function NewShipmentPage() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [leadSearch, setLeadSearch] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState("");
  const [carrier, setCarrier] = useState("usps");
  const [recipientName, setRecipientName] = useState("");

  useEffect(() => {
    async function fetchLeads() {
      const supabase = createClient();
      const { data } = await supabase
        .from("leads")
        .select(
          "id, contact:contacts(first_name, last_name), company:companies(name)"
        )
        .not("status", "in", '("won","lost")')
        .order("last_activity_at", { ascending: false });
      setLeads((data as any[]) ?? []);
    }
    fetchLeads();
  }, []);

  const filteredLeads = useMemo(() => {
    if (!leadSearch) return leads;
    const q = leadSearch.toLowerCase();
    return leads.filter((l) => {
      const name = l.contact
        ? `${l.contact.first_name} ${l.contact.last_name}`.toLowerCase()
        : "";
      const company = l.company?.name?.toLowerCase() ?? "";
      return name.includes(q) || company.includes(q);
    });
  }, [leads, leadSearch]);

  function handleSelectLead(leadId: string) {
    setSelectedLeadId(leadId);
    const lead = leads.find((l) => l.id === leadId);
    if (lead?.contact) {
      setRecipientName(
        `${lead.contact.first_name} ${lead.contact.last_name}`
      );
    }
  }

  const todayISO = new Date().toISOString().split("T")[0];

  function handleSubmit(formData: FormData) {
    setError(null);
    const tracking = formData.get("tracking_number") as string;
    if (!tracking?.trim()) {
      setError("Tracking number is required.");
      return;
    }
    startTransition(async () => {
      try {
        await createShipment(formData);
      } catch (e: any) {
        setError(e.message ?? "Failed to log shipment.");
      }
    });
  }

  const selectedLead = leads.find((l) => l.id === selectedLeadId);
  const selectedLeadLabel = selectedLead
    ? [
        selectedLead.contact
          ? `${selectedLead.contact.first_name} ${selectedLead.contact.last_name}`
          : null,
        selectedLead.company?.name,
      ]
        .filter(Boolean)
        .join(" — ")
    : null;

  return (
    <div className="p-6 lg:p-8">
      <Link
        href="/portal/shipments"
        className="text-xs text-steel hover:text-navy"
      >
        &larr; Back to Shipments
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-navy">Log Shipment</h1>

      {error && (
        <div className="mt-4 rounded-md border border-red/20 bg-red/5 px-4 py-3 text-sm text-red">
          {error}
        </div>
      )}

      <form action={handleSubmit} className="mt-6 max-w-2xl space-y-8">
        {/* ── Carrier ── */}
        <div className="rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">
            Carrier
          </h2>
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[
              { value: "usps", label: "USPS", icon: "📦" },
              { value: "ups", label: "UPS", icon: "📤" },
              { value: "fedex", label: "FedEx", icon: "✈️" },
            ].map((c) => (
              <label
                key={c.value}
                className={`flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 px-4 py-4 text-center transition-colors ${
                  carrier === c.value
                    ? "border-navy bg-navy/5 text-navy"
                    : "border-navy/10 text-charcoal/60 hover:border-navy/30"
                }`}
              >
                <input
                  type="radio"
                  name="carrier"
                  value={c.value}
                  checked={carrier === c.value}
                  onChange={() => setCarrier(c.value)}
                  className="sr-only"
                />
                <span className="text-2xl">{c.icon}</span>
                <span className="text-sm font-semibold">{c.label}</span>
              </label>
            ))}
          </div>
        </div>

        {/* ── Tracking & Details ── */}
        <div className="rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">
            Shipment Details
          </h2>

          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                Tracking Number *
              </label>
              <input
                type="text"
                name="tracking_number"
                required
                placeholder="e.g., 9400111899223033005282"
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 font-mono text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                Shipped Date
              </label>
              <input
                type="date"
                name="shipped_at"
                defaultValue={todayISO}
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>
          </div>
        </div>

        {/* ── Lead / Recipient ── */}
        <div className="rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">
            Recipient
          </h2>

          <div className="mt-4 space-y-4">
            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                Link to Lead
              </label>
              <input
                type="text"
                value={leadSearch}
                onChange={(e) => setLeadSearch(e.target.value)}
                placeholder="Search by name or company…"
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
              <input type="hidden" name="lead_id" value={selectedLeadId} />
              <select
                size={Math.min(filteredLeads.length + 1, 6)}
                value={selectedLeadId}
                onChange={(e) => handleSelectLead(e.target.value)}
                className="mt-2 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              >
                <option value="">No lead linked</option>
                {filteredLeads.map((l) => {
                  const name = l.contact
                    ? `${l.contact.first_name} ${l.contact.last_name}`
                    : "Unknown";
                  const company = l.company?.name ?? "";
                  return (
                    <option key={l.id} value={l.id}>
                      {name}
                      {company ? ` — ${company}` : ""}
                    </option>
                  );
                })}
              </select>
              {selectedLeadLabel && (
                <p className="mt-1 text-xs text-navy">
                  Selected: {selectedLeadLabel}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                Recipient Name
              </label>
              <input
                type="text"
                name="recipient_name"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Auto-fills from lead contact"
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                Notes
              </label>
              <textarea
                name="notes"
                rows={3}
                placeholder="e.g., 2x 6-inch samples, 1x 11-inch sample…"
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={isPending}
            className="inline-flex items-center gap-2 rounded-md bg-red px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red/90 disabled:opacity-50"
          >
            <Package className="h-4 w-4" />
            {isPending ? "Saving…" : "Log Shipment"}
          </button>
          <Link
            href="/portal/shipments"
            className="text-sm text-steel hover:text-navy"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
