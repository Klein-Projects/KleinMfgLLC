"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { createLead } from "../actions";

const INDUSTRY_OPTIONS = [
  { value: "", label: "Select industry…" },
  { value: "airline", label: "Airline" },
  { value: "MRO", label: "MRO" },
  { value: "defense", label: "Defense" },
  { value: "cargo", label: "Cargo" },
  { value: "other", label: "Other" },
];

interface CompanyOption {
  id: string;
  name: string;
}

export default function NewLeadPage() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [companies, setCompanies] = useState<CompanyOption[]>([]);
  const [companyMode, setCompanyMode] = useState<"existing" | "new">(
    "existing"
  );
  const [companySearch, setCompanySearch] = useState("");

  useEffect(() => {
    async function fetchCompanies() {
      const supabase = createClient();
      const { data } = await supabase
        .from("companies")
        .select("id, name")
        .order("name");
      setCompanies((data as CompanyOption[]) ?? []);
    }
    fetchCompanies();
  }, []);

  const filteredCompanies = companies.filter((c) =>
    c.name.toLowerCase().includes(companySearch.toLowerCase())
  );

  function handleSubmit(formData: FormData) {
    setError(null);

    const firstName = formData.get("first_name") as string;
    const lastName = formData.get("last_name") as string;
    if (!firstName?.trim() || !lastName?.trim()) {
      setError("First and last name are required.");
      return;
    }

    startTransition(async () => {
      try {
        await createLead(formData);
      } catch (e: any) {
        setError(e.message ?? "Failed to create lead.");
      }
    });
  }

  return (
    <div className="p-6 lg:p-8">
      <Link
        href="/portal/leads"
        className="text-xs text-steel hover:text-navy"
      >
        &larr; Back to Leads
      </Link>
      <h1 className="mt-2 text-2xl font-bold text-navy">Add New Lead</h1>

      {error && (
        <div className="mt-4 rounded-md border border-red/20 bg-red/5 px-4 py-3 text-sm text-red">
          {error}
        </div>
      )}

      <form action={handleSubmit} className="mt-6 max-w-2xl space-y-8">
        {/* ── Section 1: Contact Info ── */}
        <div className="rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">
            Contact Info
          </h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                First Name *
              </label>
              <input
                type="text"
                name="first_name"
                required
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                Last Name *
              </label>
              <input
                type="text"
                name="last_name"
                required
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                Title
              </label>
              <input
                type="text"
                name="title"
                placeholder="e.g., Director of Maintenance"
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                Email
              </label>
              <input
                type="email"
                name="email"
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                Phone
              </label>
              <input
                type="tel"
                name="phone"
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                LinkedIn URL
              </label>
              <input
                type="url"
                name="linkedin_url"
                placeholder="https://linkedin.com/in/…"
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>
          </div>
        </div>

        {/* ── Section 2: Company ── */}
        <div className="rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">
            Company
          </h2>

          <div className="mt-4 flex gap-4">
            <button
              type="button"
              onClick={() => setCompanyMode("existing")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                companyMode === "existing"
                  ? "bg-navy text-white"
                  : "bg-navy/10 text-navy hover:bg-navy/20"
              }`}
            >
              Existing Company
            </button>
            <button
              type="button"
              onClick={() => setCompanyMode("new")}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                companyMode === "new"
                  ? "bg-navy text-white"
                  : "bg-navy/10 text-navy hover:bg-navy/20"
              }`}
            >
              Create New
            </button>
          </div>

          {companyMode === "existing" ? (
            <div className="mt-4">
              <label className="block text-xs font-medium text-charcoal/60">
                Search Companies
              </label>
              <input
                type="text"
                value={companySearch}
                onChange={(e) => setCompanySearch(e.target.value)}
                placeholder="Type to search…"
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
              <select
                name="existing_company_id"
                size={Math.min(filteredCompanies.length + 1, 6)}
                className="mt-2 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              >
                <option value="">No company</option>
                {filteredCompanies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-charcoal/60">
                  Company Name
                </label>
                <input
                  type="text"
                  name="new_company_name"
                  className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-charcoal/60">
                  Industry
                </label>
                <select
                  name="new_company_industry"
                  className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                >
                  {INDUSTRY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-charcoal/60">
                  Website
                </label>
                <input
                  type="url"
                  name="new_company_website"
                  placeholder="https://…"
                  className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Section 3: Lead Details ── */}
        <div className="rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-steel">
            Lead Details
          </h2>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                Status
              </label>
              <select
                name="status"
                defaultValue="new"
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              >
                <option value="new">New</option>
                <option value="contacted">Contacted</option>
                <option value="engaged">Engaged</option>
                <option value="sample_sent">Sample Sent</option>
                <option value="quoted">Quoted</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                Source
              </label>
              <select
                name="source"
                defaultValue="linkedin"
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              >
                <option value="linkedin">LinkedIn</option>
                <option value="website">Website</option>
                <option value="referral">Referral</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-charcoal/60">
                Follow-Up Date
              </label>
              <input
                type="date"
                name="follow_up_date"
                className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
              />
            </div>
          </div>

          <div className="mt-4">
            <label className="block text-xs font-medium text-charcoal/60">
              Notes
            </label>
            <textarea
              name="notes"
              rows={3}
              placeholder="Initial notes about this lead…"
              className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-red px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red/90 disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create Lead"}
          </button>
          <Link
            href="/portal/leads"
            className="text-sm text-steel hover:text-navy"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
