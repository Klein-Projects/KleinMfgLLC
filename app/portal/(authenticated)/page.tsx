import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  Users,
  Bell,
  Send,
  Trophy,
  ArrowRight,
} from "lucide-react";
import FollowUpPanel from "@/components/portal/FollowUpPanel";

// ── Helpers ──

const typeBadgeColors: Record<string, string> = {
  linkedin_message: "bg-blue-100 text-blue-800",
  connection_request: "bg-blue-100 text-blue-800",
  email: "bg-teal-100 text-teal-800",
  phone: "bg-green-100 text-green-800",
  note: "bg-gray-100 text-gray-800",
  sample_sent: "bg-orange-100 text-orange-800",
  follow_up: "bg-purple-100 text-purple-800",
  web_order: "bg-emerald-100 text-emerald-800",
};

const typeLabels: Record<string, string> = {
  linkedin_message: "LinkedIn",
  connection_request: "Connect Req",
  email: "Email",
  phone: "Phone",
  note: "Note",
  sample_sent: "Sample Sent",
  follow_up: "Follow-Up",
  web_order: "Web Order",
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

function formatUSD(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

// ── Page ──

export default async function PortalDashboard() {
  const supabase = createClient();

  const todayISO = new Date().toISOString().split("T")[0];
  const nowISO = new Date().toISOString();
  const threeDaysOut = new Date(Date.now() + 3 * 86400000)
    .toISOString()
    .split("T")[0];
  const currentYear = new Date().getFullYear();
  const yearStart = new Date(currentYear, 0, 1).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();

  // Fetch all data in parallel
  const [
    activeLeadsRes,
    followUpsDueRes,
    samplesSentRes,
    winsRes,
    followUpListRes,
    recentActivityRes,
    paidOrdersYtdRes,
    manualOrdersYtdRes,
    samplesShippedYtdRes,
    wonLeadsRes,
  ] = await Promise.all([
    // Active leads count — excludes terminal statuses AND parked leads.
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .not("status", "in", "(won,lost)")
      .or(`wake_up_at.is.null,wake_up_at.lt.${nowISO}`),

    // Follow-ups due count — also honors wake_up_at so parked leads
    // don't pad the number Sean acts on first thing in the morning.
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .lte("follow_up_date", todayISO)
      .not("status", "in", "(won,lost)")
      .or(`wake_up_at.is.null,wake_up_at.lt.${nowISO}`),

    // Samples sent (30 days) — Phase 4 reads from shipments, not
    // activities, so the count and the /portal/shipments?since=30d
    // detail page agree (every CRM-side shipment is a sample, see
    // migration 018 backfill).
    supabase
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .gte("shipped_at", thirtyDaysAgo),

    // Wins this year — Phase 4 filters by closed_won_at, the new
    // dedicated stamp column. Replaces the last_activity_at proxy
    // that incorrectly bumped 2024 wins into 2025 whenever Sean
    // logged a follow-up note on a won lead.
    supabase
      .from("leads")
      .select("id", { count: "exact", head: true })
      .eq("status", "won")
      .gte("closed_won_at", yearStart),

    // Follow-up list — overdue + next 3 days, parked leads excluded.
    supabase
      .from("leads")
      .select(
        "id, status, follow_up_date, contact:contacts(first_name, last_name), company:companies(name)"
      )
      .lte("follow_up_date", threeDaysOut)
      .not("status", "in", "(won,lost,invited)")
      .or(`wake_up_at.is.null,wake_up_at.lt.${nowISO}`)
      .order("follow_up_date", { ascending: true })
      .limit(15),

    // Recent activity
    supabase
      .from("activities")
      .select(
        "id, type, summary, created_at, lead_id, lead:leads(contact:contacts(first_name, last_name), company:companies(name))"
      )
      .order("created_at", { ascending: false })
      .limit(10),

    // YTD revenue (web side) — paid (non-sample) Stripe orders.
    supabase
      .from("orders")
      .select("total_charged, product_6in_qty, product_11in_qty, shipped_at")
      .eq("is_sample", false)
      .gte("created_at", yearStart),

    // YTD revenue (offline side) — manual_orders entered through
    // /portal/analytics/revenue/<year>. Empty until Step 4 ships
    // the Add Manual Order form, but the union is wired now so
    // numbers stay correct as soon as the first row lands.
    supabase
      .from("manual_orders")
      .select("total_revenue, parts, order_date")
      .gte("order_date", yearStart.split("T")[0]),

    // YTD free samples shipped — Phase 4 reads from shipments
    // where is_sample=true (migration 018 backfilled this).
    supabase
      .from("shipments")
      .select("id", { count: "exact", head: true })
      .eq("is_sample", true)
      .gte("shipped_at", yearStart),

    // Won deals this year — Phase 4 filters and orders by
    // closed_won_at to match the Wins-This-Year tile above.
    supabase
      .from("leads")
      .select(
        "id, closed_won_at, contact:contacts(first_name, last_name), company:companies(name)"
      )
      .eq("status", "won")
      .gte("closed_won_at", yearStart)
      .order("closed_won_at", { ascending: false })
      .limit(20),
  ]);

  const activeLeads = activeLeadsRes.count ?? 0;
  const followUpsDue = followUpsDueRes.count ?? 0;
  const samplesSent = samplesSentRes.count ?? 0;
  const winsThisYear = winsRes.count ?? 0;

  const followUpList = (followUpListRes.data ?? []) as any[];
  const recentActivity = (recentActivityRes.data ?? []) as any[];

  // ── This Year totals ──
  const paidOrders = (paidOrdersYtdRes.data ?? []) as Array<{
    total_charged: number;
    product_6in_qty: number;
    product_11in_qty: number;
    shipped_at: string | null;
  }>;
  const manualOrders = (manualOrdersYtdRes.data ?? []) as Array<{
    total_revenue: number;
    parts: Array<{ size?: string; qty?: number; unit_price?: number }> | null;
    order_date: string;
  }>;

  const revenueWeb = paidOrders.reduce(
    (s, o) => s + Number(o.total_charged ?? 0),
    0,
  );
  const revenueManual = manualOrders.reduce(
    (s, o) => s + Number(o.total_revenue ?? 0),
    0,
  );
  const revenueYtd = revenueWeb + revenueManual;

  const partsSoldWeb = paidOrders.reduce(
    (s, o) => s + (o.product_6in_qty ?? 0) + (o.product_11in_qty ?? 0),
    0,
  );
  const partsSoldManual = manualOrders.reduce(
    (s, o) =>
      s + (Array.isArray(o.parts) ? o.parts : []).reduce(
        (ss, p) => ss + (Number(p?.qty) || 0),
        0,
      ),
    0,
  );
  const partsSoldYtd = partsSoldWeb + partsSoldManual;

  const ordersShippedYtd = paidOrders.filter((o) => !!o.shipped_at).length;
  const samplesShippedYtd = samplesShippedYtdRes.count ?? 0;
  const wonDeals = (wonLeadsRes.data ?? []) as unknown as Array<{
    id: string;
    closed_won_at: string;
    contact: { first_name: string; last_name: string } | null;
    company: { name: string } | null;
  }>;

  const dataAsOf = new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const statCards = [
    {
      label: "Active Leads",
      value: activeLeads,
      icon: Users,
      alert: false,
      href:
        "/portal/leads?status_in=new,invited,contacted,engaged,sample_sent,quoted,pending_ship,nurture",
      tipSource: "leads",
      tipBody:
        "Count of leads where status NOT IN ('won','lost') AND (wake_up_at IS NULL OR wake_up_at ≤ now()).",
    },
    {
      label: "Follow-Ups Due",
      value: followUpsDue,
      icon: Bell,
      alert: followUpsDue > 0,
      href: "/portal/today",
      tipSource: "today queue",
      tipBody:
        "Leads surfaced by the cadence engine for today, plus any with manual follow_up_date ≤ today and status NOT IN ('won','lost'). Parked leads excluded.",
    },
    {
      label: "Samples Sent (30d)",
      value: samplesSent,
      icon: Send,
      alert: false,
      href: "/portal/shipments?since=30d",
      tipSource: "shipments",
      tipBody:
        "COUNT(*) of shipments where shipped_at ≥ now() − 30 days.",
    },
    {
      label: "Wins This Year",
      value: winsThisYear,
      icon: Trophy,
      alert: false,
      href: `/portal/leads?status=won&won_year=${currentYear}`,
      tipSource: "leads",
      tipBody: `Leads where status='won' AND year(closed_won_at) = ${currentYear}.`,
    },
  ];

  return (
    <div className="p-6 lg:p-8">
      {/* Page title */}
      <h1 className="text-2xl font-bold text-navy">Dashboard</h1>

      {/* ── STAT CARDS (clickable + hover tooltip describing source) ── */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {statCards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="group relative rounded-lg border border-navy/10 bg-white p-5 shadow-sm transition-all hover:border-navy/40 hover:shadow"
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
            <p className="mt-1 flex items-center gap-1 text-sm text-charcoal/60">
              {card.label}
              <ArrowRight className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
            </p>
            <SourceTooltip source={card.tipSource} body={card.tipBody} />
          </Link>
        ))}
      </div>

      {/* ── MIDDLE ROW: This Year + Follow-Ups ── */}
      <div className="mt-8 grid gap-6 lg:grid-cols-[3fr_2fr]">
        {/* This Year — replaces Pipeline by Stage */}
        <section className="rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-navy">This Year</h2>
            <span className="text-xs text-steel">
              Year-to-date · {new Date().getFullYear()}
            </span>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <KpiTile
              href={`/portal/analytics/revenue/${currentYear}`}
              label="Revenue"
              value={formatUSD(revenueYtd)}
              hint={`${ordersShippedYtd} of ${paidOrders.length} web order${paidOrders.length === 1 ? "" : "s"} shipped · ${manualOrders.length} manual`}
              tipSource="orders + manual_orders"
              tipBody={`SUM(orders.total_charged) where is_sample=false + SUM(manual_orders.total_revenue) for ${currentYear}.`}
            />
            <KpiTile
              href={`/portal/analytics/parts-sold/${currentYear}`}
              label="Parts sold"
              value={partsSoldYtd.toLocaleString()}
              hint="6in + 11in across web + manual"
              tipSource="orders + manual_orders"
              tipBody={`SUM(orders.product_6in_qty + product_11in_qty) where is_sample=false + SUM of parts[].qty across manual_orders for ${currentYear}.`}
            />
            <KpiTile
              href={`/portal/analytics/samples/${currentYear}`}
              label="Free samples shipped"
              value={samplesShippedYtd.toLocaleString()}
              hint={`This year · ${samplesSent} sent in last 30d`}
              tipSource="shipments"
              tipBody={`COUNT(*) of shipments where is_sample=true AND year(shipped_at) = ${currentYear}. Backfilled true on existing rows in migration 018.`}
            />
            <KpiTile
              href={`/portal/analytics/won/${currentYear}`}
              label="Won deals"
              value={winsThisYear.toLocaleString()}
              hint={
                wonDeals.length > 0
                  ? `Most recent · ${relativeDate(wonDeals[0].closed_won_at)}`
                  : "No wins logged yet"
              }
              tipSource="leads"
              tipBody={`Leads where status='won' AND year(closed_won_at) = ${currentYear}. Deal value joined from linked manual_orders/orders rows.`}
            />
          </div>

          {/* Won-deals drill-down list */}
          <div className="mt-5 border-t border-navy/10 pt-4">
            <h3 className="text-xs font-bold uppercase tracking-wide text-steel">
              Won deals this year
            </h3>
            {wonDeals.length === 0 ? (
              <p className="mt-3 text-sm text-steel">
                No wins logged this year yet. Mark a lead{" "}
                <span className="font-semibold">won</span> on its detail page
                and it will surface here.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-navy/10">
                {wonDeals.map((d) => {
                  const name = d.contact
                    ? `${d.contact.first_name} ${d.contact.last_name}`
                    : "Unknown";
                  const company = d.company?.name ?? "";
                  return (
                    <li key={d.id}>
                      <Link
                        href={`/portal/leads/${d.id}`}
                        className="flex items-center justify-between gap-3 py-2 hover:bg-offwhite/40"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-navy">
                            {name}
                          </p>
                          {company && (
                            <p className="truncate text-xs text-steel">
                              {company}
                            </p>
                          )}
                        </div>
                        <span className="whitespace-nowrap text-xs text-steel">
                          {relativeDate(d.closed_won_at)}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        {/* Follow-Ups Due */}
        <section className="rounded-lg border border-navy/10 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-navy">Follow-Ups Due</h2>
            <Link
              href="/portal/today"
              className="text-xs text-steel hover:text-navy"
            >
              Open Today →
            </Link>
          </div>
          <p className="mt-1 text-xs text-steel">
            Overdue + next 3 days, by manual follow-up date. Parked leads
            hidden.
          </p>

          <FollowUpPanel leads={followUpList} />
        </section>
      </div>

      {/* ── DATA-AS-OF FOOTER (Phase 4 Step 6 lights this up further) ── */}
      <p className="mt-6 flex items-center gap-2 text-xs text-steel">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-600" />
        Data as of {dataAsOf} PT · hover any tile for the source query, click
        to see the records.
      </p>

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

function KpiTile({
  href,
  label,
  value,
  hint,
  tipSource,
  tipBody,
}: {
  href?: string;
  label: string;
  value: string;
  hint: string;
  tipSource: string;
  tipBody: string;
}) {
  const inner = (
    <>
      <p className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-steel">
        {label}
        {href && (
          <span className="text-[10px] font-bold uppercase tracking-wider text-red opacity-0 transition-opacity group-hover:opacity-100">
            Edit ↗
          </span>
        )}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-navy">{value}</p>
      <p className="mt-0.5 text-[11px] text-steel">{hint}</p>
      <SourceTooltip source={tipSource} body={tipBody} />
    </>
  );

  const className =
    "group relative block rounded-md border border-navy/10 bg-offwhite/30 px-4 py-3 transition-colors hover:border-navy/30 hover:bg-white";

  if (href) {
    return (
      <Link href={href} className={className}>
        {inner}
      </Link>
    );
  }
  return (
    <div className={className} tabIndex={0}>
      {inner}
    </div>
  );
}

function SourceTooltip({ source, body }: { source: string; body: string }) {
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute bottom-[calc(100%+8px)] left-0 right-0 z-10 rounded-md bg-navy px-3 py-2 text-left text-[11px] leading-snug text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
    >
      <span className="mb-1 block text-[9px] font-bold uppercase tracking-wider text-white/60">
        Source · {source}
      </span>
      {body}
      <span
        aria-hidden
        className="absolute left-6 top-full block h-0 w-0 border-x-[6px] border-t-[6px] border-x-transparent border-t-navy"
      />
    </div>
  );
}
