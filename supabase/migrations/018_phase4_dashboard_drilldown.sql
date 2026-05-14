-- ============================================================
-- Klein Manufacturing LLC — Phase 4: Dashboard Drill-Through
--
-- Backs the click-through detail pages on /portal/dashboard:
--   /portal/analytics/revenue/<year>     — web orders + manual_orders
--   /portal/analytics/parts-sold/<year>  — line-item qty across both
--   /portal/analytics/samples/<year>     — shipments where is_sample=true
--   /portal/analytics/won/<year>         — leads where status='won'
--                                          AND closed_won_at falls in <year>
--
-- Three additive changes:
--   1. New manual_orders table (offline orders not in Stripe).
--   2. shipments.is_sample / qty_6in / qty_11in (nullable, with
--      heuristic backfill for is_sample on existing rows).
--   3. leads.closed_won_at (nullable) + backfill for current
--      won leads + index for the year filter.
--
-- Additive only. No drops, no renames. Safe to re-run.
-- ============================================================

-- =========================
-- manual_orders
-- Captures offline orders that don't go through the Stripe
-- pipeline (Boeing, Delta, direct PO, phone orders, etc.).
-- Backs the "Add Manual Order" form on
-- /portal/analytics/revenue/<year>. Lead linkage is optional
-- so Sean can log an order before the lead exists in the CRM.
--
-- parts is a jsonb array of { size: '6in' | '11in', qty, unit_price }
-- so the same line-item shape works for any future SKU without
-- another migration.
-- =========================
CREATE TABLE IF NOT EXISTS manual_orders (
  id                uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at        timestamptz   NOT NULL DEFAULT now(),
  updated_at        timestamptz   NOT NULL DEFAULT now(),

  customer_name     text          NOT NULL,
  customer_company  text,

  order_date        date          NOT NULL,
  parts             jsonb         NOT NULL DEFAULT '[]'::jsonb,
  total_revenue     numeric(10,2) NOT NULL DEFAULT 0,

  source            text          NOT NULL DEFAULT 'manual',
  notes             text,

  lead_id           uuid          REFERENCES leads(id) ON DELETE SET NULL
);

COMMENT ON TABLE manual_orders IS
  'Offline orders manually entered through /portal/analytics/revenue/<year>. Distinct from public.orders, which is Stripe-only. Sums into the dashboard "Revenue" tile alongside web orders.';

ALTER TABLE manual_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access" ON manual_orders
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "service_role full" ON manual_orders
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_manual_orders_order_date
  ON manual_orders(order_date DESC);

CREATE INDEX IF NOT EXISTS idx_manual_orders_lead
  ON manual_orders(lead_id);

-- =========================
-- shipments.is_sample / qty_6in / qty_11in
--
-- The CRM-side shipments table has historically been used for
-- one thing only: tracking free LinkedIn-outreach samples sent
-- to prospects. Existing rows are exclusively samples, so we
-- backfill is_sample = true on all of them. Future paid edge
-- cases can set is_sample = false explicitly.
--
-- qty_6in and qty_11in let /portal/analytics/samples/<year>
-- show a Parts column and let Sean correct the qty inline.
-- We do NOT backfill them (no reliable signal in the existing
-- rows); the detail page renders "qty unknown — confirm" for
-- NULL values and Sean can enter them from memory.
-- =========================
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS is_sample boolean;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS qty_6in   integer;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS qty_11in  integer;

UPDATE shipments
   SET is_sample = true
 WHERE is_sample IS NULL;

COMMENT ON COLUMN shipments.is_sample IS
  'true for free-sample shipments (every existing row). Backfilled by migration 018; future paid edge cases set false explicitly.';
COMMENT ON COLUMN shipments.qty_6in IS
  'Quantity of 6-inch scrapers shipped. NULL on rows existing prior to migration 018; filled in via the /portal/analytics/samples/<year> inline editor.';
COMMENT ON COLUMN shipments.qty_11in IS
  'Quantity of 11-inch scrapers shipped. Same NULL story as qty_6in.';

-- =========================
-- leads.closed_won_at
-- Stamps when a lead was actually marked won. The dashboard
-- previously approximated "won this year" as
--   status='won' AND last_activity_at >= year_start
-- which is wrong: any note logged on a won lead pushes
-- last_activity_at forward, so a 2024 win bumped into 2025
-- the moment Sean added a follow-up note.
--
-- Backfill strategy: for every currently-won lead, take the
-- max created_at of any web_order activity (the only "won"
-- trigger today), or fall back to last_activity_at when no
-- such activity exists.
--
-- Going forward: the lead-detail "Mark as Won" workflow
-- (currently just updateLeadField('status', 'won')) needs to
-- stamp this column as well. That wiring lives in Step 2 of
-- Phase 4, not in this migration.
-- =========================
ALTER TABLE leads ADD COLUMN IF NOT EXISTS closed_won_at timestamptz;

UPDATE leads l
   SET closed_won_at = COALESCE(
       (SELECT MAX(a.created_at)
          FROM activities a
         WHERE a.lead_id = l.id
           AND a.type = 'web_order'),
       l.last_activity_at
     )
 WHERE l.status = 'won'
   AND l.closed_won_at IS NULL;

COMMENT ON COLUMN leads.closed_won_at IS
  'When the lead transitioned to status=won. Stamped by the lead-detail Mark-as-Won handler going forward; backfilled by migration 018 for existing won leads. Drives the dashboard Wins-This-Year tile and /portal/analytics/won/<year>.';

-- Hot path: /portal/analytics/won/<year> filters won leads
-- by closed_won_at year. Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_leads_closed_won_at
  ON leads(closed_won_at DESC)
  WHERE status = 'won';
