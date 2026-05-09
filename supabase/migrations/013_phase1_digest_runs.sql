-- ============================================================
-- Klein Manufacturing LLC — Phase 1 (V2.3): Digest Runs
-- Idempotency table for the 3:30pm Pacific Today digest.
--
-- Vercel Cron schedules in UTC, so we register two daily UTC
-- slots (22:30 PDT, 23:30 PST) and let the route's local-time
-- guard pick the correct one for the day. This table guarantees
-- the digest only ships once per Pacific calendar date even if
-- both slots happen to fire (DST transitions, retries, manual
-- trigger races, etc.).
--
-- Additive only. No drops, no renames.
-- ============================================================

CREATE TABLE IF NOT EXISTS digest_runs (
  pacific_date    date        PRIMARY KEY,
  sent_at         timestamptz NOT NULL DEFAULT now(),
  cards_sent      integer     NOT NULL,
  total_in_queue  integer     NOT NULL,
  resend_id       text,
  recipients      text        NOT NULL,
  notes           text
);

ALTER TABLE digest_runs ENABLE ROW LEVEL SECURITY;

-- service_role only. The cron route runs with the service role
-- key; no user session ever needs to read or write this table.
CREATE POLICY "service_role full" ON digest_runs
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE digest_runs IS
  'One row per Pacific calendar date the 3:30pm digest was sent. Used as the idempotency guard for the /api/cron/today-digest route — INSERT must succeed before Resend is called.';

COMMENT ON COLUMN digest_runs.pacific_date IS
  'Local America/Los_Angeles calendar date the digest was sent for. Primary key — UNIQUE prevents double-send.';
