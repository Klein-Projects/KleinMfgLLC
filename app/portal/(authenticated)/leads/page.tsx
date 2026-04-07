"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Plus, Search } from "lucide-react";

const STATUS_OPTIONS = [
  "all",
  "new",
  "contacted",
  "engaged",
  "sample_sent",
  "quoted",
  "won",
  "lost",
  "nurture",
] as const;

const SOURCE_OPTIONS = ["all", "linkedin", "website", "referral", "other"] as const;

const statusColors: Record<string, string> = {
  new: "bg-gray-100 text-gray-800",
  contacted: "bg-blue-100 text-blue-800",
  engaged: "bg-teal-100 text-teal-800",
  sample_sent: "bg-orange-100 text-orange-800",
  quoted: "bg-purple-100 text-purple-800",
  won: "bg-green-100 text-green-800",
  lost: "bg-red-100 text-red-800",
  nurture: "bg-yellow-100 text-yellow-800",
};

const statusLabels: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  engaged: "Engaged",
  sample_sent: "Sample Sent",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
  nurture: "Nurture",
};

interface LeadRow {
  id: string;
  status: string;
  source: string;
  follow_up_date: string | null;
  last_activity_at: string;
  contact: { first_name: string; last_name: string } | null;
  company: { name: string } | null;
}

export default function LeadsListPage() {
  const searchParams = useSearchParams();
  const initialStatus = searchParams.get("status") ?? "all";

  const [leads, setLeads] = useState<LeadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState(initialStatus);
  const [sourceFilter, setSourceFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    async function fetchLeads() {
      const supabase = createClient();
      const { data } = await supabase
        .from("leads")
        .select(
          "id, status, source, follow_up_date, last_activity_at, contact:contacts(first_name, last_name), company:companies(name)"
        )
        .order("last_activity_at", { ascending: false });
      setLeads((data as any[]) ?? []);
      setLoading(false);
    }
    fetchLeads();
  }, []);

  const todayISO = new Date().toISOString().split("T")[0];

  const filtered = useMemo(() => {
    return leads.filter((lead) => {
      if (statusFilter !== "all" && lead.status !== statusFilter) return false;
      if (sourceFilter !== "all" && lead.source !== sourceFilter) return false;
      if (overdueOnly) {
        if (!lead.follow_up_date || lead.follow_up_date > todayISO) return false;
      }
      if (search) {
        const q = search.toLowerCase();
        const contactName = lead.contact
          ? `${lead.contact.first_name} ${lead.contact.last_name}`.toLowerCase()
          : "";
        const companyName = lead.company?.name?.toLowerCase() ?? "";
        if (!contactName.includes(q) && !companyName.includes(q)) return false;
      }
      return true;
    });
  }, [leads, statusFilter, sourceFilter, overdueOnly, search, todayISO]);

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function relativeDate(dateStr: string): string {
    const now = new Date();
    const date = new Date(dateStr);
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return formatDate(dateStr);
  }

  return (
    <div className="p-6 lg:p-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-navy">Leads</h1>
        <Link
          href="/portal/leads/new"
          className="inline-flex items-center gap-2 rounded-md bg-red px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red/90"
        >
          <Plus className="h-4 w-4" />
          Add Lead
        </Link>
      </div>

      {/* Filter Bar */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel" />
          <input
            type="text"
            placeholder="Search name or company…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded-md border border-navy/20 bg-white py-2 pl-9 pr-3 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
          />
        </div>

        {/* Status */}
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "all" ? "All Statuses" : statusLabels[s]}
            </option>
          ))}
        </select>

        {/* Source */}
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value)}
          className="rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
        >
          {SOURCE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === "all"
                ? "All Sources"
                : s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        {/* Overdue toggle */}
        <label className="flex items-center gap-2 text-sm text-charcoal">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
            className="rounded border-navy/30"
          />
          Show overdue only
        </label>
      </div>

      {/* Table */}
      <div className="mt-6 overflow-x-auto rounded-lg border border-navy/10 bg-white shadow-sm">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-navy border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-steel">
            No leads found.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy/10 text-left text-xs uppercase text-steel">
                <th className="px-4 py-3 font-medium">Contact</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Source</th>
                <th className="px-4 py-3 font-medium">Follow-Up</th>
                <th className="px-4 py-3 font-medium">Last Activity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-navy/5">
              {filtered.map((lead) => {
                const contactName = lead.contact
                  ? `${lead.contact.first_name} ${lead.contact.last_name}`
                  : "—";
                const companyName = lead.company?.name ?? "—";
                const isOverdue =
                  lead.follow_up_date && lead.follow_up_date <= todayISO;

                return (
                  <tr
                    key={lead.id}
                    className="cursor-pointer transition-colors hover:bg-offwhite"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/portal/leads/${lead.id}`}
                        className="font-medium text-navy hover:underline"
                      >
                        {contactName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-charcoal/70">
                      {companyName}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          statusColors[lead.status] ?? "bg-gray-100 text-gray-800"
                        }`}
                      >
                        {statusLabels[lead.status] ?? lead.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 capitalize text-charcoal/70">
                      {lead.source}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          isOverdue ? "font-semibold text-red" : "text-charcoal/70"
                        }
                      >
                        {lead.follow_up_date
                          ? formatDate(lead.follow_up_date)
                          : "—"}
                      </span>
                      {isOverdue && (
                        <span className="ml-1 text-xs text-red">Overdue</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-charcoal/70">
                      {relativeDate(lead.last_activity_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p className="mt-3 text-xs text-steel">
        {filtered.length} lead{filtered.length !== 1 ? "s" : ""}
      </p>
    </div>
  );
}
