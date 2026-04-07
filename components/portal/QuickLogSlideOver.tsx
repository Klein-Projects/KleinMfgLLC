"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { Plus, X, Search } from "lucide-react";
import { quickLogActivity } from "@/app/portal/(authenticated)/leads/actions";
import { createClient } from "@/lib/supabase/client";

interface LeadOption {
  id: string;
  contactName: string;
  companyName: string;
}

const ACTIVITY_TYPES = [
  { value: "linkedin_message", label: "LinkedIn Message" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone Call" },
  { value: "note", label: "Note" },
  { value: "sample_sent", label: "Sample Sent" },
  { value: "follow_up", label: "Follow-Up" },
];

export default function QuickLogSlideOver() {
  const [open, setOpen] = useState(false);
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [search, setSearch] = useState("");
  const [selectedLead, setSelectedLead] = useState<string>("");
  const [type, setType] = useState("linkedin_message");
  const [summary, setSummary] = useState("");
  const [toast, setToast] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch leads when panel opens
  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    supabase
      .from("leads")
      .select(
        "id, contact:contacts(first_name, last_name), company:companies(name)"
      )
      .not("status", "in", "(won,lost)")
      .order("last_activity_at", { ascending: false })
      .then(({ data }) => {
        if (data) {
          setLeads(
            data.map((l: any) => ({
              id: l.id,
              contactName: l.contact
                ? `${l.contact.first_name} ${l.contact.last_name}`
                : "Unknown",
              companyName: l.company?.name ?? "",
            }))
          );
        }
      });
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  const filtered = leads.filter((l) => {
    const q = search.toLowerCase();
    return (
      l.contactName.toLowerCase().includes(q) ||
      l.companyName.toLowerCase().includes(q)
    );
  });

  const selectedLeadObj = leads.find((l) => l.id === selectedLead);

  function handleSubmit() {
    if (!selectedLead || !summary.trim()) return;
    startTransition(async () => {
      await quickLogActivity(selectedLead, type, summary);
      // Reset form
      setSelectedLead("");
      setSearch("");
      setSummary("");
      setType("linkedin_message");
      setOpen(false);
      // Show toast
      setToast(true);
      setTimeout(() => setToast(false), 3000);
    });
  }

  return (
    <>
      {/* Floating + button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-red text-white shadow-lg transition-transform hover:scale-105 active:scale-95"
        aria-label="Quick log activity"
      >
        <Plus className="h-7 w-7" strokeWidth={2.5} />
      </button>

      {/* Success toast */}
      {toast && (
        <div className="fixed bottom-24 right-6 z-50 rounded-lg bg-green-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg">
          Activity logged
        </div>
      )}

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Slide-over panel */}
      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-md transform bg-white shadow-xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-navy/10 px-6 py-4">
          <h2 className="text-lg font-semibold text-navy">
            Quick Log Activity
          </h2>
          <button
            onClick={() => setOpen(false)}
            className="text-steel hover:text-navy"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 overflow-y-auto p-6">
          {/* Lead selector */}
          <div ref={dropdownRef}>
            <label className="block text-xs font-medium text-charcoal/60">
              Lead *
            </label>
            <div className="relative mt-1">
              <div
                className="flex w-full cursor-pointer items-center rounded-md border border-navy/20 bg-white px-3 py-2 text-sm"
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                <Search className="mr-2 h-3.5 w-3.5 text-steel" />
                {selectedLeadObj ? (
                  <span className="text-charcoal">
                    {selectedLeadObj.contactName}
                    {selectedLeadObj.companyName &&
                      ` — ${selectedLeadObj.companyName}`}
                  </span>
                ) : (
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setDropdownOpen(true);
                    }}
                    onFocus={() => setDropdownOpen(true)}
                    placeholder="Search by name or company…"
                    className="w-full bg-transparent text-charcoal outline-none placeholder:text-steel"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
                {selectedLeadObj && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedLead("");
                      setSearch("");
                    }}
                    className="ml-auto text-steel hover:text-navy"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {dropdownOpen && !selectedLeadObj && (
                <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-navy/10 bg-white shadow-lg">
                  {filtered.length === 0 ? (
                    <li className="px-3 py-2 text-sm text-steel">
                      No leads found
                    </li>
                  ) : (
                    filtered.map((lead) => (
                      <li
                        key={lead.id}
                        onClick={() => {
                          setSelectedLead(lead.id);
                          setDropdownOpen(false);
                          setSearch("");
                        }}
                        className="cursor-pointer px-3 py-2 text-sm text-charcoal hover:bg-navy/5"
                      >
                        <span className="font-medium">{lead.contactName}</span>
                        {lead.companyName && (
                          <span className="ml-1 text-steel">
                            — {lead.companyName}
                          </span>
                        )}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
          </div>

          {/* Activity type */}
          <div>
            <label className="block text-xs font-medium text-charcoal/60">
              Activity Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
            >
              {ACTIVITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Summary */}
          <div>
            <label className="block text-xs font-medium text-charcoal/60">
              Summary *
            </label>
            <textarea
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              rows={4}
              placeholder="What happened?"
              className="mt-1 w-full rounded-md border border-navy/20 bg-white px-3 py-2 text-sm text-charcoal focus:border-navy focus:outline-none focus:ring-1 focus:ring-navy"
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={isPending || !selectedLead || !summary.trim()}
            className="w-full rounded-md bg-navy px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy/90 disabled:opacity-50"
          >
            {isPending ? "Saving…" : "Log Activity"}
          </button>
        </div>
      </div>
    </>
  );
}
