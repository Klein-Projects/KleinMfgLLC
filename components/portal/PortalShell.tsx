"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  ClipboardCheck,
  Send,
  Users,
  BookOpen,
  Truck,
  Inbox,
  ListChecks,
  BarChart3,
  Settings,
  LogOut,
} from "lucide-react";

const navItems = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard, key: "dashboard" },
  { href: "/portal/today", label: "Today", icon: ClipboardCheck, key: "today" },
  { href: "/portal/outreach", label: "Outreach", icon: Send, key: "outreach" },
  { href: "/portal/review-queue", label: "Pending changes", icon: ListChecks, key: "review-queue" },
  { href: "/portal/leads", label: "Leads", icon: Users, key: "leads" },
  { href: "/portal/prompts", label: "Prompt Library", icon: BookOpen, key: "prompts" },
  { href: "/portal/prompts/analytics", label: "Analytics", icon: BarChart3, key: "analytics" },
  { href: "/portal/shipments", label: "Shipments", icon: Truck, key: "shipments" },
  { href: "/portal/review", label: "Web orders", icon: Inbox, key: "review" },
  { href: "/portal/settings", label: "Settings", icon: Settings, key: "settings" },
];

export default function PortalShell({
  userEmail,
  reviewCount = 0,
  reviewQueueCount = 0,
  todayCount = 0,
  shipmentsCount = 0,
  children,
}: {
  userEmail: string;
  reviewCount?: number;
  reviewQueueCount?: number;
  todayCount?: number;
  shipmentsCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  // Determine active nav item. Match on segment boundaries so
  // /portal/review-queue does not also light up the /portal/review tab.
  // /portal/prompts/analytics is its own top-level entry, so when the
  // user is on it Prompt Library should NOT also highlight.
  function isActive(href: string) {
    if (href === "/portal") return pathname === "/portal";
    if (href === "/portal/prompts") {
      if (pathname.startsWith("/portal/prompts/analytics")) return false;
      return pathname === href || pathname.startsWith(href + "/");
    }
    return pathname === href || pathname.startsWith(href + "/");
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-60 flex-col bg-[#1C2E4A]">
        {/* Brand */}
        <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
          <Image
            src="/logo-mark.png"
            alt="Klein Manufacturing"
            width={64}
            height={64}
            className="h-16 w-auto"
          />
          <span className="text-xl font-bold text-white">
            Klein Portal
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4">
          <ul className="space-y-1">
            {navItems
              .filter((item) => {
                // The "Web orders" item (the unmatched-order triage queue) is
                // a safety net only — the Stripe webhook auto-creates a lead
                // for every paid order via crm-attribution.ts, so this queue
                // is empty in normal operation. Hide it from the sidebar when
                // empty so it only reappears if an edge case (no email, DB
                // failure) ever lands a row here.
                if (item.key === "review" && (reviewCount ?? 0) === 0) {
                  return false;
                }
                return true;
              })
              .map((item) => {
              const active = isActive(item.href);
              const badgeCount =
                item.key === "review"
                  ? reviewCount
                  : item.key === "review-queue"
                    ? reviewQueueCount
                    : item.key === "today"
                      ? todayCount
                      : item.key === "shipments"
                        ? shipmentsCount
                        : 0;
              const showBadge = badgeCount > 0;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors ${
                      active
                        ? "border-l-2 border-red bg-white/10 text-white"
                        : "text-white/70 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <item.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                    <span className="flex-1">{item.label}</span>
                    {showBadge && (
                      <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red px-1.5 text-xs font-bold text-white">
                        {badgeCount}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Bottom — user + logout */}
        <div className="border-t border-white/10 px-5 py-4">
          <p className="truncate text-xs text-steel">{userEmail}</p>
          <button
            onClick={handleLogout}
            className="mt-3 flex items-center gap-2 text-xs text-white/60 transition-colors hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            Logout
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="ml-60 flex min-h-screen flex-1 flex-col bg-offwhite">
        {children}
      </main>
    </div>
  );
}
