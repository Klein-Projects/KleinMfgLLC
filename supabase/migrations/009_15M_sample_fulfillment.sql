-- ============================================================
-- Klein Manufacturing LLC — Unified sample fulfillment
-- Phase 15M.1: extend orders + sample_requests so samples ride
-- the same EasyPost pipeline as paid web orders.
-- ============================================================

-- =========================
-- sample_requests: structured shipping fields
-- All NULLABLE so the existing 16 rows stay valid.
-- The legacy free-form shipping_address column is preserved for
-- backward compatibility; new rows populate both.
-- =========================
ALTER TABLE sample_requests
  ADD COLUMN shipping_address_line1 text,
  ADD COLUMN shipping_address_line2 text,
  ADD COLUMN shipping_city          text,
  ADD COLUMN shipping_state         text,
  ADD COLUMN shipping_zip           text;

-- =========================
-- orders: sample-fulfillment hooks
-- is_sample marks $0 sample rows so the 15L endpoints can
-- branch on side-effects (CRM shipments row, sample_sent
-- activity, sample-tailored tracking email).
-- sample_request_id back-points to the originating request.
-- =========================
ALTER TABLE orders
  ADD COLUMN is_sample          boolean NOT NULL DEFAULT false,
  ADD COLUMN sample_request_id  uuid REFERENCES sample_requests(id)
                                  ON DELETE SET NULL;

-- =========================
-- INDEX
-- Powers the "Open Sample Requests" queue on
-- /portal/shipments → Sample Tracking tab. Partial so it stays
-- tiny and only covers rows the queue actually reads.
-- =========================
CREATE INDEX idx_orders_open_samples
  ON orders(created_at)
  WHERE is_sample = true
    AND shipping_status IN ('pending','label_purchased');
