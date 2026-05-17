-- ============================================================
-- Klein Manufacturing LLC — Conversation-Aware Build Plan
--                            Phase 1, Step 2: activities.body
--
-- Adds a nullable `body` column to activities so the LinkedIn
-- DM scraper (and any other source) can persist the full
-- message body alongside the existing short `summary` preview.
--
-- summary stays as the 120-char preview displayed in compact
-- contexts (Today queue, dashboards). body is rendered on the
-- lead detail page activity log when present, falling back to
-- summary when absent — so existing rows continue to render
-- unchanged.
--
-- Additive only. No drops, no renames. Safe to run on prod.
-- Idempotent — re-running is a no-op.
-- ============================================================

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS body text;

COMMENT ON COLUMN activities.body IS
  'Full message body when available (e.g. complete LinkedIn DM text). Nullable; readers should fall back to summary when absent. summary remains the short 120-char preview for compact list views.';
