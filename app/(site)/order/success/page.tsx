import Link from "next/link";
import Stripe from "stripe";

export const dynamic = "force-dynamic";

let stripeClient: Stripe | null = null;
function getStripe(): Stripe | null {
  if (stripeClient) return stripeClient;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  stripeClient = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  return stripeClient;
}

function formatUSD(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type OrderDetails = {
  customerName: string;
  customerEmail: string;
  qty6in: number;
  qty11in: number;
  shippingMethod: "klein_calculated" | "collect" | "";
  carrierType: string;
  totalCents: number;
};

async function loadOrder(
  sessionId: string | undefined
): Promise<OrderDetails | null> {
  if (!sessionId) return null;
  const stripe = getStripe();
  if (!stripe) return null;

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["line_items"],
    });

    const md = session.metadata ?? {};
    const rawMethod = md.shippingMethod;
    const shippingMethod: OrderDetails["shippingMethod"] =
      rawMethod === "klein_calculated" || rawMethod === "collect"
        ? rawMethod
        : "";

    return {
      customerName: md.customerName ?? "",
      customerEmail: session.customer_email ?? md.customerEmail ?? "",
      qty6in: parseInt(md.qty6in ?? "0", 10) || 0,
      qty11in: parseInt(md.qty11in ?? "0", 10) || 0,
      shippingMethod,
      carrierType: md.carrierType ?? "",
      totalCents: session.amount_total ?? 0,
    };
  } catch {
    return null;
  }
}

function GenericThankYou() {
  return (
    <div className="rounded-lg border border-navy/20 bg-offwhite p-8 text-center shadow-sm">
      <CheckCircle />
      <h1 className="mt-4 text-3xl font-bold text-navy">
        Thank You for Your Order
      </h1>
      <p className="mt-3 text-charcoal">
        Your payment was received. You will receive a confirmation email
        shortly.
      </p>
      <BackHomeButton />
    </div>
  );
}

function CheckCircle() {
  return (
    <svg
      className="mx-auto h-20 w-20 text-red"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}

function BackHomeButton() {
  return (
    <Link
      href="/"
      className="mt-8 inline-flex items-center justify-center rounded-md bg-red px-7 py-3 text-base font-semibold text-white transition-colors hover:bg-red/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red focus-visible:ring-offset-2"
    >
      Back to Klein Manufacturing
    </Link>
  );
}

export default async function OrderSuccessPage({
  searchParams,
}: {
  searchParams: { session_id?: string };
}) {
  const order = await loadOrder(searchParams.session_id);

  return (
    <>
      <section className="bg-[#1C2E4A]">
        <div className="mx-auto max-w-7xl px-4 py-16 text-center sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold text-white sm:text-4xl">
            Order Confirmation
          </h1>
        </div>
      </section>

      <section className="bg-white">
        <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
          {order ? (
            <div className="rounded-lg border border-navy/20 bg-offwhite p-8 shadow-sm">
              <div className="text-center">
                <CheckCircle />
                <h2 className="mt-4 text-3xl font-bold text-navy">
                  Order Confirmed!
                </h2>
                <p className="mt-3 text-charcoal">
                  Thank you
                  {order.customerName ? `, ${order.customerName}` : ""}. Your
                  order is in the queue.
                </p>
              </div>

              <div className="mt-8 rounded-md border border-navy/20 bg-white p-6">
                <h3 className="text-lg font-bold text-navy">Order Summary</h3>

                <dl className="mt-4 space-y-3 text-sm text-charcoal">
                  <div className="flex justify-between">
                    <dt className="font-semibold text-navy">Items</dt>
                    <dd className="text-right">
                      {order.qty6in > 0 && (
                        <div>
                          {order.qty6in} qty 6&quot; scrapers
                        </div>
                      )}
                      {order.qty11in > 0 && (
                        <div>
                          {order.qty11in} qty 11&quot; scrapers
                        </div>
                      )}
                      {order.qty6in === 0 && order.qty11in === 0 && (
                        <div className="text-steel">—</div>
                      )}
                    </dd>
                  </div>

                  <div className="flex justify-between">
                    <dt className="font-semibold text-navy">Shipping method</dt>
                    <dd className="text-right">
                      {order.shippingMethod === "collect"
                        ? `Ship collect on your ${order.carrierType || "carrier"} account`
                        : order.shippingMethod === "klein_calculated"
                          ? "Klein UPS Ground"
                          : "—"}
                    </dd>
                  </div>

                  {order.shippingMethod === "collect" && (
                    <div className="rounded-md border border-navy/10 bg-offwhite px-4 py-3 text-sm text-charcoal">
                      We will ship to your{" "}
                      {order.carrierType || "carrier"} account. We will contact
                      you at{" "}
                      <span className="font-semibold text-navy">
                        {order.customerEmail || "your email"}
                      </span>{" "}
                      if we have any questions.
                    </div>
                  )}

                  <div className="border-t border-navy/10 pt-3" />

                  <div className="flex justify-between text-base font-bold text-navy">
                    <dt>Total charged</dt>
                    <dd>{formatUSD(order.totalCents)}</dd>
                  </div>

                  {order.customerEmail && (
                    <div className="flex justify-between pt-1">
                      <dt className="font-semibold text-navy">
                        Confirmation sent to
                      </dt>
                      <dd className="text-right">{order.customerEmail}</dd>
                    </div>
                  )}
                </dl>
              </div>

              <p className="mt-6 text-center text-sm text-steel">
                You will receive a confirmation email shortly.
              </p>

              <div className="text-center">
                <BackHomeButton />
              </div>
            </div>
          ) : (
            <GenericThankYou />
          )}
        </div>
      </section>
    </>
  );
}
