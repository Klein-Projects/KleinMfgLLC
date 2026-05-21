-- ============================================================
-- Klein Manufacturing LLC — Phantom-Activity Bug Fix
--                            activities.linkedin_message_urn
--
-- The 7am LinkedIn DM scraper was stamping every message it
-- captured with the scraper's run-date (now()) instead of the
-- real send timestamp. The inbox-sync dedupe key was per-thread,
-- not per-message — so an old DM in a previously-synced thread
-- would re-enter the review queue every morning, get approved,
-- and create a phantom activity row dated today.
--
-- The real fix is a stable per-message identifier. LinkedIn
-- assigns each message a globally-unique URN of the form:
--   urn:li:msg_message:(urn:li:fsd_profile:XXXX,2-<base64>)
-- The scraper now emits that URN inside every new_activity
-- proposal as `linkedin_message_urn`. This column persists it
-- on the activities row and a UNIQUE partial index makes
-- duplicate inserts impossible at the database level.
--
-- Partial index (WHERE linkedin_message_urn IS NOT NULL) so
-- the millions of existing rows with NULL urn don't collide
-- with each other. The URN is globally unique on LinkedIn's
-- side, so no need to scope by lead_id or thread_id.
--
-- Additive only. No drops, no renames. Safe to run on prod.
-- Idempotent — re-running is a no-op.
-- ============================================================

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS linkedin_message_urn text;

COMMENT ON COLUMN activities.linkedin_message_urn IS
  'Stable globally-unique LinkedIn message URN (e.g. urn:li:msg_message:(urn:li:fsd_profile:XXXX,2-<base64>)). Used as the dedupe key by /api/inbox-sync so repeated scraper runs do not produce phantom duplicate activity rows. NULL on rows logged before this column existed and on non-LinkedIn activities (email, phone, note, sample_sent, follow_up).';

CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_linkedin_message_urn
  ON activities (linkedin_message_urn)
  WHERE linkedin_message_urn IS NOT NULL;
