"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Button from "@/components/ui/Button";

function SampleRequestForm() {
  const searchParams = useSearchParams();

  const [form, setForm] = useState({
    name: "",
    company: "",
    job_title: "",
    email: "",
    phone: "",
    quantity_6inch: 0,
    quantity_11inch: 0,
    shipping_address: "",
    notes: "",
  });

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Pre-fill quantity from URL param
  useEffect(() => {
    const product = searchParams.get("product");
    if (product === "6inch") {
      setForm((f) => ({ ...f, quantity_6inch: 1 }));
    } else if (product === "11inch") {
      setForm((f) => ({ ...f, quantity_11inch: 1 }));
    }
  }, [searchParams]);

  function update(field: string, value: string | number) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setErrorMsg("");

    try {
      const res = await fetch("/api/sample-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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
  return (
    <form onSubmit={handleSubmit} className="mx-auto max-w-2xl space-y-6">
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
          className="mt-1.5 w-full rounded-md border border-navy/20 px-4 py-2.5 text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20"
        />
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
            className="mt-1.5 w-full rounded-md border border-navy/20 px-4 py-2.5 text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20"
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
            className="mt-1.5 w-full rounded-md border border-navy/20 px-4 py-2.5 text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20"
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
            className="mt-1.5 w-full rounded-md border border-navy/20 px-4 py-2.5 text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20"
          />
        </div>
        <div>
          <label htmlFor="phone" className="block text-sm font-semibold text-navy">
            Phone Number
          </label>
          <input
            id="phone"
            type="tel"
            value={form.phone}
            onChange={(e) => update("phone", e.target.value)}
            className="mt-1.5 w-full rounded-md border border-navy/20 px-4 py-2.5 text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20"
          />
        </div>
      </div>

      {/* Quantities row */}
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <label htmlFor="quantity_6inch" className="block text-sm font-semibold text-navy">
            Quantity: 6&quot; Scrapers
          </label>
          <input
            id="quantity_6inch"
            type="number"
            min={0}
            value={form.quantity_6inch}
            onChange={(e) => update("quantity_6inch", parseInt(e.target.value) || 0)}
            className="mt-1.5 w-full rounded-md border border-navy/20 px-4 py-2.5 text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20"
          />
        </div>
        <div>
          <label htmlFor="quantity_11inch" className="block text-sm font-semibold text-navy">
            Quantity: 11&quot; Scrapers
          </label>
          <input
            id="quantity_11inch"
            type="number"
            min={0}
            value={form.quantity_11inch}
            onChange={(e) => update("quantity_11inch", parseInt(e.target.value) || 0)}
            className="mt-1.5 w-full rounded-md border border-navy/20 px-4 py-2.5 text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20"
          />
        </div>
      </div>

      {/* Shipping Address */}
      <div>
        <label htmlFor="shipping_address" className="block text-sm font-semibold text-navy">
          Shipping Address
        </label>
        <textarea
          id="shipping_address"
          rows={3}
          value={form.shipping_address}
          onChange={(e) => update("shipping_address", e.target.value)}
          className="mt-1.5 w-full rounded-md border border-navy/20 px-4 py-2.5 text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20"
        />
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
          className="mt-1.5 w-full rounded-md border border-navy/20 px-4 py-2.5 text-charcoal outline-none transition focus:border-navy focus:ring-2 focus:ring-navy/20"
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
          <Suspense fallback={null}>
            <SampleRequestForm />
          </Suspense>
        </div>
      </section>
    </>
  );
}
