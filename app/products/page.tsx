import type { Metadata } from "next";
import Image from "next/image";
import { Check, X } from "lucide-react";
import Button from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Products — Klein Manufacturing, LLC",
  description:
    "Handcrafted 6-inch and 11-inch phenolic aviation scrapers. Safe on aluminum, composites, and painted surfaces. Made in the USA.",
};

const products = [
  {
    name: '6" Phenolic Aviation Scraper',
    image: "/MDP_8838-p.jpg",
    alt: "Klein 6-inch phenolic aviation scraper",
    description:
      "Compact scraper ideal for tight spaces, cockpit components, detail work, and around avionics. The go-to tool for precision sealant work.",
    bestFor: "Sealant removal, gasket scraping, surface prep, detail work",
    size: "6 inches",
    queryParam: "6inch",
  },
  {
    name: '11" Phenolic Aviation Scraper (Long-Reach)',
    image: "/MDP_8837-p.jpg",
    alt: "Klein 11-inch phenolic aviation scraper",
    description:
      "Extra-length scraper for larger panels, wing surfaces, and fuselage work. The leverage advantage makes it the preferred choice for heavy maintenance checks.",
    bestFor: "C-checks, heavy maintenance, wing panels, fuselage work",
    size: "11 inches",
    queryParam: "11inch",
  },
];

const specs = [
  { label: "Material", value: "High-density phenolic sheet stock" },
  { label: "Safe On", value: "Aluminum, composites, painted surfaces" },
  { label: "Chemical Resistance", value: "Fuel, hydraulic fluid, Skydrol" },
];

const phenolicIs = [
  "Rigid enough to scrape without flexing",
  "Won't scratch aluminum, composites, or painted surfaces",
  "Chemically resistant to aviation fluids",
  "Non-conductive (safe near avionics and wiring)",
  "FAA/MRO shop approved material",
];

const metalPlasticNot = [
  "Metal scrapers scratch and gouge aircraft surfaces",
  "Standard plastic scrapers flex, slip, and break under load",
  "Plastic melts near heat sources in the hangar",
  "Neither is purpose-built for aviation sealant work",
];

export default function ProductsPage() {
  return (
    <>
      {/* ── PAGE HEADER ── */}
      <section className="bg-[#1C2E4A]">
        <div className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            Aviation Scrapers — Handcrafted in&nbsp;the&nbsp;USA
          </h1>
          <p className="mt-3 text-lg text-steel">
            Two sizes. Same uncompromising quality.
          </p>
        </div>
      </section>

      {/* ── PRODUCT CARDS ── */}
      <section className="bg-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 md:grid-cols-2 lg:px-8">
          {products.map((product) => (
            <div
              key={product.queryParam}
              className="overflow-hidden rounded-lg border border-navy/20 bg-white shadow-sm"
            >
              {/* Product photo */}
              <div className="relative aspect-[4/3] bg-white">
                <Image
                  src={product.image}
                  alt={product.alt}
                  fill
                  className="object-contain"
                  sizes="(max-width: 768px) 100vw, 50vw"
                />
              </div>

              <div className="p-6 sm:p-8">
                <h2 className="text-2xl font-bold text-navy">{product.name}</h2>
                <p className="mt-3 leading-relaxed text-charcoal/80">
                  {product.description}
                </p>

                {/* Specs table */}
                <table className="mt-6 w-full text-sm">
                  <tbody>
                    {specs.map((spec) => (
                      <tr key={spec.label} className="border-b border-navy/10">
                        <td className="whitespace-nowrap py-2.5 pr-4 font-semibold text-navy">
                          {spec.label}
                        </td>
                        <td className="py-2.5 text-charcoal/80">
                          {spec.value}
                        </td>
                      </tr>
                    ))}
                    <tr className="border-b border-navy/10">
                      <td className="whitespace-nowrap py-2.5 pr-4 font-semibold text-navy">
                        Best For
                      </td>
                      <td className="py-2.5 text-charcoal/80">
                        {product.bestFor}
                      </td>
                    </tr>
                    <tr>
                      <td className="whitespace-nowrap py-2.5 pr-4 font-semibold text-navy">
                        Size
                      </td>
                      <td className="py-2.5 text-charcoal/80">
                        {product.size}
                      </td>
                    </tr>
                  </tbody>
                </table>

                <div className="mt-8">
                  <Button
                    href={`/request-samples?product=${product.queryParam}`}
                  >
                    Request Samples &rarr;
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── WHY PHENOLIC ── */}
      <section className="bg-offwhite">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold text-navy sm:text-4xl">
            Why Phenolic?
          </h2>

          <div className="mt-14 grid gap-8 md:grid-cols-2">
            {/* Left — What Phenolic IS */}
            <div className="rounded-lg border border-green-200 bg-green-50 p-8">
              <h3 className="text-xl font-semibold text-green-900">
                What Phenolic IS
              </h3>
              <ul className="mt-5 space-y-3">
                {phenolicIs.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <Check
                      className="mt-0.5 h-5 w-5 shrink-0 text-green-700"
                      strokeWidth={2.5}
                    />
                    <span className="text-green-900/80">{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right — What Metal & Plastic Are NOT */}
            <div className="rounded-lg border border-red/20 bg-red/5 p-8">
              <h3 className="text-xl font-semibold text-red">
                What Metal &amp; Plastic Are NOT
              </h3>
              <ul className="mt-5 space-y-3">
                {metalPlasticNot.map((item) => (
                  <li key={item} className="flex items-start gap-3">
                    <X
                      className="mt-0.5 h-5 w-5 shrink-0 text-red"
                      strokeWidth={2.5}
                    />
                    <span className="text-charcoal/80">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── BOTTOM CTA ── */}
      <section className="bg-[#A52A2A]">
        <div className="mx-auto max-w-3xl px-4 py-20 text-center sm:px-6 lg:px-8">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Ready to Try Klein Scrapers?
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
