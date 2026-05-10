-- ============================================================
-- Klein Manufacturing LLC — Phase 2: LinkedIn DM Scraper
--                                   + Review Queue UI
--
-- review_queue itself was added in 014 (Phase 1.5) so the
-- 10pm sent-invitations scraper had somewhere to land its
-- new_lead proposals before Phase 2 lit up the UI. This
-- migration is intentionally tiny — it adds the one column
-- the morning DM scraper needs to do incremental pulls and
-- nothing else.
--
-- Additive only. No drops. No renames. Safe to run on prod.
-- Idempotent — re-running is a no-op.
-- ============================================================

-- =========================
-- leads.last_inbox_sync_at
--
-- Stamped by /api/inbox-sync each successful run for every
-- lead the scraper observed. The 7am DM scraper reads this
-- (via GET /api/leads/last-sync-meta or the per-lead value
-- on its skip-list) so it can filter messages on subsequent
-- runs to "newer than the most recent sync" rather than
-- re-walking the full thread history each morning.
-- =========================
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_inbox_sync_at timestamptz;

COMMENT ON COLUMN leads.last_inbox_sync_at IS
  'Most recent timestamp the Phase 2 DM scraper observed this lead. Set by /api/inbox-sync on every run regardless of whether new proposals were generated. Drives incremental scraping so consecutive 7am runs do not re-walk old thread history.';
