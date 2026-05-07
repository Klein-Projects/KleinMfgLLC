-- ============================================================
-- Klein Manufacturing LLC — Rename promo_codes → discount_codes
-- and add tiered-percentage discount support (Phase 15I.1)
-- ============================================================

-- =========================
-- RENAME: promo_codes → discount_codes
-- =========================
ALTER TABLE promo_codes RENAME TO discount_codes;
ALTER TABLE orders RENAME COLUMN promo_code TO discount_code;
ALTER INDEX IF EXISTS idx_promo_codes_active RENAME TO idx_discount_codes_active;

-- The CHECK constraint was auto-named promo_codes_discount_type_check at create time.
-- Drop it (under either old or new name) and recreate to allow 'tiered_percent'.
ALTER TABLE discount_codes DROP CONSTRAINT IF EXISTS promo_codes_discount_type_check;
ALTER TABLE discount_codes DROP CONSTRAINT IF EXISTS discount_codes_discount_type_check;
ALTER TABLE discount_codes ADD CONSTRAINT discount_codes_discount_type_check
  CHECK (discount_type IN ('percent', 'amount', 'tiered_percent'));

-- Tiered codes leave the per-product columns NULL.
ALTER TABLE discount_codes
  ALTER COLUMN discount_value_6  DROP NOT NULL,
  ALTER COLUMN discount_value_11 DROP NOT NULL;

-- Enforce shape: flat codes need both per-product values; tiered codes have neither.
ALTER TABLE discount_codes ADD CONSTRAINT discount_codes_value_shape_check
  CHECK (
    (discount_type IN ('percent','amount')
       AND discount_value_6 IS NOT NULL AND discount_value_11 IS NOT NULL)
    OR
    (discount_type = 'tiered_percent'
       AND discount_value_6 IS NULL AND discount_value_11 IS NULL)
  );


-- =========================
-- TABLE: discount_code_tiers
-- One row per qty threshold for tiered_percent codes
-- =========================
CREATE TABLE discount_code_tiers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_id     uuid NOT NULL REFERENCES discount_codes(id) ON DELETE CASCADE,
  min_qty     integer NOT NULL CHECK (min_qty > 0),
  percent_off numeric NOT NULL CHECK (percent_off > 0 AND percent_off <= 100),
  created_at  timestamptz DEFAULT now(),
  UNIQUE (code_id, min_qty)
);

CREATE INDEX idx_discount_code_tiers_code ON discount_code_tiers(code_id);


-- ============================================================
-- ROW LEVEL SECURITY (mirrors discount_codes — service_role only)
-- ============================================================
ALTER TABLE discount_code_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role select" ON discount_code_tiers
  FOR SELECT TO service_role USING (true);

CREATE POLICY "service_role insert" ON discount_code_tiers
  FOR INSERT TO service_role WITH CHECK (true);
