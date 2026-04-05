import type { Metadata } from "next";
import { Layers, Ruler, Search } from "lucide-react";
import Button from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "About — Klein Manufacturing, LLC",
  description:
    "Klein Manufacturing is a one-person operation making handcrafted phenolic aviation scrapers in the USA. Learn the story behind the tools.",
};

const steps = [
  {
    number: "01",
    icon: Layers,
    title: "Start with the Right Material",
    description:
      "High-density phenolic selected specifically for hardness, chemical resistance, and non-scratch properties. Not all phenolic is the same — we source sheet stock that holds up to Skydrol, Jet-A, and hydraulic fluid without softening or degrading.",
  },
  {
    number: "02",
    icon: Ruler,
    title: "Hand-Cut to Size",
    description:
      "Each scraper is cut by hand to exact dimensions. No stamping, no injection molds, no automated cutting lines. This isn't mass production — it's a craftsman making tools one at a time.",
  },
  {
    number: "03",
    icon: Search,
    title: "Edge-Finished and Inspected",
    description:
      "Every edge is finished to prevent splintering and ensure a clean scraping profile. Every unit is inspected before it goes in the box. If it's not right, it doesn't ship.",
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
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-steel">
            Klein Manufacturing is a one-person operation built on the belief
            that the best tools come from people who actually care about the
            work.
          </p>
        </div>
      </section>

      {/* ── SECTION 2 — THE STORY ── */}
      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl items-start gap-12 px-4 py-20 sm:px-6 md:grid-cols-[3fr_2fr] lg:px-8">
          {/* Left — text */}
          <div>
            <h2 className="text-3xl font-bold text-navy">The Klein Story</h2>

            <div className="mt-8 space-y-5 text-base leading-relaxed text-charcoal/80">
              <p>
                It started with a simple problem that nobody was solving. Metal
                scrapers gouge aluminum skin and damage painted surfaces. Cheap
                plastic scrapers flex under load, snap in half, and leave you
                fishing broken pieces out of a sealant bead. And yet, across
                hangars and flight lines everywhere, maintenance crews were
                being handed one or the other and told to make it work.
              </p>
              <p>
                Sean Klein saw it firsthand and asked a straightforward
                question: why isn&apos;t anyone making a scraper that&apos;s
                actually built for this job? Phenolic — the same material
                trusted in aerospace electrical insulation and structural
                laminates — had the right combination of rigidity, chemical
                resistance, and surface safety. It just needed to be shaped
                into a tool that a mechanic could actually use.
              </p>
              <p>
                So he started making them. Hand-cutting phenolic sheet stock in
                his shop, testing edge profiles on real aircraft surfaces,
                refining the geometry until the scraper did exactly what it was
                supposed to do — remove sealant cleanly without scratching the
                substrate underneath. He shipped the first batches to MRO shops
                and airline maintenance teams who needed a better answer than
                &ldquo;use a putty knife and hope for the best.&rdquo;
              </p>
              <p>
                Every Klein scraper today is still made the same way: hand-cut,
                edge-finished, and inspected by Sean before it ships. No
                factory floor. No outsourced labor. Just one person making sure
                every tool that leaves the shop is something he&apos;d trust on
                his own aircraft.
              </p>
            </div>
          </div>

          {/* Right — placeholder image (desktop only) */}
          <div className="hidden md:block">
            <div className="flex aspect-[4/5] items-center justify-center rounded-lg bg-gray-100 text-sm text-steel">
              Photo: Sean / Shop
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 3 — THE PROCESS ── */}
      <section className="bg-offwhite">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold text-navy sm:text-4xl">
            How Every Scraper Is Made
          </h2>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {steps.map((step) => (
              <div
                key={step.number}
                className="rounded-lg border border-navy/20 bg-white p-8 shadow-sm"
              >
                <div className="flex items-center gap-4">
                  <span className="text-3xl font-bold text-navy/20">
                    {step.number}
                  </span>
                  <step.icon
                    className="h-8 w-8 text-navy"
                    strokeWidth={1.5}
                  />
                </div>
                <h3 className="mt-5 text-xl font-semibold text-navy">
                  {step.title}
                </h3>
                <p className="mt-3 leading-relaxed text-charcoal/80">
                  {step.description}
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
            Handcrafted in the USA{" "}
            <span aria-label="American flag">&#127482;&#127480;</span>
          </h2>
          <p className="mx-auto mt-6 max-w-xl text-lg leading-relaxed text-steel">
            Every Klein scraper is made in America. No overseas suppliers. No
            outsourced quality checks. Just American craftsmanship, shipped
            directly to your hangar.
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
