"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Link2, UserPlus, X } from "lucide-react";
import {
  linkOrderToCompany,
  createAccountForOrder,
  dismissReview,
} from "./actions";

type Order = {
  id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  company_name: string | null;
  product_6in_qty: number;
  product_11in_qty: number;
  total_charged: string | number;
  discount_code: string | null;
  created_at: string;
};

type Review = {
  id: string;
  created_at: string;
  notes: string | null;
  order: Order | null;
};

type Company = { id: string; name: string };

function formatUSD(value: string | number): string {
  const cents = Math.round(Number(value ?? 0) * 100);
  return `$${(cents / 100).toFixed(2)}`;
}

export default function ReviewQueueClient({
  reviews,
  companies,
}: {
  reviews: Review[];
  companies: Company[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState("");

  return (
    <div className="px-6 py-8 lg:px-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-navy">Review Queue</h1>
        <p className="mt-1 text-sm text-steel">
          Web orders that didn&apos;t auto-attribute to a CRM record. Link each
          order to an existing account or create a new one.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-md border border-red bg-red/10 px-4 py-3 text-sm font-semibold text-red"
        >
          {error}
        </div>
      )}

      {reviews.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-navy/20 bg-white px-6 py-16 text-center">
          <Inbox className="h-8 w-8 text-steel" />
          <p className="text-sm font-semibold text-navy">All caught up.</p>
          <p className="text-sm text-steel">
            No unresolved web orders waiting for review.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <ReviewRow
              key={r.id}
              review={r}
              companies={companies}
              isOpen={openId === r.id}
              onToggle={() => setOpenId(openId === r.id ? null : r.id)}
              onError={setError}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReviewRow({
  review,
  companies,
  isOpen,
  onToggle,
  onError,
}: {
  review: Review;
  companies: Company[];
  isOpen: boolean;
  onToggle: () => void;
  onError: (msg: string) => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"link" | "create" | null>(null);
  const [companySearch, setCompanySearch] = useState("");
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("");
  const [newCompanyName, setNewCompanyName] = useState(
    review.order?.company_name ?? ""
  );

  const order = review.order;
  if (!order) {
    return (
      <li className="rounded-md border border-red/30 bg-red/5 px-4 py-3 text-sm text-red">
        Review row {review.id} references a missing order.{" "}
        <button
          type="button"
          className="font-semibold underline"
          onClick={() =>
            startTransition(async () => {
              try {
                await dismissReview({
                  reviewId: review.id,
                  notes: "Order missing",
                });
                router.refresh();
              } catch (e) {
                onError(e instanceof Error ? e.message : "Dismiss failed.");
              }
            })
          }
        >
          Dismiss
        </button>
      </li>
    );
  }

  const itemsLine = `${order.product_6in_qty}× 6", ${order.product_11in_qty}× 11"`;
  const filtered = companies.filter((c) =>
    c.name.toLowerCase().includes(companySearch.toLowerCase())
  );

  function runAction(fn: () => Promise<void>) {
    onError("");
    startTransition(async () => {
      try {
        await fn();
        router.refresh();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Action failed.");
      }
    });
  }

  return (
    <li className="overflow-hidden rounded-lg border border-navy/10 bg-white shadow-sm">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-start justify-between gap-4 px-4 py-3 text-left hover:bg-offwhite"
      >
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-navy">{order.customer_name}</p>
          <p className="text-xs text-steel">
            {order.customer_email}
            {order.company_name ? ` · ${order.company_name}` : ""}
          </p>
          <p className="mt-1 text-sm text-charcoal">
            {itemsLine} — {formatUSD(order.total_charged)}
            {order.discount_code && (
              <span className="ml-2 rounded-full bg-navy/5 px-2 py-0.5 text-xs font-semibold text-navy">
                code {order.discount_code}
              </span>
            )}
          </p>
        </div>
        <span className="text-xs text-steel">
          {new Date(order.created_at).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          })}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-navy/10 bg-offwhite px-4 py-4">
          <div className="mb-3 grid gap-2 text-xs text-charcoal sm:grid-cols-2">
            <div>
              <span className="font-semibold text-steel">Phone:</span>{" "}
              {order.customer_phone || "—"}
            </div>
            <div>
              <span className="font-semibold text-steel">Order date:</span>{" "}
              {new Date(order.created_at).toLocaleString()}
            </div>
          </div>

          {mode === null && (
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setMode("link")}
                className="inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90"
              >
                <Link2 className="h-4 w-4" /> Link to Existing Account
              </button>
              <button
                type="button"
                onClick={() => setMode("create")}
                className="inline-flex items-center gap-2 rounded-md border border-navy bg-white px-4 py-2 text-sm font-semibold text-navy hover:bg-navy/5"
              >
                <UserPlus className="h-4 w-4" /> Create New Contact
              </button>
              <button
                type="button"
                onClick={() =>
                  runAction(() =>
                    dismissReview({ reviewId: review.id, notes: "Dismissed" })
                  )
                }
                disabled={isPending}
                className="inline-flex items-center gap-2 rounded-md border border-navy/20 bg-white px-3 py-2 text-xs font-semibold text-steel hover:border-navy hover:text-navy disabled:opacity-60"
              >
                <X className="h-3 w-3" /> Dismiss
              </button>
            </div>
          )}

          {mode === "link" && (
            <div className="space-y-3 rounded-md border border-navy/10 bg-white p-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-steel">
                  Search companies
                </label>
                <input
                  type="text"
                  value={companySearch}
                  onChange={(e) => setCompanySearch(e.target.value)}
                  placeholder="Type to filter…"
                  className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
                  autoFocus
                />
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border border-navy/10">
                {filtered.length === 0 ? (
                  <p className="px-3 py-2 text-xs text-steel">
                    No companies match.
                  </p>
                ) : (
                  <ul className="divide-y divide-navy/5">
                    {filtered.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedCompanyId(c.id)}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-offwhite ${
                            selectedCompanyId === c.id
                              ? "bg-navy/5 font-semibold text-navy"
                              : "text-charcoal"
                          }`}
                        >
                          <span>{c.name}</span>
                          {selectedCompanyId === c.id && (
                            <span className="text-xs text-navy">selected</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!selectedCompanyId || isPending}
                  onClick={() =>
                    runAction(() =>
                      linkOrderToCompany({
                        reviewId: review.id,
                        orderId: order.id,
                        companyId: selectedCompanyId,
                      })
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-60"
                >
                  {isPending ? "Linking…" : "Link order"}
                </button>
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  disabled={isPending}
                  className="inline-flex items-center gap-2 rounded-md border border-navy/20 bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {mode === "create" && (
            <div className="space-y-3 rounded-md border border-navy/10 bg-white p-3">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-steel">
                  Company name
                </label>
                <input
                  type="text"
                  value={newCompanyName}
                  onChange={(e) => setNewCompanyName(e.target.value)}
                  placeholder={
                    order.company_name ?? "Pulled from checkout if blank"
                  }
                  className="mt-1 w-full rounded-md border border-navy/20 px-3 py-2 text-sm outline-none focus:border-navy focus:ring-2 focus:ring-navy/20"
                  autoFocus
                />
                <p className="mt-1 text-xs text-steel">
                  Will create a new company plus contact (
                  {order.customer_email}) and a lead with status{" "}
                  <code className="rounded bg-navy/5 px-1">won</code> /
                  source <code className="rounded bg-navy/5 px-1">website</code>.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() =>
                    runAction(() =>
                      createAccountForOrder({
                        reviewId: review.id,
                        orderId: order.id,
                        companyName: newCompanyName.trim(),
                      })
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy/90 disabled:opacity-60"
                >
                  {isPending ? "Creating…" : "Create account"}
                </button>
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  disabled={isPending}
                  className="inline-flex items-center gap-2 rounded-md border border-navy/20 bg-white px-4 py-2 text-sm font-semibold text-navy hover:border-navy"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
