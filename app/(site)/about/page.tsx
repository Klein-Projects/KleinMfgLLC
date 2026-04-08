import type { Metadata } from "next";
import { Crosshair, ShieldCheck, Truck } from "lucide-react";
import Button from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "About — Klein Manufacturing, LLC",
  description:
    "Klein Manufacturing builds aircraft-safe phenolic scrapers for aviation maintenance professionals. American-made, shipped direct.",
};

const cards = [
  {
    icon: Crosshair,
    title: "Aviation-Specific Design",
    description:
      "Not a hardware store scraper with a new label. Every Klein scraper is built specifically for aircraft surfaces — the material, the edge profile, and the dimensions are all designed for aviation maintenance.",
  },
  {
    icon: ShieldCheck,
    title: "Quality You Can Inspect",
    description:
      "Every scraper is individually inspected before it ships. If it's not right, it doesn't leave. No batch shortcuts.",
  },
  {
    icon: Truck,
    title: "Direct to Your Hangar",
    description:
      "We sell direct and ship fast. No distributors, no middlemen, no six-week lead times.",
  },
];

export default function AboutPage() {
  return (
    <>
      {/* ── SECTION 1 — HERO ── */}
      <section className="bg-[#1C2E4A]">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 lg:px-8 lg:py-28">
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
            Built by Hand. Trusted on&nbsp;the&nbsp;Flight&nbsp;Line.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-white/85">
            Klein Manufacturing builds aircraft-safe phenolic scrapers for the
            professionals who keep fleets flying. American-made, no exceptions.
          </p>
        </div>
      </section>

      {/* ── SECTION 2 — WHO WE ARE ── */}
      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl items-start gap-12 px-4 py-20 sm:px-6 md:grid-cols-[3fr_2fr] lg:px-8">
          {/* Left — text */}
          <div>
            <h2 className="text-3xl font-bold text-navy">
              Built for Aviation. Nothing&nbsp;Else.
            </h2>

            <div className="mt-8 space-y-5 text-base leading-relaxed text-charcoal/80">
              <p>
                Klein Manufacturing has roots in aviation tooling spanning over
                30 years. Our phenolic scrapers have been trusted by airlines
                and aircraft manufacturers for decades — and every unit we ship
                today is held to that same standard.
              </p>
              <p>
                Our scrapers are purpose-built for aircraft maintenance —
                sealant removal, gasket scraping, and surface prep on aluminum,
                composites, and painted surfaces. They&apos;re not repurposed
                industrial tools or generic plastic scrapers with an aviation
                label slapped on the packaging.
              </p>
            </div>
          </div>

          {/* Right — placeholder image (desktop only) */}
          <div className="hidden md:block">
            <div className="flex aspect-[4/5] items-center justify-center rounded-lg bg-gray-100 text-sm text-steel">
              Photo: Shop
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 3 — WHAT SETS US APART ── */}
      <section className="bg-offwhite">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold text-navy sm:text-4xl">
            Why Maintenance Teams Trust Klein
          </h2>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {cards.map((card) => (
              <div
                key={card.title}
                className="rounded-lg border border-navy/20 bg-white p-8 shadow-sm transition-shadow hover:shadow-md"
              >
                <card.icon
                  className="h-10 w-10 text-navy"
                  strokeWidth={1.5}
                />
                <h3 className="mt-5 text-xl font-semibold text-navy">
                  {card.title}
                </h3>
                <p className="mt-3 leading-relaxed text-charcoal/80">
                  {card.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SECTION 4 — MADE IN USA ── */}
      <section className="bg-[#1C2E4A]">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Made in America. Shipped&nbsp;Direct.
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-white/85">
            Every Klein scraper is manufactured in the USA. No overseas
            suppliers. No outsourced production. American-made tooling, shipped
            directly to your maintenance team.
          </p>
        </div>
      </section>

      {/* ── SECTION 5 — BOTTOM CTA ── */}
      <section className="bg-[#A52A2A]">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Ready to Put Klein Scrapers to&nbsp;Work?
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
