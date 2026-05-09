-- ============================================================
-- Klein Manufacturing LLC — Phase 1: Today Workflow
-- Adds the schema underneath /portal/today and the
-- GET /api/today-queue endpoint Cowork will consume.
--
-- Additive only. No drops. No renames. Safe to run on prod.
-- ============================================================

-- =========================
-- leads: denormalized contact fields
-- The Today page queue queries leads by follow_up_date and renders
-- email / LinkedIn URL / thread-id directly on each card. Keeping
-- these on leads (rather than joining contacts) means a single
-- indexed scan to build the queue.
-- =========================
ALTER TABLE leads ADD COLUMN IF NOT EXISTS email              text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS linkedin_url       text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS linkedin_thread_id text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone              text;

-- =========================
-- activities: structured prompt reference
-- Replaces the free-text prompt_used column going forward. The
-- legacy text column stays for backwards compatibility and is
-- backfilled by scripts/backfill-prompt-ids.ts in Step 3.
-- =========================
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS prompt_id uuid
  REFERENCES prompt_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN activities.prompt_used IS
  'DEPRECATED — kept for backwards compatibility. Use activities.prompt_id (FK to prompt_templates) for new writes. Backfilled by scripts/backfill-prompt-ids.ts.';

-- =========================
-- Indexes
-- idx_leads_follow_up already exists on leads(follow_up_date) from
-- migration 001 — not recreating under the spec name.
-- =========================
CREATE INDEX IF NOT EXISTS idx_leads_linkedin_thread_id
  ON leads(linkedin_thread_id)
  WHERE linkedin_thread_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activities_prompt_id
  ON activities(prompt_id)
  WHERE prompt_id IS NOT NULL;
