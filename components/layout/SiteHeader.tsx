"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import Button from "@/components/ui/Button";

const navLinks = [
  { label: "Home", href: "/" },
  { label: "Products", href: "/products" },
  { label: "About", href: "/about" },
];

export default function SiteHeader() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-navy/20 bg-white">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-2 sm:px-6 lg:px-8">
        {/* Logo + wordmark */}
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/logo-mark.png"
            alt="Klein Manufacturing"
            width={64}
            height={64}
            className="h-16 w-auto"
            priority
          />
          <span className="text-2xl font-bold text-red">
            Klein Manufacturing
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden items-center gap-6 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-navy transition-colors hover:text-red hover:underline"
            >
              {link.label}
            </Link>
          ))}
          <Button href="/order" size="sm">
            Order Now
          </Button>
          <Button
            href="/request-samples"
            variant="outline"
            size="sm"
            className="border-navy text-navy hover:bg-navy hover:text-white"
          >
            Request Samples
          </Button>
        </nav>

        {/* Mobile hamburger */}
        <button
          type="button"
          onClick={() => setMenuOpen(!menuOpen)}
          className="inline-flex items-center justify-center rounded-md p-2 text-navy md:hidden"
          aria-label="Toggle menu"
          aria-expanded={menuOpen}
        >
          <svg
            className="h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            {menuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </div>

      {/* Mobile drawer */}
      {menuOpen && (
        <nav className="border-t border-navy/10 bg-white px-4 pb-4 pt-2 md:hidden">
          <div className="flex flex-col gap-3">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMenuOpen(false)}
                className="text-sm font-medium text-navy transition-colors hover:text-red hover:underline"
              >
                {link.label}
              </Link>
            ))}
            <Button href="/order" size="sm" className="mt-1 w-full">
              Order Now
            </Button>
            <Button
              href="/request-samples"
              variant="outline"
              size="sm"
              className="w-full border-navy text-navy hover:bg-navy hover:text-white"
            >
              Request Samples
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}
