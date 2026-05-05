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

  function updateForm(field: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  const subtotalCents = qty6 * PRICE_6_CENTS + qty11 * PRICE_11_CENTS;
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
    if (subtotalCents < MIN_SUBTOTAL_CENTS) return;

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
  }, [shippingMethod, form.zip, qty6, qty11, subtotalCents]);

  // Re-fetch when qty changes (if Klein UPS and zip valid)
  useEffect(() => {
    if (
      shippingMethod === "klein_calculated" &&
      form.zip.length >= 5 &&
      subtotalCents >= MIN_SUBTOTAL_CENTS
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

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (subtotalCents < MIN_SUBTOTAL_CENTS) {
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
      setSubmitError(
        errs.qty || "Please fix the errors above before continuing."
      );
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
                  6&quot; × {qty6} @ $21.00
                </dt>
                <dd>{formatUSD(qty6 * PRICE_6_CENTS)}</dd>
              </div>
            )}
            {qty11 > 0 && (
              <div className="flex justify-between">
                <dt>
                  11&quot; × {qty11} @ $23.00
                </dt>
                <dd>{formatUSD(qty11 * PRICE_11_CENTS)}</dd>
              </div>
            )}
            {qty6 === 0 && qty11 === 0 && (
              <p className="text-steel">No items selected.</p>
            )}

            <div className="border-t border-navy/10 pt-2" />

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
            <div className="mt-4 rounded-md border border-red/30 bg-red/5 px-3 py-2 text-sm text-red">
              {submitError}
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
