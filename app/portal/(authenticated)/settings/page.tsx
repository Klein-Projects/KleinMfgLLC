"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Check, X, Power } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

type DiscountType = "percent" | "amount" | "tiered_percent";
type Tier = { min_qty: number; percent_off: number };

type Company = { id: string; name: string };

type Code = {
  id: string;
  code: string;
  discount_type: DiscountType;
  discount_value_6: number | null;
  discount_value_11: number | null;
  is_active: boolean;
  label: string | null;
  company_id: string | null;
  company: { id: string; name: string } | null;
  created_at: string;
  tiers: Tier[];
};

const TYPE_LABELS: Record<DiscountType, string> = {
  amount: "$ off",
  percent: "% off",
  tiered_percent: "Tiered %",
};

function formatDiscountValue(c: Code, side: "6" | "11"): string {
  if (c.discount_type === "tiered_percent") return "—";
  const v = side === "6" ? c.discount_value_6 : c.discount_value_11;
  if (v == null) return "—";
  return c.discount_type === "percent"
    ? `${Number(v)}%`
    : `$${Number(v).toFixed(2)}`;
}

export default function SettingsPage() {
  const [codes, setCodes] = useState<Code[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("companies")
      .select("id, name")
      .order("name")
      .then(({ data }) => {
        setCompanies((data as Company[]) ?? []);
      });
  }, []);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/discount/codes");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load.");
      setCodes(data.codes ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function toggleActive(c: Code) {
    setError("");
    try {
      const res = await fetch(`/api/discount/codes/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !c.is_active }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed.");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed.");
    }
  }

  async function deleteCode(c: Code) {
    if (
      !confirm(
        `Delete discount code "${c.code}"? This cannot be undone.`
      )
    )
      return;
    setError("");
    try {
      const res = await fetch(`/api/discount/codes/${c.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Delete failed.");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  return (
    <div className="px-6 py-8 lg:px-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-navy">Sales Settings</h1>
          <p className="mt-1 text-sm text-steel">
            Manage discount codes used at checkout. Changes take effect
            immediately.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy/90"
        >
          <Plus className="h-4 w-4" /> New Code
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red bg-red/10 px-4 py-3 text-sm font-semibold text-red"
        >
          {error}
        </div>
      )}

      {showCreate && (
        <CodeFormCard
          mode="create"
          companies={companies}
          onCancel={() => setShowCreate(false)}
          onSaved={() => {
            setShowCreate(false);
            load();
          }}
          onError={setError}
        />
      )}

      {loading ? (
        <p className="text-sm text-steel">Loading…</p>
      ) : codes.length === 0 ? (
        <p className="text-sm text-steel">
          No discount codes yet. Click <strong>New Code</strong> to create one.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-navy/10 bg-white">
          <table className="min-w-full divide-y divide-navy/10 text-sm">
            <thead className="bg-offwhite text-left text-xs font-semibold uppercase tracking-wide text-steel">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">6&quot; Discount</th>
                <th className="px-4 py-3">11&quot; Discount</th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/5">
              {codes.map((c) => {
                const isEditing = editingId === c.id;
                return (
                  <tr key={c.id} className="bg-white align-top">
                    {isEditing ? (
                      <td colSpan={8} className="p-0">
                        <CodeFormCard
                          mode="edit"
                          existing={c}
                          companies={companies}
                          onCancel={() => setEditingId(null)}
                          onSaved={() => {
                            setEditingId(null);
                            load();
                          }}
                          onError={setError}
                        />
                      </td>
                    ) : (
                      <>
                        <td className="px-4 py-3 font-semibold text-navy">
                          {c.code}
                          {c.discount_type === "tiered_percent" && c.tiers.length > 0 && (
                            <ul className="mt-1 text-xs font-normal text-steel">
                              {c.tiers.map((t) => (
                                <li key={t.min_qty}>
                                  {t.min_qty}+ parts: {t.percent_off}% off
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                        <td className="px-4 py-3 text-charcoal">
                          {TYPE_LABELS[c.discount_type]}
                        </td>
                        <td className="px-4 py-3 text-charcoal">
                          {formatDiscountValue(c, "6")}
                        </td>
                        <td className="px-4 py-3 text-charcoal">
                          {formatDiscountValue(c, "11")}
                        </td>
                        <td className="px-4 py-3 text-charcoal">
                          {c.label ?? <span className="text-steel">—</span>}
                        </td>
                        <td className="px-4 py-3 text-charcoal">
                          {c.company?.name ?? <span className="text-steel">—</span>}
                        </td>
                        <td className="px-4 py-3">
                          {c.is_active ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                              <Check className="h-3 w-3" /> Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-steel/10 px-2 py-0.5 text-xs font-semibold text-steel">
                              <X className="h-3 w-3" /> Inactive
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => setEditingId(c.id)}
                              className="inline-flex items-center gap-1 rounded-md border border-navy/20 bg-white px-2.5 py-1 text-xs font-semibold text-navy hover:border-navy"
                              aria-label={`Edit ${c.code}`}
                            >
                              <Pencil className="h-3 w-3" /> Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleActive(c)}
                              className="inline-flex items-center gap-1 rounded-md border border-navy/20 bg-white px-2.5 py-1 text-xs font-semibold text-navy hover:border-navy"
                              aria-label={
                                c.is_active
                                  ? `Deactivate ${c.code}`
                                  : `Activate ${c.code}`
                              }
                            >
                              <Power className="h-3 w-3" />{" "}
                              {c.is_active ? "Deactivate" : "Activate"}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteCode(c)}
                              className="inline-flex items-center gap-1 rounded-md border border-red/40 bg-white px-2.5 py-1 text-xs font-semibold text-red hover:border-red hover:bg-red/5"
                              aria-label={`Delete ${c.code}`}
                            >
                              <Trash2 className="h-3 w-3" /> Delete
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Create / Edit form ──────────────────────────────────────────────────────

function CodeFormCard({
  mode,
  existing,
  companies,
  onCancel,
  onSaved,
  onError,
}: {
  mode: "create" | "edit";
  existing?: Code;
  companies: Company[];
  onCancel: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [code, setCode] = useState(existing?.code ?? "");
  const [type, setType] = useState<DiscountType>(
    existing?.discount_type ?? "amount"
  );
  const [value6, setValue6] = useState(
    existing?.discount_value_6 != null ? String(existing.discount_value_6) : ""
  );
  const [value11, setValue11] = useState(
    existing?.discount_value_11 != null ? String(existing.discount_value_11) : ""
  );
  const [label, setLabel] = useState(existing?.label ?? "");
  const [companyId, setCompanyId] = useState<string>(existing?.company_id ?? "");
  const [tiers, setTiers] = useState<Tier[]>(
    existing?.tiers && existing.tiers.length > 0
      ? [...existing.tiers].sort((a, b) => a.min_qty - b.min_qty)
      : type === "tiered_percent"
        ? [{ min_qty: 10, percent_off: 5 }]
        : []
  );
  const [submitting, setSubmitting] = useState(false);

  function setTier(idx: number, field: keyof Tier, raw: string) {
    setTiers((prev) => {
      const next = [...prev];
      const n = Number(raw);
      next[idx] = {
        ...next[idx],
        [field]: Number.isFinite(n) ? n : 0,
      };
      return next;
    });
  }

  function addTier() {
    const last = tiers[tiers.length - 1];
    setTiers([
      ...tiers,
      {
        min_qty: last ? last.min_qty * 2 : 10,
        percent_off: last ? Math.min(100, last.percent_off + 5) : 5,
      },
    ]);
  }

  function removeTier(idx: number) {
    setTiers(tiers.filter((_, i) => i !== idx));
  }

  async function submit(ev: React.FormEvent) {
    ev.preventDefault();
    onError("");
    setSubmitting(true);
    try {
      const body: any = {
        code: code.trim(),
        discount_type: type,
        label: label.trim() || null,
        company_id: companyId || null,
      };
      if (type === "tiered_percent") {
        body.tiers = tiers.map((t) => ({
          min_qty: Number(t.min_qty),
          percent_off: Number(t.percent_off),
        }));
      } else {
        body.discount_value_6 = Number(value6);
        body.discount_value_11 = Number(value11);
      }

      const res =
        mode === "create"
          ? await fetch("/api/discount/codes", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            })
          : await fetch(`/api/discount/codes/${existing!.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed.");
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClasses =
    "w-full rounded-md border border-navy/20 px-3 py-2 text-sm text-charcoal outline-none focus:border-navy focus:ring-2 focus:ring-navy/20";
  const labelClasses = "block text-xs font-semibold uppercase tracking-wide text-steel";

  return (
    <form
      onSubmit={submit}
      className={`${
        mode === "edit" ? "" : "mb-6 rounded-lg border border-navy/20"
      } bg-offwhite p-4`}
    >
      <h3 className="mb-3 text-sm font-semibold text-navy">
        {mode === "create" ? "Create Discount Code" : `Edit ${existing?.code}`}
      </h3>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className={labelClasses}>Code</label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={mode === "edit"}
            placeholder="ACME10"
            required
            className={`${inputClasses} mt-1 ${
              mode === "edit" ? "bg-white/60 text-steel" : ""
            }`}
          />
        </div>
        <div>
          <label className={labelClasses}>Type</label>
          <select
            value={type}
            onChange={(e) => {
              const next = e.target.value as DiscountType;
              setType(next);
              if (next === "tiered_percent" && tiers.length === 0) {
                setTiers([{ min_qty: 10, percent_off: 5 }]);
              }
            }}
            className={`${inputClasses} mt-1`}
          >
            <option value="amount">$ off</option>
            <option value="percent">% off</option>
            <option value="tiered_percent">Tiered %</option>
          </select>
        </div>
        {type !== "tiered_percent" && (
          <>
            <div>
              <label className={labelClasses}>
                6&quot; Discount {type === "percent" ? "(%)" : "($)"}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={value6}
                onChange={(e) => setValue6(e.target.value)}
                required
                className={`${inputClasses} mt-1`}
              />
            </div>
            <div>
              <label className={labelClasses}>
                11&quot; Discount {type === "percent" ? "(%)" : "($)"}
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={value11}
                onChange={(e) => setValue11(e.target.value)}
                required
                className={`${inputClasses} mt-1`}
              />
            </div>
          </>
        )}
        <div className={type === "tiered_percent" ? "lg:col-span-2" : "lg:col-span-2"}>
          <label className={labelClasses}>Label (optional)</label>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Acme Aerospace volume pricing"
            className={`${inputClasses} mt-1`}
          />
        </div>
        <div className={type === "tiered_percent" ? "lg:col-span-2" : "lg:col-span-2"}>
          <label className={labelClasses}>Company (optional)</label>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className={`${inputClasses} mt-1`}
          >
            <option value="">— None —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-steel">
            Tying a code to a company auto-attributes web orders to that
            account&apos;s lead.
          </p>
        </div>
      </div>

      {type === "tiered_percent" && (
        <div className="mt-4 rounded-md border border-navy/10 bg-white p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-steel">
              Volume tiers
            </p>
            <button
              type="button"
              onClick={addTier}
              className="inline-flex items-center gap-1 rounded-md border border-navy/20 bg-white px-2 py-1 text-xs font-semibold text-navy hover:border-navy"
            >
              <Plus className="h-3 w-3" /> Add tier
            </button>
          </div>
          {tiers.length === 0 ? (
            <p className="text-xs text-steel">Add at least one tier.</p>
          ) : (
            <ul className="space-y-2">
              {tiers.map((t, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-steel">at qty</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={t.min_qty}
                    onChange={(e) => setTier(i, "min_qty", e.target.value)}
                    className="w-24 rounded-md border border-navy/20 px-2 py-1 text-sm"
                  />
                  <span className="text-xs text-steel">parts: discount</span>
                  <input
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    value={t.percent_off}
                    onChange={(e) => setTier(i, "percent_off", e.target.value)}
                    className="w-24 rounded-md border border-navy/20 px-2 py-1 text-sm"
                  />
                  <span className="text-xs text-steel">%</span>
                  <button
                    type="button"
                    onClick={() => removeTier(i)}
                    className="ml-auto inline-flex items-center rounded-md border border-red/40 px-2 py-1 text-xs font-semibold text-red hover:bg-red/5"
                    aria-label={`Remove tier ${i + 1}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          type="submit"
          disabled={submitting}
          className="inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white transition hover:bg-navy/90 disabled:opacity-60"
        >
          {submitting ? "Saving…" : mode === "create" ? "Create" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex items-center gap-2 rounded-md border border-navy/20 bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
