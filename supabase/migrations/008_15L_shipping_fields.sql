-- ============================================================
-- Klein Manufacturing LLC — Shipping fulfillment fields
-- Phase 15L.1: add EasyPost shipping columns to orders table
-- ============================================================

-- =========================
-- orders: shipping fulfillment workflow
-- shipping_status drives the /portal/shipments queue.
-- All other columns populate after a label is purchased.
-- =========================
ALTER TABLE orders
  ADD COLUMN shipping_status      text NOT NULL DEFAULT 'pending'
    CHECK (shipping_status IN (
      'pending',
      'label_purchased',
      'shipped',
      'delivered',
      'voided'
    )),
  ADD COLUMN shipment_id          text,           -- EasyPost shipment ID (shp_...)
  ADD COLUMN tracking_code        text,           -- UPS tracking number
  ADD COLUMN carrier              text,           -- "UPSDAP" or "UPS"
  ADD COLUMN service              text,           -- "Ground", "3DaySelect", etc.
  ADD COLUMN rate_amount          numeric(10,2),  -- Amount EasyPost charged for the label
  ADD COLUMN label_format         text,           -- "ZPL" or "PDF"
  ADD COLUMN label_url            text,           -- EasyPost-hosted label URL (backup)
  ADD COLUMN label_zpl            text,           -- Raw ZPL string returned by EasyPost
  ADD COLUMN label_purchased_at   timestamptz,
  ADD COLUMN shipped_at           timestamptz,
  ADD COLUMN voided_at            timestamptz;

-- =========================
-- INDEX
-- Powers the "Ready to Ship" queue query in /portal/shipments.
-- =========================
CREATE INDEX idx_orders_shipping_status ON orders(shipping_status);
