"use client";

import { useTransition } from "react";
import Link from "next/link";
import { CheckCircle, Clock, AlarmClock, Phone } from "lucide-react";
import { snoozeFollowUp, markContacted } from "@/app/portal/(authenticated)/leads/actions";

const stageLabels: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  engaged: "Engaged",
  sample_sent: "Sample Sent",
  quoted: "Quoted",
  won: "Won",
  lost: "Lost",
  nurture: "Nurture",
};

interface FollowUpLead {
  id: string;
  status: string;
  follow_up_date: string;
  contact: { first_name: string; last_name: string } | null;
  company: { name: string } | null;
}

function classifyFollowUp(dateStr: string): {
  label: string;
  badge: string | null;
  rowClass: string;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  const diffDays = Math.round((date.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) {
    return {
      label: "Overdue",
      badge: "OVERDUE",
      rowClass: "bg-red-50 border-l-4 border-l-red",
    };
  }
  if (diffDays === 0) {
    return {
      label: "Today",
      badge: "TODAY",
      rowClass: "bg-orange-50 border-l-4 border-l-orange-400",
    };
  }
  // 1-3 days
  return {
    label: `In ${diffDays}d`,
    badge: null,
    rowClass: "bg-yellow-50 border-l-4 border-l-yellow-400",
  };
}

function FollowUpRow({ lead }: { lead: FollowUpLead }) {
  const [isPending, startTransition] = useTransition();

  const contactName = lead.contact
    ? `${lead.contact.first_name} ${lead.contact.last_name}`
    : "Unknown";
  const companyName = lead.company?.name ?? "";
  const info = classifyFollowUp(lead.follow_up_date);

  return (
    <div className={`rounded-md px-3 py-2.5 ${info.rowClass}`}>
      <div className="flex items-center justify-between gap-2">
        <Link
          href={`/portal/leads/${lead.id}`}
          className="group min-w-0 flex-1"
        >
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-navy group-hover:underline">
              {contactName}
            </p>
            {info.badge && (
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                  info.badge === "OVERDUE" ? "bg-red" : "bg-orange-500"
                }`}
              >
                {info.badge}
              </span>
            )}
          </div>
          {companyName && (
            <p className="truncate text-xs text-steel">{companyName}</p>
          )}
        </Link>

        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded bg-navy/10 px-1.5 py-0.5 text-[10px] font-medium text-navy">
            {stageLabels[lead.status] ?? lead.status}
          </span>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => startTransition(() => snoozeFollowUp(lead.id))}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded bg-white/80 px-2 py-1 text-[11px] font-medium text-charcoal/70 shadow-sm transition-colors hover:bg-white hover:text-navy disabled:opacity-50"
        >
          <Clock className="h-3 w-3" />
          Snooze 3 days
        </button>
        <button
          onClick={() => startTransition(() => markContacted(lead.id))}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded bg-white/80 px-2 py-1 text-[11px] font-medium text-charcoal/70 shadow-sm transition-colors hover:bg-white hover:text-navy disabled:opacity-50"
        >
          <Phone className="h-3 w-3" />
          Mark Contacted
        </button>
      </div>
    </div>
  );
}

export default function FollowUpPanel({
  leads,
}: {
  leads: FollowUpLead[];
}) {
  if (leads.length === 0) {
    return (
      <div className="mt-8 flex flex-col items-center gap-2 text-center">
        <CheckCircle className="h-8 w-8 text-green-500" />
        <p className="text-sm font-medium text-green-700">All caught up!</p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-2">
      {leads.map((lead) => (
        <FollowUpRow key={lead.id} lead={lead} />
      ))}
    </div>
  );
}
