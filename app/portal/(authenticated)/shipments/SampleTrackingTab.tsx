"use client";

// ============================================================
// Sample Tracking tab — pre-existing CRM sample shipment tracker.
// Lifted from the original /portal/shipments client page so it can
// live next to the new Web Orders tab. Behavior is unchanged.
// ============================================================

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  Plus,
  RefreshCw,
  Package,
  ExternalLink,
  Pencil,
  Check,
  X,
} from "lucide-react";
import { updateShipment } from "./actions";
import type { SampleShipmentRow } from "./ShipmentsClient";

type ShipmentStatus = SampleShipmentRow["status"];

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

export default function SampleTrackingTab({
  initialShipments,
}: {
  initialShipments: SampleShipmentRow[];
}) {
  const [shipments, setShipments] = useState<SampleShipmentRow[]>(
    initialShipments
  );
  const [filter, setFilter] = useState<FilterTab>("all");
  const [checking, startChecking] = useTransition();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{
    carrier: string;
    status: ShipmentStatus;
    delivered_at: string;
  }>({ carrier: "usps", status: "pending", delivered_at: "" });

  // Resync local state when the server-rendered list changes (e.g., search).
  useEffect(() => {
    setShipments(initialShipments);
  }, [initialShipments]);

  async function fetchShipments() {
    const supabase = createClient();
    const { data } = await supabase
      .from("shipments")
      .select(
        "id, tracking_number, carrier, status, recipient_name, shipped_at, delivered_at, notes, lead_id, lead:leads(id, contact:contacts(first_name, last_name), company:companies(name))"
      )
      .order("created_at", { ascending: false });
    setShipments((data as any[]) ?? []);
  }

  const filtered =
    filter === "active"
      ? shipments.filter((s) => s.status !== "delivered")
      : filter === "delivered"
        ? shipments.filter((s) => s.status === "delivered")
        : shipments;

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
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

  function startEdit(s: SampleShipmentRow) {
    setEditError(null);
    setEditingId(s.id);
    setEditForm({
      carrier: s.carrier,
      status: s.status,
      delivered_at: s.delivered_at
        ? new Date(s.delivered_at).toISOString().split("T")[0]
        : "",
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }

  async function handleSaveEdit(shipmentId: string) {
    setEditError(null);
    setSavingId(shipmentId);
    try {
      await updateShipment(shipmentId, {
        carrier: editForm.carrier,
        status: editForm.status,
        delivered_at: editForm.delivered_at || null,
      });
      setEditingId(null);
      await fetchShipments();
    } catch (e: any) {
      setEditError(e?.message ?? "Failed to update shipment.");
    } finally {
      setSavingId(null);
    }
  }

  const activeCount = shipments.filter((s) => s.status !== "delivered").length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-navy/5 p-1">
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

      {editError && (
        <div className="rounded-md border border-red/20 bg-red/5 px-4 py-3 text-sm text-red">
          {editError}
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-navy/10 bg-white shadow-sm">
        {filtered.length === 0 ? (
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
                    : leadContact ?? leadCompany ?? "—";

                const isEditing = editingId === s.id;
                const isSaving = savingId === s.id;

                return (
                  <tr
                    key={s.id}
                    className="transition-colors hover:bg-offwhite"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-charcoal">
                      {s.tracking_number}
                    </td>
                    <td className="px-4 py-3 text-charcoal/70">
                      {isEditing ? (
                        <select
                          value={editForm.carrier}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              carrier: e.target.value,
                            }))
                          }
                          className="rounded-md border border-navy/20 bg-white px-2 py-1 text-xs text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                        >
                          <option value="usps">USPS</option>
                          <option value="ups">UPS</option>
                          <option value="fedex">FedEx</option>
                        </select>
                      ) : (
                        carrierLabels[s.carrier] ?? s.carrier
                      )}
                    </td>
                    <td className="px-4 py-3 text-charcoal/70">
                      {s.recipient_name ?? "—"}
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
                      {isEditing ? (
                        <select
                          value={editForm.status}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              status: e.target.value as ShipmentStatus,
                            }))
                          }
                          className="rounded-md border border-navy/20 bg-white px-2 py-1 text-xs text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                        >
                          <option value="pending">Pending</option>
                          <option value="in_transit">In Transit</option>
                          <option value="out_for_delivery">
                            Out for Delivery
                          </option>
                          <option value="delivered">Delivered</option>
                          <option value="exception">Exception</option>
                        </select>
                      ) : (
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            statusColors[s.status] ??
                            "bg-gray-100 text-gray-800"
                          }`}
                        >
                          {statusLabels[s.status] ?? s.status}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-charcoal/70">
                      {formatDate(s.shipped_at)}
                    </td>
                    <td className="px-4 py-3 text-charcoal/70">
                      {isEditing ? (
                        <input
                          type="date"
                          value={editForm.delivered_at}
                          onChange={(e) =>
                            setEditForm((f) => ({
                              ...f,
                              delivered_at: e.target.value,
                            }))
                          }
                          className="rounded-md border border-navy/20 bg-white px-2 py-1 text-xs text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                        />
                      ) : (
                        formatDate(s.delivered_at)
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <button
                              onClick={() => handleSaveEdit(s.id)}
                              disabled={isSaving}
                              className="rounded p-1 text-green-700 hover:bg-green-50 disabled:opacity-50"
                              title="Save"
                              aria-label="Save"
                            >
                              <Check className="h-3.5 w-3.5" />
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={isSaving}
                              className="rounded p-1 text-steel hover:bg-navy/5 hover:text-navy disabled:opacity-50"
                              title="Cancel"
                              aria-label="Cancel"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              onClick={() => startEdit(s)}
                              className="rounded p-1 text-steel hover:bg-navy/5 hover:text-navy"
                              title="Edit shipment"
                              aria-label="Edit shipment"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
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
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-steel">
        {filtered.length} shipment{filtered.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
