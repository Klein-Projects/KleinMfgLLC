-- ============================================================
-- Klein Manufacturing LLC — Orders Table
-- Stripe checkout orders from KleinMFGLLC.com
-- ============================================================

-- =========================
-- TABLE: orders
-- Stripe checkout orders for 6" and 11" scrapers
-- =========================
CREATE TABLE orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at               timestamptz NOT NULL DEFAULT now(),

  -- Customer info
  customer_name            text NOT NULL,
  customer_email           text NOT NULL,
  customer_phone           text,
  company_name             text,

  -- Shipping address
  shipping_address_line1   text NOT NULL,
  shipping_address_line2   text,
  shipping_city            text NOT NULL,
  shipping_state           text NOT NULL,
  shipping_zip             text NOT NULL,

  -- Line items (qty of each SKU)
  product_6in_qty          integer NOT NULL DEFAULT 0,
  product_11in_qty         integer NOT NULL DEFAULT 0,

  -- Shipping method
  shipping_method          text NOT NULL
    CHECK (shipping_method IN ('klein_ups', 'collect')),
  carrier_type             text
    CHECK (carrier_type IN ('UPS', 'FedEx')),
  carrier_account_number   text,

  -- Money (USD)
  shipping_cost            numeric(10,2) NOT NULL DEFAULT 0,
  subtotal                 numeric(10,2) NOT NULL,
  cc_fee                   numeric(10,2) NOT NULL,
  total_charged            numeric(10,2) NOT NULL,

  -- Stripe references
  stripe_session_id        text UNIQUE,
  stripe_payment_intent_id text,

  -- Order lifecycle
  status                   text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled'))
);


-- ============================================================
-- ROW LEVEL SECURITY
-- service_role only — no anon, no authenticated
-- (service_role bypasses RLS by default; explicit policies
--  documented below for clarity and defense in depth)
-- ============================================================
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role insert" ON orders
  FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "service_role select" ON orders
  FOR SELECT
  TO service_role
  USING (true);


-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_orders_status            ON orders(status);
CREATE INDEX idx_orders_created_at        ON orders(created_at DESC);
CREATE INDEX idx_orders_stripe_session    ON orders(stripe_session_id);
CREATE INDEX idx_orders_customer_email    ON orders(customer_email);
