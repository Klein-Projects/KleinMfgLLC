"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  BookOpen,
  Truck,
  LogOut,
} from "lucide-react";

const navItems = [
  { href: "/portal", label: "Dashboard", icon: LayoutDashboard },
  { href: "/portal/leads", label: "Leads", icon: Users },
  { href: "/portal/prompts", label: "Prompt Library", icon: BookOpen },
  { href: "/portal/shipments", label: "Shipments", icon: Truck },
];

export default function PortalShell({
  userEmail,
  children,
}: {
  userEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/portal/logout", { method: "POST" });
    router.push("/portal/login");
    router.refresh();
  }

  // Determine active nav item
  function isActive(href: string) {
    if (href === "/portal") return pathname === "/portal";
    return pathname.startsWith(href);
  }

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside className="fixed left-0 top-0 z-40 flex h-screen w-60 flex-col bg-[#1C2E4A]">
        {/* Brand */}
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-5">
          <Image
            src="/logo.png"
            alt="Klein Manufacturing"
            width={28}
            height={28}
            className="h-7 w-auto"
          />
          <span className="text-sm font-bold text-white">
            Klein Sales Portal
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const active = isActive(item.href);
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
                    {item.label}
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
