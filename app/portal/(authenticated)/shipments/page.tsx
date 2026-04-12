"use client";

import { useEffect, useState, useMemo, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Plus, RefreshCw, Package, ExternalLink } from "lucide-react";

type ShipmentStatus =
  | "pending"
  | "in_transit"
  | "out_for_delivery"
  | "delivered"
  | "exception";

const statusColors: Record<ShipmentStatus, string> = {
  pending: "bg-gray-100 text-gray-800",
  in_transit: "bg-blue-100 text-blue-800",
  out_for_delivery: "bg-orange-100 text-orange-800",
  delivered: "bg-green-100 text-green-800",
  exception: "bg-red-100 text-red-800",
};

const statusLabels: Record<ShipmentStatus, string> = {
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

type FilterTab = "all" | "active" | "delivered";

interface ShipmentRow {
  id: string;
  tracking_number: string;
  carrier: string;
  status: ShipmentStatus;
  recipient_name: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  notes: string | null;
  lead_id: string | null;
  lead: {
    id: string;
    contact: { first_name: string; last_name: string } | null;
    company: { name: string } | null;
  } | null;
}

export default function ShipmentsPage() {
  const [shipments, setShipments] = useState<ShipmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [checking, startChecking] = useTransition();

  async function fetchShipments() {
    const supabase = createClient();
    const { data } = await supabase
      .from("shipments")
      .select(
        "id, tracking_number, carrier, status, recipient_name, shipped_at, delivered_at, notes, lead_id, lead:leads(id, contact:contacts(first_name, last_name), company:companies(name))"
      )
      .order("created_at", { ascending: false });
    setShipments((data as any[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    fetchShipments();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "active")
      return shipments.filter((s) => s.status !== "delivered");
    if (filter === "delivered")
      return shipments.filter((s) => s.status === "delivered");
    return shipments;
  }, [shipments, filter]);

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "\u2014";
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function handleCheckAll() {
    startChecking(async () => {
      await fetch("/api/portal/check-tracking", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ checkAll: true }),
      });
      await fetchShipments();
    });
  }

  async function handleCheckOne(shipmentId: string) {
    await fetch("/api/portal/check-tracking", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ shipmentId }),
    });
    await fetchShipments();
  }

  const activeCount = shipments.filter((s) => s.status !== "delivered").length;

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-navy">Shipments</h1>
        <div className="flex items-center gap-3">
          <button
            onClick={handleCheckAll}
            disabled={checking || activeCount === 0}
            className="inline-flex items-center gap-2 rounded-md border border-navy/20 bg-white px-4 py-2.5 text-sm font-medium text-navy transition-colors hover:bg-offwhite disabled:opacity-50"
          >
            <RefreshCw
              className={`h-4 w-4 ${checking ? "animate-spin" : ""}`}
            />
            {checking ? "Checking…" : "Check All Active"}
          </button>
          <Link
            href="/portal/shipments/new"
            className="inline-flex items-center gap-2 rounded-md bg-red px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red/90"
          >
            <Plus className="h-4 w-4" />
            Log Shipment
          </Link>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="mt-6 flex gap-1 rounded-lg bg-navy/5 p-1">
        {(["all", "active", "delivered"] as FilterTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setFilter(tab)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              filter === tab
                ? "bg-white text-navy shadow-sm"
                : "text-steel hover:text-navy"
            }`}
          >
            {tab === "all"
              ? "All"
              : tab === "active"
                ? `Active (${activeCount})`
                : "Delivered"}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="mt-6 overflow-x-auto rounded-lg border border-navy/10 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center">
            <Package className="mx-auto h-10 w-10 text-steel/40" />
            <p className="mt-3 text-sm text-steel">No shipments found.</p>
            <Link
              href="/portal/shipments/new"
              className="mt-2 inline-block text-sm font-medium text-red hover:underline"
            >
              Log your first shipment
            </Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy/10 text-left text-xs uppercase text-steel">
                <th className="px-4 py-3 font-medium">Tracking #</th>
                <th className="px-4 py-3 font-medium">Carrier</th>
                <th className="px-4 py-3 font-medium">Recipient</th>
                <th className="px-4 py-3 font-medium">Lead / Contact</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Shipped</th>
                <th className="px-4 py-3 font-medium">Delivered</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/5">
              {filtered.map((s) => {
                const leadContact = s.lead?.contact
                  ? `${s.lead.contact.first_name} ${s.lead.contact.last_name}`
                  : null;
                const leadCompany = s.lead?.company?.name ?? null;
                const leadLabel =
                  leadContact && leadCompany
                    ? `${leadContact} (${leadCompany})`
                    : leadContact ?? leadCompany ?? "\u2014";

                return (
                  <tr
                    key={s.id}
                    className="transition-colors hover:bg-offwhite"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-charcoal">
                      {s.tracking_number}
                    </td>
                    <td className="px-4 py-3 text-charcoal/70">
                      {carrierLabels[s.carrier] ?? s.carrier}
                    </td>
                    <td className="px-4 py-3 text-charcoal/70">
                      {s.recipient_name ?? "\u2014"}
                    </td>
                    <td className="px-4 py-3">
                      {s.lead ? (
                        <Link
                          href={`/portal/leads/${s.lead.id}`}
                          className="text-navy hover:underline"
                        >
                          {leadLabel}
                        </Link>
                      ) : (
                        <span className="text-charcoal/50">{leadLabel}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          statusColors[s.status] ?? "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {statusLabels[s.status] ?? s.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-charcoal/70">
                      {formatDate(s.shipped_at)}
                    </td>
                    <td className="px-4 py-3 text-charcoal/70">
                      {formatDate(s.delivered_at)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {s.status !== "delivered" && (
                          <button
                            onClick={() => handleCheckOne(s.id)}
                            className="rounded p-1 text-steel hover:bg-navy/5 hover:text-navy"
                            title="Check tracking status"
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <a
                          href={`https://parcelsapp.com/en/tracking/${s.tracking_number}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded p-1 text-steel hover:bg-navy/5 hover:text-navy"
                          title="Track on web"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-3 text-xs text-steel">
        {filtered.length} shipment{filtered.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
