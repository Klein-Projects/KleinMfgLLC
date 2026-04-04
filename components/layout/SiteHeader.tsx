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
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo + brand name */}
        <Link href="/" className="flex items-center gap-2">
          <Image
            src="/logo.png"
            alt="Klein Manufacturing"
            width={40}
            height={40}
            className="h-10 w-auto"
            priority
          />
          <span className="text-lg font-bold text-navy">
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
          <Button href="/request-samples" size="sm">
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
            <Button href="/request-samples" size="sm" className="mt-1 w-full">
              Request Samples
            </Button>
          </div>
        </nav>
      )}
    </header>
  );
}
