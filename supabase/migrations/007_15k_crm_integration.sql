-- ============================================================
-- Klein Manufacturing LLC — CRM integration for web orders
-- Phase 15K: wire Stripe orders into the sales portal pipeline
-- ============================================================

-- =========================
-- discount_codes.company_id
-- Optional FK so a discount code can be tied to a customer account.
-- When a tied code is used at checkout, the order auto-attributes
-- to that company's lead.
-- =========================
ALTER TABLE discount_codes
  ADD COLUMN company_id uuid REFERENCES companies(id) ON DELETE SET NULL;

CREATE INDEX idx_discount_codes_company ON discount_codes(company_id);

-- =========================
-- orders.company_name (defensive — already created in 002)
-- =========================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS company_name text;

-- =========================
-- activities: allow 'web_order' type
-- =========================
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_type_check CHECK (
  type = ANY (ARRAY[
    'linkedin_message','email','phone','note',
    'sample_sent','follow_up','web_order'
  ])
);

-- =========================
-- web_order_review
-- Manual review queue: a row lands here when a Stripe order can't
-- be auto-attributed to a contact/lead by promo or email.
-- =========================
CREATE TABLE web_order_review (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid REFERENCES orders(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  resolved    boolean DEFAULT false,
  notes       text
);

ALTER TABLE web_order_review ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access" ON web_order_review
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "service_role full" ON web_order_review
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX idx_web_order_review_unresolved
  ON web_order_review(created_at DESC)
  WHERE NOT resolved;
