"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/portal/settings",          label: "Sales Settings" },
  { href: "/portal/settings/cadence",  label: "Cadence Rules"  },
  { href: "/portal/settings/sync",     label: "Sync"           },
];

export default function SettingsSubNav() {
  const pathname = usePathname();

  function isActive(href: string) {
    if (href === "/portal/settings") return pathname === "/portal/settings";
    return pathname.startsWith(href);
  }

  return (
    <nav className="border-b border-navy/10 bg-white">
      <div className="flex gap-1 px-6 lg:px-8">
        {TABS.map((tab) => {
          const active = isActive(tab.href);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative px-4 py-3 text-sm font-semibold transition-colors ${
                active
                  ? "text-navy"
                  : "text-steel hover:text-navy"
              }`}
            >
              {tab.label}
              {active && (
                <span className="absolute inset-x-3 -bottom-px h-0.5 bg-red" />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
