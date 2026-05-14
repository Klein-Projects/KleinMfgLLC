"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";
import {
  AnalyticsShell,
  SummaryCards,
  SourceTag,
  formatDate,
} from "../../_shared/Shell";
import { SortableTable, type Column } from "../../_shared/SortableTable";
import { updateShipment } from "./actions";

type ShipmentRow = {
  id: string;
  tracking_number: string;
  carrier: string;
  status: string;
  recipient_name: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  qty_6in: number | null;
  qty_11in: number | null;
  is_sample: boolean | null;
  notes: string | null;
  lead_id: string | null;
  lead: {
    id: string;
    contact: { first_name: string; last_name: string } | null;
    company: { name: string } | null;
  } | null;
};

type EditState = {
  shipped_at: string;
  qty_6in: string;
  qty_11in: string;
  is_sample: boolean;
};

const editInputCls =
  "rounded border border-navy/30 bg-white px-2 py-1 text-xs text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";

const statusColors: Record<string, string> = {
  pending: "bg-gray-100 text-gray-800",
  in_transit: "bg-blue-100 text-blue-800",
  out_for_delivery: "bg-amber-100 text-amber-800",
  delivered: "bg-green-100 text-green-800",
  exception: "bg-red-100 text-red-800",
};

export default function SamplesClient({
  year,
  shipments,
}: {
  year: number;
  shipments: ShipmentRow[];
}) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState>({
    shipped_at: "",
    qty_6in: "",
    qty_11in: "",
    is_sample: true,
  });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startEdit(r: ShipmentRow) {
    setError(null);
    setEditingId(r.id);
    setEdit({
      shipped_at: r.shipped_at ? r.shipped_at.split("T")[0] : "",
      qty_6in: r.qty_6in == null ? "" : String(r.qty_6in),
      qty_11in: r.qty_11in == null ? "" : String(r.qty_11in),
      is_sample: r.is_sample !== false,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setError(null);
  }

  function saveEdit(r: ShipmentRow) {
    if (!editingId) return;
    startTransition(async () => {
      try {
        await updateShipment({
          id: r.id,
          // Re-stamp shipped_at to noon UTC if Sean only entered a date,
          // so timezone math doesn't shove the row into the previous day.
          shipped_at: edit.shipped_at
            ? `${edit.shipped_at}T12:00:00Z`
            : null,
          qty_6in: edit.qty_6in === "" ? null : Number(edit.qty_6in),
          qty_11in: edit.qty_11in === "" ? null : Number(edit.qty_11in),
          is_sample: edit.is_sample,
          year,
        });
        setEditingId(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }

  const sample = shipments.filter((s) => s.is_sample !== false);
  const delivered = sample.filter((s) => s.status === "delivered").length;
  const inFlight = sample.filter(
    (s) => s.status === "in_transit" || s.status === "out_for_delivery",
  ).length;

  const isEditing = (id: string) => editingId === id;

  const columns: Column<ShipmentRow>[] = [
    {
      key: "shipped_at",
      label: "Shipped",
      render: (r) =>
        isEditing(r.id) ? (
          <input
            type="date"
            value={edit.shipped_at}
            onChange={(e) =>
              setEdit((s) => ({ ...s, shipped_at: e.target.value }))
            }
            className={editInputCls}
          />
        ) : (
          formatDate(r.shipped_at)
        ),
      sortValue: (r) => r.shipped_at ?? "",
    },
    {
      key: "recipient",
      label: "Recipient",
      render: (r) => {
        const ln = r.lead;
        const name =
          ln?.contact && (ln.contact.first_name || ln.contact.last_name)
            ? `${ln.contact.first_name} ${ln.contact.last_name}`.trim()
            : (r.recipient_name ?? "—");
        return ln ? (
          <Link
            href={`/portal/leads/${ln.id}`}
            className="text-navy underline-offset-2 hover:underline"
          >
            {name}
          </Link>
        ) : (
          name
        );
      },
      sortValue: (r) => (r.recipient_name ?? "").toLowerCase(),
    },
    {
      key: "company",
      label: "Company",
      render: (r) => r.lead?.company?.name ?? "—",
      sortValue: (r) => (r.lead?.company?.name ?? "").toLowerCase(),
    },
    {
      key: "qty6",
      label: "6in",
      align: "right",
      render: (r) =>
        isEditing(r.id) ? (
          <input
            type="number"
            min="0"
            step="1"
            value={edit.qty_6in}
            onChange={(e) =>
              setEdit((s) => ({ ...s, qty_6in: e.target.value }))
            }
            className={`${editInputCls} w-16 text-right`}
            placeholder="—"
          />
        ) : r.qty_6in == null ? (
          <span className="text-steel" title="Confirm qty">
            ?
          </span>
        ) : (
          r.qty_6in || "—"
        ),
      sortValue: (r) => r.qty_6in ?? -1,
    },
    {
      key: "qty11",
      label: "11in",
      align: "right",
      render: (r) =>
        isEditing(r.id) ? (
          <input
            type="number"
            min="0"
            step="1"
            value={edit.qty_11in}
            onChange={(e) =>
              setEdit((s) => ({ ...s, qty_11in: e.target.value }))
            }
            className={`${editInputCls} w-16 text-right`}
            placeholder="—"
          />
        ) : r.qty_11in == null ? (
          <span className="text-steel" title="Confirm qty">
            ?
          </span>
        ) : (
          r.qty_11in || "—"
        ),
      sortValue: (r) => r.qty_11in ?? -1,
    },
    {
      key: "carrier",
      label: "Carrier",
      render: (r) => r.carrier.toUpperCase(),
      sortValue: (r) => r.carrier,
    },
    {
      key: "status",
      label: "Status",
      render: (r) => (
        <span
          className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
            statusColors[r.status] ?? "bg-gray-100 text-gray-800"
          }`}
        >
          {r.status.replace(/_/g, " ")}
        </span>
      ),
      sortValue: (r) => r.status,
    },
    {
      key: "tracking",
      label: "Tracking",
      render: (r) => (
        <span className="font-mono text-[11px] text-charcoal/70">
          {r.tracking_number}
        </span>
      ),
      sortable: false,
    },
    {
      key: "type",
      label: "Type",
      render: (r) =>
        isEditing(r.id) ? (
          <label className="inline-flex items-center gap-1.5 text-[11px] text-charcoal">
            <input
              type="checkbox"
              checked={edit.is_sample}
              onChange={(e) =>
                setEdit((s) => ({ ...s, is_sample: e.target.checked }))
              }
              className="rounded border-navy/30"
            />
            Sample
          </label>
        ) : r.is_sample === false ? (
          <SourceTag variant="web">Paid</SourceTag>
        ) : (
          <SourceTag variant="sample">Sample</SourceTag>
        ),
      sortValue: (r) => (r.is_sample === false ? "paid" : "sample"),
    },
    {
      key: "actions",
      label: "",
      sortable: false,
      render: (r) =>
        isEditing(r.id) ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => saveEdit(r)}
              disabled={pending}
              className="rounded bg-navy p-1 text-white hover:bg-navy/90 disabled:opacity-50"
              aria-label="Save"
              title="Save"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={pending}
              className="rounded border border-navy/20 p-1 text-steel hover:bg-offwhite hover:text-navy disabled:opacity-50"
              aria-label="Cancel"
              title="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => startEdit(r)}
            className="rounded p-1 text-steel hover:bg-offwhite hover:text-navy"
            aria-label="Edit"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        ),
    },
  ];

  return (
    <AnalyticsShell
      metric="Free samples shipped"
      year={year}
      title={`Free samples shipped · ${year}`}
      subtitle="Every CRM-side shipment marked as a free sample. Edit affordances (qty, shipped date, sample flag) ship in Step 5."
      summary={
        <SummaryCards
          cards={[
            {
              label: "Sample shipments",
              value: sample.length.toLocaleString(),
              hint: `${shipments.length} total shipments in ${year}`,
            },
            {
              label: "Delivered",
              value: delivered.toLocaleString(),
              hint: `${inFlight} still in transit`,
            },
            {
              label: `Free samples · ${year}`,
              value: sample.length.toLocaleString(),
              hint: "is_sample = true · year(shipped_at) = year",
              emphasis: true,
            },
          ]}
        />
      }
    >
      <h3 className="mb-3 text-sm font-semibold text-navy">
        All sample shipments ({shipments.length})
      </h3>
      {error && (
        <p className="mb-2 rounded bg-red/10 px-3 py-2 text-xs text-red">
          {error}
        </p>
      )}
      <SortableTable
        columns={columns}
        rows={shipments}
        defaultSort={{ key: "shipped_at", dir: "desc" }}
        emptyMessage={`No sample shipments logged with shipped_at in ${year}.`}
      />
      <p className="mt-3 text-[11px] text-steel">
        A &quot;?&quot; in the qty column means the row pre-dates migration 018
        and the qty was never recorded. Click the pencil on any row to fill
        them in (or correct the shipped date / sample flag).
      </p>
    </AnalyticsShell>
  );
}
