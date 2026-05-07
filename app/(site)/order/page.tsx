"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

// ── Pricing ──
const PRICE_6_CENTS = 2100; // $21.00
const PRICE_11_CENTS = 2300; // $23.00
const CC_FEE_RATE = 0.0309; // 3.09%
const MIN_SUBTOTAL_CENTS = 10000; // $100 minimum order

type ShippingMethod = "klein_calculated" | "collect";

const US_STATES: { code: string; name: string }[] = [
  { code: "AL", name: "Alabama" }, { code: "AK", name: "Alaska" },
  { code: "AZ", name: "Arizona" }, { code: "AR", name: "Arkansas" },
  { code: "CA", name: "California" }, { code: "CO", name: "Colorado" },
  { code: "CT", name: "Connecticut" }, { code: "DE", name: "Delaware" },
  { code: "DC", name: "District of Columbia" }, { code: "FL", name: "Florida" },
  { code: "GA", name: "Georgia" }, { code: "HI", name: "Hawaii" },
  { code: "ID", name: "Idaho" }, { code: "IL", name: "Illinois" },
  { code: "IN", name: "Indiana" }, { code: "IA", name: "Iowa" },
  { code: "KS", name: "Kansas" }, { code: "KY", name: "Kentucky" },
  { code: "LA", name: "Louisiana" }, { code: "ME", name: "Maine" },
  { code: "MD", name: "Maryland" }, { code: "MA", name: "Massachusetts" },
  { code: "MI", name: "Michigan" }, { code: "MN", name: "Minnesota" },
  { code: "MS", name: "Mississippi" }, { code: "MO", name: "Missouri" },
  { code: "MT", name: "Montana" }, { code: "NE", name: "Nebraska" },
  { code: "NV", name: "Nevada" }, { code: "NH", name: "New Hampshire" },
  { code: "NJ", name: "New Jersey" }, { code: "NM", name: "New Mexico" },
  { code: "NY", name: "New York" }, { code: "NC", name: "North Carolina" },
  { code: "ND", name: "North Dakota" }, { code: "OH", name: "Ohio" },
  { code: "OK", name: "Oklahoma" }, { code: "OR", name: "Oregon" },
  { code: "PA", name: "Pennsylvania" }, { code: "RI", name: "Rhode Island" },
  { code: "SC", name: "South Carolina" }, { code: "SD", name: "South Dakota" },
  { code: "TN", name: "Tennessee" }, { code: "TX", name: "Texas" },
  { code: "UT", name: "Utah" }, { code: "VT", name: "Vermont" },
  { code: "VA", name: "Virginia" }, { code: "WA", name: "Washington" },
  { code: "WV", name: "West Virginia" }, { code: "WI", name: "Wisconsin" },
  { code: "WY", name: "Wyoming" },
];

function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function calcCcFee(subtotalCents: number, shippingCents: number): number {
  return Math.round((subtotalCents + shippingCents) * CC_FEE_RATE);
}

type DiscountTier = { min_qty: number; percent_off: number };

type AppliedDiscount = {
  code: string;
  label: string | null;
  discount_type: "percent" | "amount" | "tiered_percent";
  discount_value_6: number | null;
  discount_value_11: number | null;
  tiers: DiscountTier[];
  list_price_6: number;
  list_price_11: number;
};

function resolveDiscount(
  d: AppliedDiscount,
  qty6: number,
  qty11: number
): {
  unit6: number;
  unit11: number;
  activeTier: DiscountTier | null;
  nextTier: DiscountTier | null;
} {
  const list6 = d.list_price_6;
  const list11 = d.list_price_11;

  if (d.discount_type === "tiered_percent") {
    const total = (qty6 || 0) + (qty11 || 0);
    const sorted = [...d.tiers].sort((a, b) => a.min_qty - b.min_qty);
    let active: DiscountTier | null = null;
    for (const t of sorted) {
      if (total >= t.min_qty) active = t;
      else break;
    }
    const nextTier =
      sorted.find((t) => !active || t.min_qty > active.min_qty) ?? null;
    if (!active) {
      return { unit6: list6, unit11: list11, activeTier: null, nextTier };
    }
    const pct = active.percent_off / 100;
    return {
      unit6: Math.max(0, Math.round(list6 * (1 - pct))),
      unit11: Math.max(0, Math.round(list11 * (1 - pct))),
      activeTier: active,
      nextTier,
    };
  }

  if (d.discount_type === "percent") {
    const v6 = (d.discount_value_6 ?? 0) / 100;
    const v11 = (d.discount_value_11 ?? 0) / 100;
    return {
      unit6: Math.max(0, Math.round(list6 * (1 - v6))),
      unit11: Math.max(0, Math.round(list11 * (1 - v11))),
      activeTier: null,
      nextTier: null,
    };
  }

  // amount
  const off6 = Math.round((d.discount_value_6 ?? 0) * 100);
  const off11 = Math.round((d.discount_value_11 ?? 0) * 100);
  return {
    unit6: Math.max(0, list6 - off6),
    unit11: Math.max(0, list11 - off11),
    activeTier: null,
    nextTier: null,
  };
}

function OrderForm() {
  // ── Quantities (seeded from ?product= query param) ──
  const searchParams = useSearchParams();
  const presetProduct = searchParams?.get("product");
  const [qty6, setQty6] = useState(presetProduct === "6in" ? 5 : 0);
  const [qty11, setQty11] = useState(presetProduct === "11in" ? 5 : 0);

  // ── Shipping method ──
  const [shippingMethod, setShippingMethod] =
    useState<ShippingMethod>("klein_calculated");

  // ── Ship-collect sub-fields ──
  const [carrier, setCarrier] = useState<"UPS" | "FedEx">("UPS");
  const [accountNumber, setAccountNumber] = useState("");

  // ── Live shipping rate state ──
  const [shippingCents, setShippingCents] = useState<number | null>(null);
  const [shippingLoading, setShippingLoading] = useState(false);
  const [shippingError, setShippingError] = useState("");

  // ── Customer info ──
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    company: "",
    address1: "",
    address2: "",
    city: "",
    state: "",
    zip: "",
  });

  // ── Submission ──
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Discount code ──
  const [discountInput, setDiscountInput] = useState("");
  const [appliedDiscount, setAppliedDiscount] = useState<AppliedDiscount | null>(null);
  const [discountError, setDiscountError] = useState("");
  const [discountLoading, setDiscountLoading] = useState(false);

  function updateForm(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  // Resolve effective unit prices using the applied discount (re-evaluated as qty changes
  // so tiered codes recompute when the customer adjusts quantities).
  const resolved = appliedDiscount
    ? resolveDiscount(appliedDiscount, qty6, qty11)
    : null;
  const unitPrice6 = resolved?.unit6 ?? PRICE_6_CENTS;
  const unitPrice11 = resolved?.unit11 ?? PRICE_11_CENTS;

  const subtotalCents = qty6 * unitPrice6 + qty11 * unitPrice11;
  // Minimum-order check uses list prices so a discount can't drop you under $100.
  const listSubtotalCents = qty6 * PRICE_6_CENTS + qty11 * PRICE_11_CENTS;
  const effectiveShippingCents =
    shippingMethod === "collect" ? 0 : shippingCents ?? 0;
  const ccFeeCents = calcCcFee(subtotalCents, effectiveShippingCents);
  const totalCents = subtotalCents + effectiveShippingCents + ccFeeCents;

  // ── Live shipping rate fetcher ──
  // Track the latest request so out-of-order responses don't overwrite newer state.
  const rateRequestId = useRef(0);

  const fetchShippingRate = useCallback(async () => {
    if (shippingMethod !== "klein_calculated") return;
    if (form.zip.length < 5) return;
    if (listSubtotalCents < MIN_SUBTOTAL_CENTS) return;

    const myRequestId = ++rateRequestId.current;
    setShippingLoading(true);
    setShippingError("");

    try {
      const res = await fetch("/api/shipping-rate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zip: form.zip,
          qty6,
          qty11,
        }),
      });
      const data = await res.json();
      if (myRequestId !== rateRequestId.current) return; // stale
      if (!res.ok || data.error) {
        throw new Error(data.error || "Could not fetch shipping rate.");
      }
      setShippingCents(typeof data.amountCents === "number" ? data.amountCents : null);
    } catch (err) {
      if (myRequestId !== rateRequestId.current) return;
      setShippingError(
        err instanceof Error ? err.message : "Could not fetch shipping rate."
      );
      setShippingCents(null);
    } finally {
      if (myRequestId === rateRequestId.current) {
        setShippingLoading(false);
      }
    }
  }, [shippingMethod, form.zip, qty6, qty11, listSubtotalCents]);

  // Re-fetch when qty changes (if Klein UPS and zip valid)
  useEffect(() => {
    if (
      shippingMethod === "klein_calculated" &&
      form.zip.length >= 5 &&
      listSubtotalCents >= MIN_SUBTOTAL_CENTS
    ) {
      fetchShippingRate();
    } else if (shippingMethod === "klein_calculated") {
      setShippingCents(null);
      setShippingError("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qty6, qty11, shippingMethod]);

  // When switching to ship_collect, force shipping to $0.00 and clear rate state.
  useEffect(() => {
    if (shippingMethod === "collect") {
      setShippingCents(0);
      setShippingError("");
      setShippingLoading(false);
    }
  }, [shippingMethod]);

  async function applyDiscountCode() {
    const code = discountInput.trim();
    if (!code) {
      setDiscountError("Enter a discount code.");
      return;
    }
    setDiscountLoading(true);
    setDiscountError("");
    try {
      const res = await fetch("/api/discount/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          qty6,
          qty11,
          list_price_6: PRICE_6_CENTS,
          list_price_11: PRICE_11_CENTS,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.valid) {
        setAppliedDiscount(null);
        setDiscountError(data.error || "Invalid or expired discount code.");
        return;
      }
      setAppliedDiscount({
        code: data.code,
        label: data.label ?? null,
        discount_type: data.discount_type,
        discount_value_6:
          data.discount_value_6 == null ? null : Number(data.discount_value_6),
        discount_value_11:
          data.discount_value_11 == null ? null : Number(data.discount_value_11),
        tiers: Array.isArray(data.tiers)
          ? data.tiers.map((t: any) => ({
              min_qty: Number(t.min_qty),
              percent_off: Number(t.percent_off),
            }))
          : [],
        list_price_6: Number(data.list_price_6),
        list_price_11: Number(data.list_price_11),
      });
    } catch {
      setAppliedDiscount(null);
      setDiscountError("Could not validate discount code. Try again.");
    } finally {
      setDiscountLoading(false);
    }
  }

  function removeDiscountCode() {
    setAppliedDiscount(null);
    setDiscountError("");
    setDiscountInput("");
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (listSubtotalCents < MIN_SUBTOTAL_CENTS) {
      e.qty = `Minimum order is $${(MIN_SUBTOTAL_CENTS / 100).toFixed(0)}.`;
    }
    if (!form.fullName.trim()) e.fullName = "Required.";
    if (!form.email.trim()) {
      e.email = "Required.";
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      e.email = "Enter a valid email.";
    }
    if (!form.phone.trim()) e.phone = "Required.";
    if (!form.address1.trim()) e.address1 = "Required.";
    if (!form.city.trim()) e.city = "Required.";
    if (!form.state) e.state = "Required.";
    if (!form.zip.trim()) {
      e.zip = "Required.";
    } else if (!/^\d{5}(-\d{4})?$/.test(form.zip.trim())) {
      e.zip = "Enter a valid ZIP code.";
    }
    if (shippingMethod === "collect") {
      if (!carrier) e.carrier = "Required.";
      if (!accountNumber.trim()) e.accountNumber = "Required.";
    }
    if (shippingMethod === "klein_calculated" && shippingCents === null) {
      e.shipping = "Waiting for live shipping rate. Try again in a moment.";
    }
    return e;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitError("");
    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      let message = "Please complete all required fields above before continuing.";
      if (errs.qty) {
        message = errs.qty;
      } else if (errs.shipping) {
        message = errs.shipping;
      } else if (errs.accountNumber) {
        message = "Please enter your shipping account number.";
      } else if (errs.carrier) {
        message = "Please select a shipping carrier.";
      }
      setSubmitError(message);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: form.fullName.trim(),
          customerEmail: form.email.trim().toLowerCase(),
          customerPhone: form.phone.trim(),
          companyName: form.company.trim(),
          addressLine1: form.address1.trim(),
          addressLine2: form.address2.trim(),
          city: form.city.trim(),
          state: form.state,
          zip: form.zip.trim(),
          qty6in: qty6,
          qty11in: qty11,
          shippingMethod,
          shippingCost:
            shippingMethod === "klein_calculated" ? effectiveShippingCents : 0,
          carrierType: shippingMethod === "collect" ? carrier : "",
          carrierAccountNumber:
            shippingMethod === "collect" ? accountNumber.trim() : "",
          discountCode: appliedDiscount?.code ?? "",
        }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Could not start checkout.");
      }
      if (!data.url) {
        throw new Error("Checkout session did not return a URL.");
      }
      window.location.href = data.url;
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong."
      );
      setSubmitting(false);
    }
  }

  // ── UI helpers ──
  const inputClasses =
    "mt-1.5 w-full rounded-md border border-navy/20 px-4 py-2.5 text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20";
  const errorInputClasses = "border-red focus:border-red focus:ring-red/20";
  const labelClasses = "block text-sm font-semibold text-navy";
  const fieldError = (msg?: string) =>
    msg ? <p className="mt-1 text-xs text-red">{msg}</p> : null;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]"
    >
      {/* ── LEFT: form ── */}
      <div className="space-y-10">
        {/* Products */}
        <section>
          <h2 className="text-xl font-bold text-navy">Products</h2>
          <p className="mt-1 text-sm text-steel">
            Minimum order is $100 (any combination).
          </p>

          <div className="mt-4 space-y-4">
            <div className="flex flex-col gap-3 rounded-md border border-navy/20 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-navy">
                  6&quot; Phenolic Aviation Scraper
                </p>
                <p className="text-sm text-steel">$21.00 each</p>
              </div>
              <div>
                <label htmlFor="qty6" className="sr-only">
                  Quantity of 6 inch scrapers
                </label>
                <input
                  id="qty6"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={qty6 === 0 ? "" : qty6}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") return setQty6(0);
                    const n = parseInt(v, 10);
                    if (Number.isFinite(n) && n >= 0) setQty6(n);
                  }}
                  placeholder="0"
                  className="w-24 rounded-md border border-navy/20 px-3 py-2 text-center text-charcoal outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 rounded-md border border-navy/20 bg-white px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-navy">
                  11&quot; Phenolic Aviation Scraper
                </p>
                <p className="text-sm text-steel">$23.00 each</p>
              </div>
              <div>
                <label htmlFor="qty11" className="sr-only">
                  Quantity of 11 inch scrapers
                </label>
                <input
                  id="qty11"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={qty11 === 0 ? "" : qty11}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") return setQty11(0);
                    const n = parseInt(v, 10);
                    if (Number.isFinite(n) && n >= 0) setQty11(n);
                  }}
                  placeholder="0"
                  className="w-24 rounded-md border border-navy/20 px-3 py-2 text-center text-charcoal outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
                />
              </div>
            </div>
          </div>
          {fieldError(errors.qty)}

          {/* Discount Code */}
          <div className="mt-6 rounded-md border border-navy/20 bg-offwhite px-4 py-4">
            <label htmlFor="discountCode" className={labelClasses}>
              Discount Code
            </label>
            <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
              <input
                id="discountCode"
                type="text"
                value={discountInput}
                onChange={(e) => {
                  setDiscountInput(e.target.value);
                  if (discountError) setDiscountError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    if (!appliedDiscount && !discountLoading) applyDiscountCode();
                  }
                }}
                placeholder="Enter code"
                disabled={!!appliedDiscount || discountLoading}
                className={`flex-1 rounded-md border border-navy/20 px-4 py-2.5 text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20 disabled:bg-white/60 disabled:text-steel ${
                  discountError ? errorInputClasses : ""
                }`}
              />
              {appliedDiscount ? (
                <button
                  type="button"
                  onClick={removeDiscountCode}
                  className="inline-flex items-center justify-center rounded-md border border-navy/20 bg-white px-4 py-2.5 text-sm font-semibold text-navy transition hover:border-navy hover:bg-navy/5"
                >
                  Remove
                </button>
              ) : (
                <button
                  type="button"
                  onClick={applyDiscountCode}
                  disabled={discountLoading || !discountInput.trim()}
                  className="inline-flex items-center justify-center rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-navy/90 disabled:opacity-60"
                >
                  {discountLoading ? "Checking…" : "Apply"}
                </button>
              )}
            </div>

            {discountError && (
              <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-red">
                <svg
                  className="h-4 w-4 flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
                {discountError}
              </p>
            )}

            {appliedDiscount && resolved && (
              <div className="mt-3 space-y-2 text-sm">
                <p className="flex items-center gap-1.5 font-semibold text-green-700">
                  <svg
                    className="h-4 w-4 flex-shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Discount code <span className="font-bold">{appliedDiscount.code}</span> applied
                  {appliedDiscount.label ? ` — ${appliedDiscount.label}` : ""}
                </p>

                {appliedDiscount.discount_type === "tiered_percent" && (
                  <div className="rounded-md border border-navy/10 bg-white px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-steel">
                      Volume tiers
                    </p>
                    <ul className="mt-1 space-y-0.5">
                      {appliedDiscount.tiers.map((t) => {
                        const isActive =
                          resolved.activeTier?.min_qty === t.min_qty;
                        return (
                          <li
                            key={t.min_qty}
                            className={
                              isActive
                                ? "font-semibold text-green-700"
                                : "text-charcoal"
                            }
                          >
                            {isActive ? "✓ " : "• "}
                            {t.min_qty}+ parts: {t.percent_off}% off
                          </li>
                        );
                      })}
                    </ul>
                    {resolved.nextTier && (
                      <p className="mt-1 text-xs text-steel">
                        Add{" "}
                        {Math.max(
                          1,
                          resolved.nextTier.min_qty - (qty6 + qty11)
                        )}{" "}
                        more part(s) to unlock {resolved.nextTier.percent_off}% off.
                      </p>
                    )}
                  </div>
                )}

                {resolved.activeTier ||
                appliedDiscount.discount_type !== "tiered_percent" ? (
                  <>
                    <p className="text-charcoal">
                      6&quot;:{" "}
                      <span className="text-steel line-through">
                        {formatUSD(appliedDiscount.list_price_6)}
                      </span>{" "}
                      →{" "}
                      <span className="font-semibold">
                        {formatUSD(resolved.unit6)}
                      </span>
                    </p>
                    <p className="text-charcoal">
                      11&quot;:{" "}
                      <span className="text-steel line-through">
                        {formatUSD(appliedDiscount.list_price_11)}
                      </span>{" "}
                      →{" "}
                      <span className="font-semibold">
                        {formatUSD(resolved.unit11)}
                      </span>
                    </p>
                  </>
                ) : (
                  <p className="text-steel">
                    No discount yet — add parts to qualify for a tier.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>

        {/* Customer Info */}
        <section>
          <h2 className="text-xl font-bold text-navy">Your Information</h2>

          <div className="mt-4 space-y-6">
            <div>
              <label htmlFor="fullName" className={labelClasses}>
                Full Name <span className="text-red">*</span>
              </label>
              <input
                id="fullName"
                type="text"
                value={form.fullName}
                onChange={(e) => updateForm("fullName", e.target.value)}
                className={`${inputClasses} ${errors.fullName ? errorInputClasses : ""}`}
              />
              {fieldError(errors.fullName)}
            </div>

            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label htmlFor="email" className={labelClasses}>
                  Email <span className="text-red">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  value={form.email}
                  onChange={(e) => updateForm("email", e.target.value)}
                  className={`${inputClasses} ${errors.email ? errorInputClasses : ""}`}
                />
                {fieldError(errors.email)}
              </div>
              <div>
                <label htmlFor="phone" className={labelClasses}>
                  Phone <span className="text-red">*</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateForm("phone", e.target.value)}
                  className={`${inputClasses} ${errors.phone ? errorInputClasses : ""}`}
                />
                {fieldError(errors.phone)}
              </div>
            </div>

            <div>
              <label htmlFor="company" className={labelClasses}>
                Company Name
              </label>
              <input
                id="company"
                type="text"
                value={form.company}
                onChange={(e) => updateForm("company", e.target.value)}
                className={inputClasses}
              />
            </div>
          </div>
        </section>

        {/* Shipping Address */}
        <section>
          <h2 className="text-xl font-bold text-navy">Shipping Address</h2>

          <div className="mt-4 space-y-6">
            {/* ZIP first so the live rate fetches before address completion */}
            <div>
              <label htmlFor="zip" className={labelClasses}>
                ZIP Code <span className="text-red">*</span>
              </label>
              <input
                id="zip"
                type="text"
                inputMode="numeric"
                autoComplete="postal-code"
                value={form.zip}
                onChange={(e) => updateForm("zip", e.target.value)}
                onBlur={() => {
                  if (
                    shippingMethod === "klein_calculated" &&
                    form.zip.length >= 5 &&
                    subtotalCents >= MIN_SUBTOTAL_CENTS
                  ) {
                    fetchShippingRate();
                  }
                }}
                className={`${inputClasses} sm:max-w-[200px] ${errors.zip ? errorInputClasses : ""}`}
              />
              {fieldError(errors.zip)}
              <p className="mt-1 text-xs text-steel">
                Used to calculate live shipping rate.
              </p>
            </div>

            <div>
              <label htmlFor="address1" className={labelClasses}>
                Address Line 1 <span className="text-red">*</span>
              </label>
              <input
                id="address1"
                type="text"
                autoComplete="address-line1"
                value={form.address1}
                onChange={(e) => updateForm("address1", e.target.value)}
                className={`${inputClasses} ${errors.address1 ? errorInputClasses : ""}`}
              />
              {fieldError(errors.address1)}
            </div>

            <div>
              <label htmlFor="address2" className={labelClasses}>
                Address Line 2
              </label>
              <input
                id="address2"
                type="text"
                autoComplete="address-line2"
                value={form.address2}
                onChange={(e) => updateForm("address2", e.target.value)}
                className={inputClasses}
              />
            </div>

            <div className="grid gap-6 sm:grid-cols-[1fr_180px]">
              <div>
                <label htmlFor="city" className={labelClasses}>
                  City <span className="text-red">*</span>
                </label>
                <input
                  id="city"
                  type="text"
                  autoComplete="address-level2"
                  value={form.city}
                  onChange={(e) => updateForm("city", e.target.value)}
                  className={`${inputClasses} ${errors.city ? errorInputClasses : ""}`}
                />
                {fieldError(errors.city)}
              </div>
              <div>
                <label htmlFor="state" className={labelClasses}>
                  State <span className="text-red">*</span>
                </label>
                <select
                  id="state"
                  value={form.state}
                  onChange={(e) => updateForm("state", e.target.value)}
                  className={`${inputClasses} ${errors.state ? errorInputClasses : ""}`}
                >
                  <option value="">Select…</option>
                  {US_STATES.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.code}
                    </option>
                  ))}
                </select>
                {fieldError(errors.state)}
              </div>
            </div>
          </div>
        </section>

        {/* Shipping Method */}
        <section>
          <h2 className="text-xl font-bold text-navy">Shipping Method</h2>

          <div className="mt-4 space-y-3">
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition ${
                shippingMethod === "klein_calculated"
                  ? "border-navy bg-navy/5"
                  : "border-navy/20 bg-white hover:border-navy/40"
              }`}
            >
              <input
                type="radio"
                name="shippingMethod"
                value="klein_calculated"
                checked={shippingMethod === "klein_calculated"}
                onChange={() => setShippingMethod("klein_calculated")}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="font-semibold text-navy">
                  Ship via Klein UPS account
                </p>
                <p className="text-sm text-steel">
                  We&apos;ll bill you UPS Ground at our negotiated live rate.
                </p>
                {shippingMethod === "klein_calculated" && (
                  <div className="mt-2 text-sm">
                    {shippingLoading && (
                      <span className="inline-flex items-center gap-2 text-steel">
                        <svg
                          className="h-4 w-4 animate-spin"
                          viewBox="0 0 24 24"
                          fill="none"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        Fetching live rate…
                      </span>
                    )}
                    {!shippingLoading && shippingCents !== null && (
                      <span className="font-semibold text-navy">
                        Live UPS Ground rate: {formatUSD(shippingCents)}
                      </span>
                    )}
                    {!shippingLoading && shippingCents === null && form.zip.length < 5 && (
                      <span className="text-steel">
                        Enter ZIP code above to see rate.
                      </span>
                    )}
                    {!shippingLoading && shippingCents === null && subtotalCents < MIN_SUBTOTAL_CENTS && form.zip.length >= 5 && (
                      <span className="text-steel">
                        Add items totaling at least $100 to see rate.
                      </span>
                    )}
                    {shippingError && (
                      <span className="block text-red">{shippingError}</span>
                    )}
                  </div>
                )}
              </div>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 transition ${
                shippingMethod === "collect"
                  ? "border-navy bg-navy/5"
                  : "border-navy/20 bg-white hover:border-navy/40"
              }`}
            >
              <input
                type="radio"
                name="shippingMethod"
                value="collect"
                checked={shippingMethod === "collect"}
                onChange={() => setShippingMethod("collect")}
                className="mt-1"
              />
              <div className="flex-1">
                <p className="font-semibold text-navy">
                  Ship collect on my carrier account
                </p>
                <p className="text-sm text-steel">
                  Bill freight directly to your UPS or FedEx account — no
                  shipping charge on this invoice.
                </p>

                {shippingMethod === "collect" && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <div>
                      <label htmlFor="carrier" className={labelClasses}>
                        Carrier <span className="text-red">*</span>
                      </label>
                      <select
                        id="carrier"
                        value={carrier}
                        onChange={(e) =>
                          setCarrier(e.target.value as "UPS" | "FedEx")
                        }
                        className={`${inputClasses} ${errors.carrier ? errorInputClasses : ""}`}
                      >
                        <option value="UPS">UPS</option>
                        <option value="FedEx">FedEx</option>
                      </select>
                      {fieldError(errors.carrier)}
                    </div>
                    <div>
                      <label
                        htmlFor="accountNumber"
                        className={labelClasses}
                      >
                        Account Number <span className="text-red">*</span>
                      </label>
                      <input
                        id="accountNumber"
                        type="text"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        className={`${inputClasses} ${errors.accountNumber ? errorInputClasses : ""}`}
                      />
                      {fieldError(errors.accountNumber)}
                    </div>
                  </div>
                )}
              </div>
            </label>
          </div>
          {fieldError(errors.shipping)}
        </section>
      </div>

      {/* ── RIGHT: order summary ── */}
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-lg border border-navy/20 bg-offwhite p-6 shadow-sm">
          <h2 className="text-lg font-bold text-navy">Order Summary</h2>

          <dl className="mt-4 space-y-2 text-sm text-charcoal">
            {qty6 > 0 && (
              <div className="flex justify-between">
                <dt>
                  6&quot; × {qty6} @ {formatUSD(unitPrice6)}
                  {unitPrice6 < PRICE_6_CENTS && (
                    <span className="ml-1 text-xs text-steel line-through">
                      {formatUSD(PRICE_6_CENTS)}
                    </span>
                  )}
                </dt>
                <dd>{formatUSD(qty6 * unitPrice6)}</dd>
              </div>
            )}
            {qty11 > 0 && (
              <div className="flex justify-between">
                <dt>
                  11&quot; × {qty11} @ {formatUSD(unitPrice11)}
                  {unitPrice11 < PRICE_11_CENTS && (
                    <span className="ml-1 text-xs text-steel line-through">
                      {formatUSD(PRICE_11_CENTS)}
                    </span>
                  )}
                </dt>
                <dd>{formatUSD(qty11 * unitPrice11)}</dd>
              </div>
            )}
            {qty6 === 0 && qty11 === 0 && (
              <p className="text-steel">No items selected.</p>
            )}

            <div className="border-t border-navy/10 pt-2" />

            {appliedDiscount &&
              (qty6 > 0 || qty11 > 0) &&
              listSubtotalCents > subtotalCents && (
                <div className="flex justify-between text-xs text-green-700">
                  <dt>Discount {appliedDiscount.code}</dt>
                  <dd>−{formatUSD(listSubtotalCents - subtotalCents)}</dd>
                </div>
              )}

            <div className="flex justify-between">
              <dt>Subtotal</dt>
              <dd>{formatUSD(subtotalCents)}</dd>
            </div>

            <div className="flex justify-between">
              <dt>
                {shippingMethod === "collect"
                  ? "Shipping (ship collect)"
                  : "Shipping (UPS Ground)"}
              </dt>
              <dd>
                {shippingMethod === "collect"
                  ? "$0.00"
                  : shippingLoading
                    ? "…"
                    : shippingCents !== null
                      ? formatUSD(shippingCents)
                      : "—"}
              </dd>
            </div>

            <div className="flex justify-between">
              <dt>Credit card processing fee (3.09%)</dt>
              <dd>{formatUSD(ccFeeCents)}</dd>
            </div>

            <div className="border-t border-navy/10 pt-3" />

            <div className="flex justify-between text-base font-bold text-navy">
              <dt>Order Total</dt>
              <dd>{formatUSD(totalCents)}</dd>
            </div>
          </dl>

          {submitError && (
            <div
              role="alert"
              className="mt-4 flex items-start gap-2 rounded-md border-2 border-red bg-red/10 px-4 py-3 text-sm font-semibold text-red shadow-sm"
            >
              <svg
                className="mt-0.5 h-5 w-5 flex-shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              <span>{submitError}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-md bg-red px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-red/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 disabled:opacity-60"
          >
            {submitting && (
              <svg
                className="h-5 w-5 animate-spin"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            )}
            {submitting ? "Redirecting to Stripe…" : "Proceed to Payment →"}
          </button>

          <p className="mt-3 text-center text-xs text-steel">
            Secure checkout powered by Stripe.
          </p>
        </div>
      </aside>
    </form>
  );
}

export default function OrderPage() {
  return (
    <>
      {/* ── PAGE HEADER ── */}
      <section className="bg-[#1C2E4A]">
        <div className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            Order Klein Scrapers
          </h1>
          <p className="mt-3 text-sm text-steel">
            Secure checkout powered by Stripe
          </p>
        </div>
      </section>

      {/* ── FORM ── */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <Suspense fallback={null}>
            <OrderForm />
          </Suspense>
        </div>
      </section>
    </>
  );
}
