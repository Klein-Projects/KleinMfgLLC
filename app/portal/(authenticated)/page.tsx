import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  Users,
  Bell,
  Send,
  Trophy,
  CheckCircle,
} from "lucide-react";

// ── Helpers ──

const PIPELINE_STAGES = [
  "new",
  "contacted",
  "engaged",
  "sample_sent",
  "quoted",
  "won",
  "lost",
  "nurture",
] as const;

const stageColors: Record<string, string> = {
  new: "bg-navy",
  contacted: "bg-navy",
  engaged: "bg-navy",
  sample_sent: "bg-navy",
  quoted: "bg-navy",
  won: "bg-red",
  lost: "bg-steel",
  nurture: "bg-navy/60",
};

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

const typeBadgeColors: Record<string, string> = {
  linkedin_message: "bg-blue-100 text-blue-800",
  email: "bg-teal-100 text-teal-800",
  phone: "bg-green-100 text-green-800",
  note: "bg-gray-100 text-gray-800",
  sample_sent: "bg-orange-100 text-orange-800",
  follow_up: "bg-purple-100 text-purple-800",
};

const typeLabels: Record<string, string> = {
  linkedin_message: "LinkedIn",
  email: "Email",
  phone: "Phone",
  note: "Note",
  sample_sent: "Sample Sent",
  follow_up: "Follow-Up",
};

function relativeDate(dateStr: string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function followUpLabel(dateStr: string): {
  text: string;
  color: string;
} {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const date = new Date(dateStr);
  date.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (date.getTime() - today.getTime()) / 86400000
  );

  if (diffDays < 0) return { text: "Overdue", color: "text-red" };
  if (diffDays === 0) return { text: "Today", color: "text-orange-600" };
  if (diffDays === 1) return { text: "Tomorrow", color: "text-navy" };
  return {
    text: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    color: "text-charcoal",
  };
}

// ── Page ──

export default async function PortalDashboard() {
  const supabase = createClient();

  const todayISO = new Date().toISOString().split("T")[0];
  const threeDaysOut = new Date(
    Date.now() + 3 * 86400000
  )
    .toISOString()
    .split("T")[0];
  const yearStart = new Date(
    new Date().getFullYear(),
    0,
    1
  ).toISOString();
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 86400000
  ).toISOString();

  // Fetch all data in parallel
  const [
    activeLeadsRes,
    followUpsDueRes,
    samplesSentRes,
    winsRes,
    allLeadsRes,
    followUpListRes,
    recentActivityRes,
  ] = await Promise.all([
    // Active leads count
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(won,lost)"),

    // Follow-ups due count
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .lte("follow_up_date", todayISO)
      .not("status", "in", "(won,lost)"),

    // Samples sent (30 days)
    supabase
      .from("activities")
      .select("id", { count: "exact", head: true })
      .eq("type", "sample_sent")
      .gte("created_at", thirtyDaysAgo),

    // Wins this year
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "won")
      .gte("created_at", yearStart),

    // All leads for pipeline
    supabase.from("leads").select("status"),

    // Follow-up list (next 3 days)
    supabase
      .from("leads")
      .select(
        "id, status, follow_up_date, contact:contacts(first_name, last_name), company:companies(name)"
      )
      .lte("follow_up_date", threeDaysOut)
      .not("status", "in", "(won,lost)")
      .order("follow_up_date", { ascending: true })
      .limit(8),

    // Recent activity
    supabase
      .from("activities")
      .select(
        "id, type, summary, created_at, lead_id, lead:leads(contact:contacts(first_name, last_name), company:companies(name))"
      )
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const activeLeads = activeLeadsRes.count ?? 0;
  const followUpsDue = followUpsDueRes.count ?? 0;
  const samplesSent = samplesSentRes.count ?? 0;
  const winsThisYear = winsRes.count ?? 0;

  // Pipeline counts
  const pipelineCounts: Record<string, number> = {};
  for (const stage of PIPELINE_STAGES) pipelineCounts[stage] = 0;
  if (allLeadsRes.data) {
    for (const lead of allLeadsRes.data) {
      pipelineCounts[lead.status] = (pipelineCounts[lead.status] || 0) + 1;
    }
  }
  const maxPipelineCount = Math.max(...Object.values(pipelineCounts), 1);

  const followUpList = (followUpListRes.data ?? []) as any[];
  const recentActivity = (recentActivityRes.data ?? []) as any[];

  const statCards = [
    {
      label: "Active Leads",
      value: activeLeads,
      icon: Users,
      alert: false,
    },
    {
      label: "Follow-Ups Due",
      value: followUpsDue,
      icon: Bell,
      alert: followUpsDue > 0,
    },
    {
      label: "Samples Sent (30d)",
      value: samplesSent,
      icon: Send,
      alert: false,
    },
    {
      label: "Wins This Year",
      value: winsThisYear,
      icon: Trophy,
      alert: false,
    },
  ];

  return (
    <div className="p-6 lg:p-8">
      {/* Page title */}
      <h1 className="text-2xl font-bold text-navy">Dashboard</h1>

      {/* ── STAT CARDS ── */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="rounded-lg border border-navy/10 bg-white p-5 shadow-sm"
          >
            <div className="flex items-center justify-between">
              <card.icon className="h-5 w-5 text-steel" strokeWidth={1.5} />
              {card.alert && (
                <span className="rounded-full bg-red px-2 py-0.5 text-xs font-semibold text-white">
                  {card.value}
                </span>
              )}
            </div>
            <p className="mt-3 text-3xl font-bold text-navy">{card.value}</p>
            <p className="mt-1 text-sm text-charcoal/60">{card.label}</p>
          </div>
        ))}
      </div>

      {/* ── MIDDLE ROW: Pipeline + Follow-Ups ── */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[3fr_2fr]">
        {/* Pipeline by Stage */}
        <div className="rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-navy">
            Pipeline by Stage
          </h2>
          <div className="mt-5 space-y-3">
            {PIPELINE_STAGES.map((stage) => {
              const count = pipelineCounts[stage];
              const widthPct = Math.max(
                (count / maxPipelineCount) * 100,
                count > 0 ? 8 : 0
              );
              return (
                <Link
                  key={stage}
                  href={`/portal/leads?status=${stage}`}
                  className="group flex items-center gap-3"
                >
                  <span className="w-24 text-right text-sm text-charcoal/70 group-hover:text-navy">
                    {stageLabels[stage]}
                  </span>
                  <div className="flex-1">
                    <div
                      className={`${stageColors[stage]} h-6 rounded transition-all group-hover:opacity-80`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm font-semibold text-navy">
                    {count}
                  </span>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Follow-Ups Due */}
        <div className="rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-navy">Follow-Ups Due</h2>
            <Link
              href="/portal/leads"
              className="text-xs text-steel hover:text-navy"
            >
              View all
            </Link>
          </div>

          {followUpList.length === 0 ? (
            <div className="mt-8 flex flex-col items-center gap-2 text-center">
              <CheckCircle className="h-8 w-8 text-green-500" />
              <p className="text-sm font-medium text-green-700">
                All caught up!
              </p>
            </div>
          ) : (
            <ul className="mt-4 divide-y divide-navy/5">
              {followUpList.map((lead: any) => {
                const contact = lead.contact;
                const company = lead.company;
                const contactName = contact
                  ? `${contact.first_name} ${contact.last_name}`
                  : "Unknown";
                const companyName = company?.name ?? "";
                const due = followUpLabel(lead.follow_up_date);

                return (
                  <li key={lead.id} className="py-3">
                    <Link
                      href={`/portal/leads/${lead.id}`}
                      className="group flex items-center justify-between"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-navy group-hover:underline">
                          {contactName}
                        </p>
                        {companyName && (
                          <p className="truncate text-xs text-steel">
                            {companyName}
                          </p>
                        )}
                      </div>
                      <div className="ml-3 flex shrink-0 items-center gap-2">
                        <span className={`text-xs font-semibold ${due.color}`}>
                          {due.text}
                        </span>
                        <span className="rounded bg-navy/10 px-1.5 py-0.5 text-[10px] font-medium text-navy">
                          {stageLabels[lead.status]}
                        </span>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* ── RECENT ACTIVITY ── */}
      <div className="mt-8 rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-navy">Recent Activity</h2>

        {recentActivity.length === 0 ? (
          <p className="mt-4 text-sm text-steel">No activity yet.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-navy/10 text-left text-xs uppercase text-steel">
                  <th className="pb-2 pr-4 font-medium">Type</th>
                  <th className="pb-2 pr-4 font-medium">Contact</th>
                  <th className="pb-2 pr-4 font-medium">Company</th>
                  <th className="pb-2 pr-4 font-medium">Summary</th>
                  <th className="pb-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy/5">
                {recentActivity.map((activity: any) => {
                  const lead = activity.lead;
                  const contact = lead?.contact;
                  const company = lead?.company;
                  const contactName = contact
                    ? `${contact.first_name} ${contact.last_name}`
                    : "—";
                  const companyName = company?.name ?? "—";
                  const summary =
                    activity.summary.length > 80
                      ? activity.summary.slice(0, 80) + "…"
                      : activity.summary;
                  const badgeColor =
                    typeBadgeColors[activity.type] ??
                    "bg-gray-100 text-gray-800";

                  return (
                    <tr key={activity.id} className="group">
                      <td className="py-3 pr-4">
                        <Link href={`/portal/leads/${activity.lead_id}`}>
                          <span
                            className={`inline-block rounded px-2 py-0.5 text-[11px] font-medium ${badgeColor}`}
                          >
                            {typeLabels[activity.type] ?? activity.type}
                          </span>
                        </Link>
                      </td>
                      <td className="py-3 pr-4">
                        <Link
                          href={`/portal/leads/${activity.lead_id}`}
                          className="text-navy group-hover:underline"
                        >
                          {contactName}
                        </Link>
                      </td>
                      <td className="py-3 pr-4 text-charcoal/70">
                        {companyName}
                      </td>
                      <td className="py-3 pr-4 text-charcoal/70">{summary}</td>
                      <td className="whitespace-nowrap py-3 text-xs text-steel">
                        {relativeDate(activity.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
