import Link from "next/link";
import { ChevronRight } from "lucide-react";

export function AnalyticsShell({
  metric,
  year,
  title,
  subtitle,
  summary,
  children,
}: {
  metric: string;
  year: number;
  title: string;
  subtitle?: string;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="p-6 lg:p-8">
      <nav className="flex items-center gap-1.5 text-xs text-steel">
        <Link href="/portal" className="hover:text-navy hover:underline">
          Dashboard
        </Link>
        <ChevronRight className="h-3 w-3" />
        <span>Analytics</span>
        <ChevronRight className="h-3 w-3" />
        <span className="font-semibold text-navy">
          {metric} · {year}
        </span>
      </nav>

      <h1 className="mt-2 text-2xl font-bold text-navy">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-steel">{subtitle}</p>}

      {summary && <div className="mt-6">{summary}</div>}

      <div className="mt-6">{children}</div>
    </div>
  );
}

export function SummaryCards({
  cards,
}: {
  cards: Array<{
    label: string;
    value: string;
    hint?: string;
    emphasis?: boolean;
  }>;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c) => (
        <div
          key={c.label}
          className={`rounded-md border px-4 py-3 ${
            c.emphasis
              ? "border-navy bg-navy text-white"
              : "border-navy/10 bg-offwhite/50 text-charcoal"
          }`}
        >
          <p
            className={`text-[11px] font-bold uppercase tracking-wide ${
              c.emphasis ? "text-white/65" : "text-steel"
            }`}
          >
            {c.label}
          </p>
          <p
            className={`mt-1 text-2xl font-bold tabular-nums ${
              c.emphasis ? "text-white" : "text-navy"
            }`}
          >
            {c.value}
          </p>
          {c.hint && (
            <p
              className={`mt-0.5 text-[11px] ${
                c.emphasis ? "text-white/70" : "text-steel"
              }`}
            >
              {c.hint}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function SourceTag({
  variant,
  children,
}: {
  variant: "web" | "manual" | "sample" | "won";
  children: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    web: "bg-blue-100 text-blue-800",
    manual: "bg-amber-100 text-amber-800",
    sample: "bg-orange-100 text-orange-800",
    won: "bg-green-100 text-green-800",
  };
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${styles[variant]}`}
    >
      {children}
    </span>
  );
}

export function formatUSD(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
