import Image from "next/image";
import { Wrench, Hammer, Flag } from "lucide-react";
import Button from "@/components/ui/Button";

const features = [
  {
    icon: Wrench,
    title: "Aircraft-Safe Material",
    description:
      "Phenolic won't scratch aluminum, composites, or painted surfaces. Fuel and hydraulic fluid resistant. Safe near avionics.",
  },
  {
    icon: Hammer,
    title: "Handcrafted, Not Mass-Produced",
    description:
      "Every scraper hand-cut and edge-finished. Not injection-molded. Each unit inspected before it ships.",
  },
  {
    icon: Flag,
    title: "Made in the USA",
    description:
      "Built in America. Shipped directly to your hangar. No overseas delays. No quality surprises.",
  },
];

const industryCategories = [
  "Commercial Airlines",
  "Aircraft Manufacturers",
  "MRO Facilities",
  "Corporate Aviation",
];

export default function Home() {
  return (
    <>
      {/* ── SECTION 1 — HERO ── */}
      <section className="bg-[#1C2E4A] overflow-hidden py-20">
        <div className="bg-white w-full py-12">
          <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 sm:px-6 lg:grid-cols-[1fr_2fr_1fr] lg:gap-12 lg:px-8">
            {/* Left — 6" scraper */}
            <div className="hidden lg:block">
              <div className="relative aspect-[3/5] w-full">
                <Image
                  src="/MDP_8856-p.png"
                  alt="Klein 6-inch phenolic aviation scraper"
                  fill
                  unoptimized
                  className="object-contain drop-shadow-2xl"
                  sizes="25vw"
                  priority
                />
              </div>
              <p className="mt-3 text-center text-sm font-medium text-navy/60">
                6&quot; Scraper
              </p>
            </div>

            {/* Center copy */}
            <div className="text-center lg:text-left">
              <h1 className="text-4xl font-bold leading-tight tracking-tight text-navy sm:text-5xl">
                Aircraft Scrapers Built&nbsp;for&nbsp;the Flight&nbsp;Line
              </h1>
              <p className="mx-auto mt-6 max-w-lg text-lg leading-relaxed text-charcoal lg:mx-0">
                Handcrafted phenolic scrapers — safer than metal, more rigid than
                plastic. Trusted by aviation maintenance professionals.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-4 lg:justify-start">
                <Button href="/request-samples" size="lg">
                  Request Free Samples &rarr;
                </Button>
                <Button
                  href="/products"
                  variant="outline"
                  size="lg"
                  className="border-navy text-navy hover:bg-navy hover:text-white"
                >
                  View Products
                </Button>
              </div>

              <p className="mt-4 text-base font-semibold text-red">
                Made in the USA
              </p>
            </div>

            {/* Right — 11" scraper */}
            <div className="hidden lg:block">
              <div className="relative aspect-[3/5] w-full">
                <Image
                  src="/MDP_8855-p.png"
                  alt="Klein 11-inch phenolic aviation scraper"
                  fill
                  unoptimized
                  className="object-contain drop-shadow-2xl"
                  sizes="25vw"
                  priority
                />
              </div>
              <p className="mt-3 text-center text-sm font-medium text-navy/60">
                11&quot; Long-Reach Scraper
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 2 — WHY KLEIN ── */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold text-navy sm:text-4xl">
            Why Maintenance Crews Choose Klein
          </h2>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {features.map((f) => (
              <div
                key={f.title}
                className="rounded-lg border border-navy/20 bg-white p-8 shadow-sm transition-shadow hover:shadow-md"
              >
                <f.icon className="h-10 w-10 text-navy" strokeWidth={1.5} />
                <h3 className="mt-5 text-xl font-semibold text-navy">
                  {f.title}
                </h3>
                <p className="mt-3 leading-relaxed text-charcoal/80">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 3 — TRUSTED BY ── */}
      <section className="bg-offwhite">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
          <p className="mx-auto max-w-2xl text-center text-base text-navy">
            These scrapers have been made in America for over 30 years — trusted
            by aviation professionals across commercial airlines, aircraft
            manufacturing, and MRO operations.
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
            {industryCategories.map((name, i) => (
              <span key={name} className="flex items-center gap-10">
                <span className="text-lg font-semibold tracking-wide text-navy">
                  {name}
                </span>
                {i < industryCategories.length - 1 && (
                  <span className="hidden text-navy/20 sm:inline" aria-hidden>
                    |
                  </span>
                )}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 4 — SAMPLE REQUEST CTA ── */}
      <section className="bg-[#A52A2A]">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Ready to Try Klein Scrapers on&nbsp;Your&nbsp;Aircraft?
          </h2>
          <p className="mt-4 text-lg text-white/80">
            Request free samples — no commitment. We ship fast.
          </p>
          <div className="mt-8">
            <Button
              href="/request-samples"
              variant="outline"
              size="lg"
              className="border-white text-white hover:bg-white hover:text-red"
            >
              Request Free Samples &rarr;
            </Button>
          </div>
        </div>
      </section>
    </>
  );
}
