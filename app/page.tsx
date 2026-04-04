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
      "Built in America, shipped directly to your hangar. No overseas delays. No quality surprises.",
  },
];

const badges = [
  "Major U.S. Airlines",
  "MRO Facilities",
  "Regional Carriers",
  "Aircraft Manufacturers",
];

export default function Home() {
  return (
    <>
      {/* ── SECTION 1 — HERO ── */}
      <section className="bg-[#1C2E4A]">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-20 sm:px-6 md:grid-cols-2 lg:px-8 lg:py-28">
          {/* Left copy */}
          <div>
            <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
              Aircraft Scrapers Built&nbsp;for&nbsp;the Flight&nbsp;Line
            </h1>
            <p className="mt-6 max-w-lg text-lg leading-relaxed text-steel">
              Handcrafted phenolic scrapers — safer than metal, more rigid than
              plastic. Trusted by aviation maintenance professionals.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button href="/request-samples" size="lg">
                Request Free Samples &rarr;
              </Button>
              <Button
                href="/products"
                variant="outline"
                size="lg"
                className="border-white text-white hover:bg-white hover:text-navy"
              >
                View Products
              </Button>
            </div>

            <p className="mt-6 text-sm text-steel">
              Made in the USA{" "}
              <span aria-label="American flag">&#127482;&#127480;</span>
            </p>
          </div>

          {/* Right — placeholder image */}
          <div className="hidden items-center justify-center md:flex">
            <div className="flex h-72 w-full items-center justify-center rounded-lg bg-white/10 text-sm text-steel lg:h-80">
              Product Photo — add image to /public/scraper.jpg
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
          <p className="text-center text-sm font-medium uppercase tracking-wider text-steel">
            Trusted by Aviation Professionals Across the USA
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-4">
            {badges.map((badge) => (
              <span
                key={badge}
                className="rounded-full border border-navy px-5 py-2 text-sm font-medium text-navy"
              >
                {badge}
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
