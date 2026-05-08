"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const STATE_RE = /^[A-Z]{2}$/;

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return ten.length === 10 ? `+1${ten}` : "";
}

function SampleRequestForm() {
  const [form, setForm] = useState({
    name: "",
    company: "",
    job_title: "",
    email: "",
    phone: "",
    quantity_6inch: 1,
    quantity_11inch: 1,
    shipping_address_line1: "",
    shipping_address_line2: "",
    shipping_city: "",
    shipping_state: "",
    shipping_zip: "",
    notes: "",
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  function update(field: string, value: string | number) {
    setForm((f) => ({ ...f, [field]: value }));
    if (errors[field]) {
      setErrors((e) => {
        const next = { ...e };
        delete next[field];
        return next;
      });
    }
  }

  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};

    const name = form.name.trim();
    const email = form.email.trim();
    const phone = form.phone.trim();
    const line1 = form.shipping_address_line1.trim();
    const city = form.shipping_city.trim();
    const state = form.shipping_state.trim().toUpperCase();
    const zip = form.shipping_zip.trim();

    if (!name) errs.name = "Full name is required.";

    if (!email) errs.email = "Email is required.";
    else if (!EMAIL_RE.test(email)) errs.email = "Enter a valid email address.";

    if (!phone) {
      errs.phone = "Phone is required.";
    } else if (!normalizePhone(phone)) {
      errs.phone = "Enter a 10-digit US phone number.";
    }

    if (!line1) errs.shipping_address_line1 = "Street address is required.";
    if (!city) errs.shipping_city = "City is required.";

    if (!state) errs.shipping_state = "State is required.";
    else if (!STATE_RE.test(state)) errs.shipping_state = "Use the 2-letter state code (e.g. CA).";

    if (!zip) errs.shipping_zip = "ZIP is required.";
    else if (!ZIP_RE.test(zip)) errs.shipping_zip = "Use 12345 or 12345-6789.";

    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg("");

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      setStatus("idle");
      return;
    }
    setErrors({});
    setStatus("loading");

    const payload = {
      name: form.name.trim(),
      company: form.company.trim(),
      job_title: form.job_title.trim(),
      email: form.email.trim(),
      phone: normalizePhone(form.phone),
      quantity_6inch: form.quantity_6inch,
      quantity_11inch: form.quantity_11inch,
      shipping_address_line1: form.shipping_address_line1.trim(),
      shipping_address_line2: form.shipping_address_line2.trim(),
      shipping_city: form.shipping_city.trim(),
      shipping_state: form.shipping_state.trim().toUpperCase(),
      shipping_zip: form.shipping_zip.trim(),
      notes: form.notes.trim(),
    };

    try {
      const res = await fetch("/api/sample-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || data.error) {
        throw new Error(data.error || "Something went wrong. Please try again.");
      }

      setStatus("success");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Something went wrong.");
    }
  }

  // ── SUCCESS STATE ──
  if (status === "success") {
    return (
      <div className="mx-auto max-w-lg rounded-lg border border-navy/20 bg-white p-8 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
          </svg>
        </div>
        <h2 className="mt-6 text-2xl font-bold text-navy">
          Thanks, {form.name.split(" ")[0]}!
        </h2>
        <p className="mt-2 text-charcoal/70">
          Your request has been received.
        </p>
        <p className="mt-1 text-charcoal/70">
          We&apos;ll ship your scrapers within 1–2 business days.
        </p>

        {(form.quantity_6inch > 0 || form.quantity_11inch > 0) && (
          <div className="mt-6 inline-flex flex-col gap-1 rounded-md bg-offwhite px-6 py-3 text-sm text-charcoal">
            {form.quantity_6inch > 0 && (
              <span>{form.quantity_6inch} × 6&quot; Scraper{form.quantity_6inch > 1 ? "s" : ""}</span>
            )}
            {form.quantity_11inch > 0 && (
              <span>{form.quantity_11inch} × 11&quot; Scraper{form.quantity_11inch > 1 ? "s" : ""}</span>
            )}
          </div>
        )}

        <div className="mt-8">
          <Button href="/">Back to Home</Button>
        </div>
      </div>
    );
  }

  // ── FORM STATE ──
  const inputClass =
    "mt-1.5 w-full rounded-md border border-navy/20 px-4 py-2.5 text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20";
  const errorInputClass =
    "mt-1.5 w-full rounded-md border border-red/60 px-4 py-2.5 text-charcoal outline-none transition focus:border-red focus:ring-2 focus:ring-red/20";
  const fieldErrorClass = "mt-1 text-xs text-red";

  return (
    <form onSubmit={handleSubmit} noValidate className="mx-auto max-w-2xl space-y-6">
      {/* Name */}
      <div>
        <label htmlFor="name" className="block text-sm font-semibold text-navy">
          Full Name <span className="text-red">*</span>
        </label>
        <input
          id="name"
          type="text"
          required
          value={form.name}
          onChange={(e) => update("name", e.target.value)}
          className={errors.name ? errorInputClass : inputClass}
        />
        {errors.name && <p className={fieldErrorClass}>{errors.name}</p>}
      </div>

      {/* Company + Job Title row */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="company" className="block text-sm font-semibold text-navy">
            Company Name
          </label>
          <input
            id="company"
            type="text"
            value={form.company}
            onChange={(e) => update("company", e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="job_title" className="block text-sm font-semibold text-navy">
            Job Title
          </label>
          <input
            id="job_title"
            type="text"
            value={form.job_title}
            onChange={(e) => update("job_title", e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {/* Email + Phone row */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="email" className="block text-sm font-semibold text-navy">
            Email Address <span className="text-red">*</span>
          </label>
          <input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            className={errors.email ? errorInputClass : inputClass}
          />
          {errors.email && <p className={fieldErrorClass}>{errors.email}</p>}
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-semibold text-navy">
            Phone Number <span className="text-red">*</span>
          </label>
          <input
            id="phone"
            type="tel"
            required
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            className={errors.phone ? errorInputClass : inputClass}
          />
          {errors.phone && <p className={fieldErrorClass}>{errors.phone}</p>}
        </div>
      </div>

      {/* What you'll receive */}
      <div className="rounded-md border border-navy/20 bg-offwhite px-4 py-3">
        <p className="text-sm font-semibold text-navy">What you&apos;ll receive:</p>
        <ul className="mt-1.5 space-y-0.5 text-sm text-charcoal">
          <li>1 × 6&quot; Scraper</li>
          <li>1 × 11&quot; Scraper</li>
        </ul>
      </div>

      {/* Address Line 1 */}
      <div>
        <label htmlFor="shipping_address_line1" className="block text-sm font-semibold text-navy">
          Shipping Address — Line 1 <span className="text-red">*</span>
        </label>
        <input
          id="shipping_address_line1"
          type="text"
          required
          autoComplete="address-line1"
          value={form.shipping_address_line1}
          onChange={(e) => update("shipping_address_line1", e.target.value)}
          className={errors.shipping_address_line1 ? errorInputClass : inputClass}
        />
        {errors.shipping_address_line1 && (
          <p className={fieldErrorClass}>{errors.shipping_address_line1}</p>
        )}
      </div>

      {/* Address Line 2 */}
      <div>
        <label htmlFor="shipping_address_line2" className="block text-sm font-semibold text-navy">
          Address Line 2 <span className="text-steel">(optional)</span>
        </label>
        <input
          id="shipping_address_line2"
          type="text"
          autoComplete="address-line2"
          value={form.shipping_address_line2}
          onChange={(e) => update("shipping_address_line2", e.target.value)}
          className={inputClass}
        />
      </div>

      {/* City + State row */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="shipping_city" className="block text-sm font-semibold text-navy">
            City <span className="text-red">*</span>
          </label>
          <input
            id="shipping_city"
            type="text"
            required
            autoComplete="address-level2"
            value={form.shipping_city}
            onChange={(e) => update("shipping_city", e.target.value)}
            className={errors.shipping_city ? errorInputClass : inputClass}
          />
          {errors.shipping_city && <p className={fieldErrorClass}>{errors.shipping_city}</p>}
        </div>
        <div>
          <label htmlFor="shipping_state" className="block text-sm font-semibold text-navy">
            State <span className="text-red">*</span>
          </label>
          <input
            id="shipping_state"
            type="text"
            required
            maxLength={2}
            autoComplete="address-level1"
            placeholder="CA"
            value={form.shipping_state}
            onChange={(e) => update("shipping_state", e.target.value.toUpperCase())}
            className={errors.shipping_state ? errorInputClass : inputClass}
          />
          {errors.shipping_state && <p className={fieldErrorClass}>{errors.shipping_state}</p>}
        </div>
      </div>

      {/* ZIP */}
      <div>
        <label htmlFor="shipping_zip" className="block text-sm font-semibold text-navy">
          ZIP Code <span className="text-red">*</span>
        </label>
        <input
          id="shipping_zip"
          type="text"
          required
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={10}
          placeholder="95662"
          value={form.shipping_zip}
          onChange={(e) => update("shipping_zip", e.target.value)}
          className={`${errors.shipping_zip ? errorInputClass : inputClass} sm:max-w-xs`}
        />
        {errors.shipping_zip && <p className={fieldErrorClass}>{errors.shipping_zip}</p>}
      </div>

      {/* Notes */}
      <div>
        <label htmlFor="notes" className="block text-sm font-semibold text-navy">
          Notes / How do you plan to use them?
        </label>
        <textarea
          id="notes"
          rows={3}
          value={form.notes}
          onChange={(e) => update("notes", e.target.value)}
          className={inputClass}
        />
      </div>

      {/* Error message */}
      {status === "error" && (
        <div className="rounded-md border border-red/30 bg-red/5 px-4 py-3 text-sm text-red">
          {errorMsg}
        </div>
      )}

      {/* Submit */}
      <div>
        <button
          type="submit"
          disabled={status === "loading"}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-red px-7 py-3 text-lg font-semibold text-white transition-colors hover:bg-red/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {status === "loading" && (
            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {status === "loading" ? "Submitting..." : "Request Samples →"}
        </button>
        <p className="mt-3 text-xs text-steel">
          Your information is only used to fulfill your request.
        </p>
      </div>
    </form>
  );
}

export default function RequestSamplesPage() {
  return (
    <>
      {/* ── PAGE HEADER ── */}
      <section className="bg-[#1C2E4A]">
        <div className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            Request Free Samples
          </h1>
          <p className="mt-3 text-lg text-steel">
            Fill out the form and we&apos;ll ship within 1–2 business days. No
            commitment required.
          </p>
        </div>
      </section>

      {/* ── FORM ── */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <SampleRequestForm />
        </div>
      </section>
    </>
  );
}
