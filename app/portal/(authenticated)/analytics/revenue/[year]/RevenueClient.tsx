"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, X, Pencil, Check } from "lucide-react";
import {
  AnalyticsShell,
  SummaryCards,
  SourceTag,
  formatUSD,
  formatDate,
} from "../../_shared/Shell";
import { SortableTable, type Column } from "../../_shared/SortableTable";
import {
  createManualOrder,
  updateManualOrder,
  deleteManualOrder,
  deleteWebOrder,
  type ManualOrderPart,
} from "./actions";

const editInputCls =
  "rounded border border-navy/30 bg-white px-2 py-1 text-xs text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";

type PaidOrder = {
  id: string;
  customer_name: string;
  company_name: string | null;
  product_6in_qty: number;
  product_11in_qty: number;
  total_charged: number;
  shipped_at: string | null;
  status: string;
  shipping_status: string | null;
  created_at: string;
};

type ManualOrder = {
  id: string;
  customer_name: string;
  customer_company: string | null;
  order_date: string;
  parts: ManualOrderPart[];
  total_revenue: number;
  source: string;
  notes: string | null;
  lead_id: string | null;
  created_at: string;
};

type LeadOption = {
  id: string;
  contact: { first_name: string; last_name: string } | null;
  company: { name: string } | null;
};

type UnifiedRow = {
  rowKey: string;
  source: "web" | "manual";
  date: string;
  customer: string;
  company: string;
  qty6: number;
  qty11: number;
  total: number;
  leadId: string | null;
  raw: PaidOrder | ManualOrder;
};

export default function RevenueClient({
  year,
  paid,
  manual,
  leads,
}: {
  year: number;
  paid: PaidOrder[];
  manual: ManualOrder[];
  leads: LeadOption[];
}) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({
    customer_name: "",
    customer_company: "",
    order_date: "",
    total_revenue: "",
    notes: "",
    lead_id: "",
  });
  const [editError, setEditError] = useState<string | null>(null);
  const [editPending, startEditTransition] = useTransition();

  function startEdit(m: ManualOrder) {
    setEditError(null);
    setEditingId(m.id);
    setEdit({
      customer_name: m.customer_name,
      customer_company: m.customer_company ?? "",
      order_date: m.order_date,
      total_revenue: String(m.total_revenue ?? ""),
      notes: m.notes ?? "",
      lead_id: m.lead_id ?? "",
    });
  }
  function cancelEdit() {
    setEditingId(null);
    setEditError(null);
  }
  function saveEdit(m: ManualOrder) {
    startEditTransition(async () => {
      try {
        await updateManualOrder({
          id: m.id,
          customer_name: edit.customer_name,
          customer_company: edit.customer_company || null,
          order_date: edit.order_date,
          total_revenue: Number(edit.total_revenue),
          notes: edit.notes || null,
          lead_id: edit.lead_id || null,
          year,
        });
        setEditingId(null);
        router.refresh();
      } catch (e) {
        setEditError(e instanceof Error ? e.message : "Save failed");
      }
    });
  }
  function deleteRow(m: ManualOrder) {
    if (
      !confirm(
        `Delete this manual order for ${m.customer_name}? This can't be undone.`,
      )
    )
      return;
    startEditTransition(async () => {
      try {
        await deleteManualOrder({ id: m.id, year });
        if (editingId === m.id) setEditingId(null);
        router.refresh();
      } catch (e) {
        setEditError(e instanceof Error ? e.message : "Delete failed");
      }
    });
  }
  function deleteWebRow(o: PaidOrder) {
    if (
      !confirm(
        `Delete this web order from ${o.customer_name} (${formatUSD(Number(o.total_charged))})? Stripe still has its record — this just drops the local mirror so it stops counting toward revenue. Use this for test orders only.`,
      )
    )
      return;
    startEditTransition(async () => {
      try {
        await deleteWebOrder({ id: o.id, year });
        router.refresh();
      } catch (e) {
        setEditError(e instanceof Error ? e.message : "Delete failed");
      }
    });
  }

  const rows = useMemo<UnifiedRow[]>(() => {
    const webRows: UnifiedRow[] = paid.map((o) => ({
      rowKey: `web:${o.id}`,
      source: "web",
      date: o.created_at,
      customer: o.customer_name,
      company: o.company_name ?? "",
      qty6: o.product_6in_qty ?? 0,
      qty11: o.product_11in_qty ?? 0,
      total: Number(o.total_charged ?? 0),
      leadId: null,
      raw: o,
    }));
    const manualRows: UnifiedRow[] = manual.map((m) => {
      const parts = Array.isArray(m.parts) ? m.parts : [];
      const qty6 = parts
        .filter((p) => p.size === "6in")
        .reduce((s, p) => s + (Number(p.qty) || 0), 0);
      const qty11 = parts
        .filter((p) => p.size === "11in")
        .reduce((s, p) => s + (Number(p.qty) || 0), 0);
      return {
        rowKey: `manual:${m.id}`,
        source: "manual",
        date: m.order_date,
        customer: m.customer_name,
        company: m.customer_company ?? "",
        qty6,
        qty11,
        total: Number(m.total_revenue ?? 0),
        leadId: m.lead_id,
        raw: m,
      };
    });
    return [...webRows, ...manualRows];
  }, [paid, manual]);

  const totalWeb = paid.reduce((s, o) => s + Number(o.total_charged ?? 0), 0);
  const totalManual = manual.reduce(
    (s, m) => s + Number(m.total_revenue ?? 0),
    0,
  );
  const totalAll = totalWeb + totalManual;

  const isEditingManual = (r: UnifiedRow) =>
    r.source === "manual" && editingId === (r.raw as ManualOrder).id;

  const columns: Column<UnifiedRow>[] = [
    {
      key: "date",
      label: "Order date",
      render: (r) =>
        isEditingManual(r) ? (
          <input
            type="date"
            value={edit.order_date}
            onChange={(e) =>
              setEdit((s) => ({ ...s, order_date: e.target.value }))
            }
            className={editInputCls}
          />
        ) : (
          formatDate(r.date)
        ),
      sortValue: (r) => r.date,
    },
    {
      key: "source",
      label: "Source",
      render: (r) =>
        r.source === "web" ? (
          <SourceTag variant="web">Web · Stripe</SourceTag>
        ) : (
          <SourceTag variant="manual">Manual</SourceTag>
        ),
      sortValue: (r) => r.source,
    },
    {
      key: "customer",
      label: "Customer",
      render: (r) =>
        isEditingManual(r) ? (
          <input
            type="text"
            value={edit.customer_name}
            onChange={(e) =>
              setEdit((s) => ({ ...s, customer_name: e.target.value }))
            }
            className={`${editInputCls} w-32`}
          />
        ) : (
          r.customer
        ),
      sortValue: (r) => r.customer.toLowerCase(),
    },
    {
      key: "company",
      label: "Company",
      render: (r) =>
        isEditingManual(r) ? (
          <input
            type="text"
            value={edit.customer_company}
            onChange={(e) =>
              setEdit((s) => ({ ...s, customer_company: e.target.value }))
            }
            className={`${editInputCls} w-32`}
            placeholder="—"
          />
        ) : (
          r.company || "—"
        ),
      sortValue: (r) => r.company.toLowerCase(),
    },
    {
      key: "qty6",
      label: "6in",
      align: "right",
      render: (r) => r.qty6 || "—",
      sortValue: (r) => r.qty6,
    },
    {
      key: "qty11",
      label: "11in",
      align: "right",
      render: (r) => r.qty11 || "—",
      sortValue: (r) => r.qty11,
    },
    {
      key: "total",
      label: "Total",
      align: "right",
      render: (r) =>
        isEditingManual(r) ? (
          <input
            type="number"
            min="0"
            step="0.01"
            value={edit.total_revenue}
            onChange={(e) =>
              setEdit((s) => ({ ...s, total_revenue: e.target.value }))
            }
            className={`${editInputCls} w-24 text-right`}
          />
        ) : (
          <span className="font-semibold">{formatUSD(r.total)}</span>
        ),
      sortValue: (r) => r.total,
    },
    {
      key: "lead",
      label: "Lead",
      render: (r) => {
        if (isEditingManual(r)) {
          return (
            <select
              value={edit.lead_id}
              onChange={(e) =>
                setEdit((s) => ({ ...s, lead_id: e.target.value }))
              }
              className={`${editInputCls} w-40`}
            >
              <option value="">— None —</option>
              {leads.map((l) => {
                const name = l.contact
                  ? `${l.contact.first_name} ${l.contact.last_name}`
                  : "(no contact)";
                return (
                  <option key={l.id} value={l.id}>
                    {name}
                    {l.company?.name ? ` · ${l.company.name}` : ""}
                  </option>
                );
              })}
            </select>
          );
        }
        return r.leadId ? (
          <Link
            href={`/portal/leads/${r.leadId}`}
            className="text-navy underline-offset-2 hover:underline"
          >
            View →
          </Link>
        ) : (
          <span className="text-steel">—</span>
        );
      },
      sortable: false,
    },
    {
      key: "actions",
      label: "",
      sortable: false,
      render: (r) => {
        if (r.source === "web") {
          const o = r.raw as PaidOrder;
          return (
            <div className="flex items-center gap-1">
              <span
                className="text-[10px] text-steel/60"
                title="Web orders are managed in Stripe. Edit isn't available here."
              >
                Stripe
              </span>
              <button
                type="button"
                onClick={() => deleteWebRow(o)}
                disabled={editPending}
                className="rounded p-1 text-steel hover:bg-offwhite hover:text-red disabled:opacity-50"
                aria-label="Delete web order (test cleanup)"
                title="Delete (test cleanup — Stripe still has the record)"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        }
        const m = r.raw as ManualOrder;
        if (isEditingManual(r)) {
          return (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => saveEdit(m)}
                disabled={editPending}
                className="rounded bg-navy p-1 text-white hover:bg-navy/90 disabled:opacity-50"
                aria-label="Save"
                title="Save"
              >
                <Check className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={cancelEdit}
                disabled={editPending}
                className="rounded border border-navy/20 p-1 text-steel hover:bg-offwhite hover:text-navy disabled:opacity-50"
                aria-label="Cancel"
                title="Cancel"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => startEdit(m)}
              className="rounded p-1 text-steel hover:bg-offwhite hover:text-navy"
              aria-label="Edit"
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={() => deleteRow(m)}
              disabled={editPending}
              className="rounded p-1 text-steel hover:bg-offwhite hover:text-red disabled:opacity-50"
              aria-label="Delete"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      },
    },
  ];

  return (
    <AnalyticsShell
      metric="Revenue"
      year={year}
      title={`Revenue · ${year}`}
      subtitle="Year-to-date revenue across web orders (Stripe) and offline orders entered manually."
      summary={
        <SummaryCards
          cards={[
            {
              label: "Web orders",
              value: formatUSD(totalWeb),
              hint: `${paid.length} paid order${paid.length === 1 ? "" : "s"}`,
            },
            {
              label: "Manual orders",
              value: formatUSD(totalManual),
              hint: `${manual.length} entered`,
            },
            {
              label: `Total revenue · ${year}`,
              value: formatUSD(totalAll),
              hint: "Web + manual",
              emphasis: true,
            },
          ]}
        />
      }
    >
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-navy">
          All revenue-contributing orders ({rows.length})
        </h3>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 rounded-md bg-red px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red/90"
          >
            <Plus className="h-4 w-4" />
            Add Manual Order
          </button>
        )}
      </div>

      {editError && (
        <p className="mb-2 rounded bg-red/10 px-3 py-2 text-xs text-red">
          {editError}
        </p>
      )}
      <SortableTable
        columns={columns}
        rows={rows}
        defaultSort={{ key: "date", dir: "desc" }}
        emptyMessage={`No revenue logged in ${year} yet. Click "Add Manual Order" to log an offline sale.`}
      />
      <p className="mt-3 text-[11px] text-steel">
        Click the pencil on a manual row to edit, or the trash to delete. Web
        orders are managed in Stripe (edit from{" "}
        <Link
          href="/portal/shipments"
          className="text-navy underline-offset-2 hover:underline"
        >
          /portal/shipments
        </Link>
        ); the trash on a web row deletes the local mirror only — use it to
        clean up stray test orders.
      </p>

      {showForm && (
        <AddManualOrderForm
          leads={leads}
          year={year}
          onCancel={() => setShowForm(false)}
          onSaved={() => {
            setShowForm(false);
            router.refresh();
          }}
        />
      )}
    </AnalyticsShell>
  );
}

// ── Add Manual Order form ──

type FormPart = { size: "6in" | "11in"; qty: string; unit_price: string };

function AddManualOrderForm({
  leads,
  year,
  onCancel,
  onSaved,
}: {
  leads: LeadOption[];
  year: number;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [customerName, setCustomerName] = useState("");
  const [customerCompany, setCustomerCompany] = useState("");
  const [orderDate, setOrderDate] = useState(today);
  const [parts, setParts] = useState<FormPart[]>([
    { size: "6in", qty: "1", unit_price: "100.00" },
  ]);
  const [autoTotal, setAutoTotal] = useState(true);
  const [totalRevenue, setTotalRevenue] = useState("100.00");
  const [notes, setNotes] = useState("");
  const [leadId, setLeadId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const computedTotal = useMemo(
    () =>
      parts.reduce((s, p) => {
        const qty = Number(p.qty) || 0;
        const price = Number(p.unit_price) || 0;
        return s + qty * price;
      }, 0),
    [parts],
  );

  const effectiveTotal = autoTotal
    ? computedTotal.toFixed(2)
    : totalRevenue;

  function updatePart(i: number, patch: Partial<FormPart>) {
    setParts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }
  function addPart() {
    setParts((prev) => [
      ...prev,
      { size: "6in", qty: "1", unit_price: "100.00" },
    ]);
  }
  function removePart(i: number) {
    setParts((prev) => prev.filter((_, idx) => idx !== i));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await createManualOrder({
          customer_name: customerName,
          customer_company: customerCompany || null,
          order_date: orderDate,
          parts: parts.map((p) => ({
            size: p.size,
            qty: Number(p.qty),
            unit_price: Number(p.unit_price),
          })),
          total_revenue: Number(effectiveTotal),
          notes: notes || null,
          lead_id: leadId || null,
        });
        onSaved();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed");
      }
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-6 rounded-lg border border-navy/15 bg-offwhite/60 p-5 shadow-sm"
    >
      <div className="mb-4 flex items-start justify-between">
        <div>
          <h4 className="text-sm font-bold text-navy">Add Manual Order</h4>
          <p className="mt-1 text-xs text-steel">
            Boeing, Delta, or any direct PO that doesn&apos;t go through the
            website. Saves into <code className="rounded bg-white px-1 py-0.5 text-[11px]">manual_orders</code>;
            the dashboard &quot;Revenue&quot; tile updates on the next load.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="rounded p-1 text-steel hover:bg-white hover:text-navy"
          aria-label="Close form"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Customer name *">
          <input
            type="text"
            required
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="e.g. Mark Reynolds"
            className={inputCls}
          />
        </Field>
        <Field label="Customer company">
          <input
            type="text"
            value={customerCompany}
            onChange={(e) => setCustomerCompany(e.target.value)}
            placeholder="e.g. Boeing"
            className={inputCls}
          />
        </Field>

        <Field label="Order date *">
          <input
            type="date"
            required
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            className={inputCls}
          />
        </Field>
        <Field label="Link to existing lead (optional)">
          <select
            value={leadId}
            onChange={(e) => setLeadId(e.target.value)}
            className={inputCls}
          >
            <option value="">— None —</option>
            {leads.map((l) => {
              const name = l.contact
                ? `${l.contact.first_name} ${l.contact.last_name}`
                : "(no contact)";
              const co = l.company?.name ? ` · ${l.company.name}` : "";
              return (
                <option key={l.id} value={l.id}>
                  {name}
                  {co}
                </option>
              );
            })}
          </select>
        </Field>

        <div className="sm:col-span-2">
          <p className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-steel">
            Parts
          </p>
          <div className="space-y-2">
            {parts.map((p, i) => {
              const lineTotal = (Number(p.qty) || 0) * (Number(p.unit_price) || 0);
              return (
                <div
                  key={i}
                  className="grid grid-cols-[100px_90px_120px_1fr_auto] items-center gap-2 rounded-md border border-navy/10 bg-white p-2"
                >
                  <select
                    value={p.size}
                    onChange={(e) =>
                      updatePart(i, { size: e.target.value as "6in" | "11in" })
                    }
                    className={`${inputCls} text-sm`}
                  >
                    <option value="6in">6in</option>
                    <option value="11in">11in</option>
                  </select>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={p.qty}
                    onChange={(e) => updatePart(i, { qty: e.target.value })}
                    className={`${inputCls} text-sm`}
                    placeholder="Qty"
                  />
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={p.unit_price}
                    onChange={(e) =>
                      updatePart(i, { unit_price: e.target.value })
                    }
                    className={`${inputCls} text-sm`}
                    placeholder="Unit price"
                  />
                  <span className="text-xs text-steel">
                    Line · <span className="font-semibold text-navy">{formatUSD(lineTotal)}</span>
                  </span>
                  {parts.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePart(i)}
                      className="rounded p-1 text-steel hover:bg-offwhite hover:text-red"
                      aria-label="Remove line"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={addPart}
            className="mt-2 text-xs font-semibold text-red underline-offset-2 hover:underline"
          >
            + Add another line
          </button>
        </div>

        <Field label="Total revenue ($) *">
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              step="0.01"
              value={effectiveTotal}
              onChange={(e) => {
                setAutoTotal(false);
                setTotalRevenue(e.target.value);
              }}
              className={inputCls}
            />
            <label className="flex shrink-0 items-center gap-1 text-[11px] text-steel">
              <input
                type="checkbox"
                checked={autoTotal}
                onChange={(e) => {
                  setAutoTotal(e.target.checked);
                  if (e.target.checked) {
                    setTotalRevenue(computedTotal.toFixed(2));
                  }
                }}
                className="rounded border-navy/30"
              />
              auto
            </label>
          </div>
        </Field>
        <Field label="Source tag">
          <input
            type="text"
            value="manual"
            disabled
            className={`${inputCls} cursor-not-allowed bg-offwhite/60 text-steel`}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Notes">
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="PO #, ship date, channel, anything worth remembering"
              className={`${inputCls} resize-none`}
            />
          </Field>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded bg-red/10 px-3 py-2 text-xs text-red">
          {error}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={pending}
          className="rounded-md border border-navy/20 bg-white px-4 py-2 text-sm font-semibold text-navy hover:bg-offwhite disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-navy px-5 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save manual order"}
        </button>
      </div>
    </form>
  );
}

const inputCls =
  "w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-steel">
        {label}
      </span>
      {children}
    </label>
  );
}
