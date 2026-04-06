import Link from "next/link";
import Image from "next/image";

const quickLinks = [
  { label: "Home", href: "/" },
  { label: "Products", href: "/products" },
  { label: "About", href: "/about" },
  { label: "Request Samples", href: "/request-samples" },
];

export default function SiteFooter() {
  return (
    <footer className="bg-[#1C2E4A] text-steel">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-3">
          {/* Left — Logo + tagline */}
          <div className="flex flex-col gap-4">
            <Link href="/" className="flex items-center gap-2">
              <Image
                src="/logo.png"
                alt="Klein Manufacturing"
                width={32}
                height={32}
                className="h-8 w-auto"
              />
              <span className="text-lg font-bold text-white">
                Klein Manufacturing
              </span>
            </Link>
            <p className="text-sm leading-relaxed text-steel">
              Handcrafted Phenolic Scrapers&nbsp;&#9733;&nbsp;Made in the
              USA&nbsp;&#9733;&nbsp;Designed for Aviation
            </p>
          </div>

          {/* Center — Quick Links */}
          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white">
              Quick Links
            </h3>
            <ul className="flex flex-col gap-2">
              {quickLinks.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className="text-sm text-steel transition-colors hover:text-white"
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Right — Contact */}
          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white">
              Contact
            </h3>
            <a
              href="mailto:sales@kleinmfgllc.com"
              className="block text-sm text-steel transition-colors hover:text-white"
            >
              sales@kleinmfgllc.com
            </a>
            <div className="mt-4 inline-flex items-center rounded-md bg-white/10 px-3 py-2 text-sm text-white">
              Handcrafted in the USA
            </div>
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/10">
        <div className="mx-auto max-w-7xl px-4 py-4 sm:px-6 lg:px-8">
          <p className="text-center text-xs text-steel/70">
            &copy; 2024 Klein Manufacturing, LLC. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
