-- ============================================================
-- Klein Manufacturing LLC — Promo Codes
-- Discount codes for the scraper checkout (Phase 15I)
-- ============================================================

-- =========================
-- TABLE: promo_codes
-- Per-product discount codes redeemable on /order
-- =========================
CREATE TABLE promo_codes (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code               text UNIQUE NOT NULL,
  discount_type      text NOT NULL
    CHECK (discount_type IN ('percent', 'amount')),
  discount_value_6   numeric NOT NULL,
  discount_value_11  numeric NOT NULL,
  is_active          boolean DEFAULT true,
  label              text,
  created_at         timestamptz DEFAULT now()
);

-- Track which promo (if any) was applied to a Stripe order
ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_code text;


-- ============================================================
-- ROW LEVEL SECURITY
-- service_role only — validation runs server-side
-- ============================================================
ALTER TABLE promo_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role select" ON promo_codes
  FOR SELECT
  TO service_role
  USING (true);

CREATE POLICY "service_role insert" ON promo_codes
  FOR INSERT
  TO service_role
  WITH CHECK (true);


-- ============================================================
-- INDEXES
-- ============================================================
CREATE INDEX idx_promo_codes_active ON promo_codes(is_active);


-- ============================================================
-- SEED: RealClean partner code
-- ============================================================
INSERT INTO promo_codes (code, discount_type, discount_value_6, discount_value_11, label)
VALUES ('RealClean', 'amount', 6.00, 6.50, 'RealClean Aircraft Detailing');
