-- ============================================================
-- Klein Manufacturing LLC — Site Settings (Phase 15J)
-- Runtime-editable site config (list prices, etc.)
-- ============================================================

CREATE TABLE site_settings (
  key        text PRIMARY KEY,
  value      text NOT NULL,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO site_settings (key, value) VALUES
  ('list_price_6',  '21.00'),
  ('list_price_11', '23.00');


-- ============================================================
-- ROW LEVEL SECURITY
-- service_role: full access (server APIs)
-- authenticated: read + write (portal admins)
-- ============================================================
ALTER TABLE site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full" ON site_settings
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "authenticated full" ON site_settings
  FOR ALL
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
