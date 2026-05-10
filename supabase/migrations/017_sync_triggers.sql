-- ============================================================
-- Klein Manufacturing LLC — Sync polling pattern (Option 3)
--
-- Replaces the Cowork-side webhook design that was never built
-- with a polling pattern: clicking "Sync now" in /portal/settings/sync
-- inserts a row here; a Cowork scheduled task (klein-sync-poller)
-- polls every 5 minutes, dispatches the matching scrape, and marks
-- the row complete. Latency between click and run is up to ~5 min,
-- which is fine for an on-demand button.
--
-- Additive only. No drops, no renames. Safe to run on prod.
-- Idempotent — re-running is a no-op.
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_triggers (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       text        NOT NULL CHECK (
                              task_id IN ('sent-invitations', 'dm-inbox')
                            ),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  requested_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  fire_status   text        NOT NULL DEFAULT 'queued' CHECK (
                              fire_status IN ('queued', 'firing', 'complete', 'failed')
                            ),
  fired_at      timestamptz,
  finished_at   timestamptz,
  fire_error    text,
  run_summary   jsonb
);

COMMENT ON TABLE sync_triggers IS
  'On-demand Sync-now requests from /portal/settings/sync. The klein-sync-poller scheduled task polls this every ~5 min, picks up queued rows, runs the matching scrape, and writes back fire_status. Replaces the original webhook-URL design (COWORK_TRIGGER_*_URL env vars) that was never wired up.';

COMMENT ON COLUMN sync_triggers.task_id IS
  'Which scrape to run. sent-invitations = the 10pm scraper. dm-inbox = the 7am DM scraper. Other tasks (deep sweep, etc.) are not currently exposed as on-demand triggers.';

COMMENT ON COLUMN sync_triggers.fire_status IS
  'queued = waiting for the poller. firing = poller has claimed it and is running the scrape. complete = scrape finished, see run_summary. failed = scrape errored, see fire_error and run_summary.';

-- Hot path: the poller only ever fetches queued rows. Partial index
-- keeps the lookup tiny even after years of completed runs.
CREATE INDEX IF NOT EXISTS idx_sync_triggers_pending
  ON sync_triggers(task_id, requested_at)
  WHERE fire_status = 'queued';

-- For the Sync page's "last run" display (most recent of any status).
CREATE INDEX IF NOT EXISTS idx_sync_triggers_recent
  ON sync_triggers(task_id, requested_at DESC);

ALTER TABLE sync_triggers ENABLE ROW LEVEL SECURITY;

-- Authenticated users (Sean) can see and create triggers. The poller
-- task uses the service role to update fire_status, so that path
-- bypasses RLS via the service-role policy below.
CREATE POLICY "Authenticated read" ON sync_triggers
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated insert" ON sync_triggers
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "service_role full" ON sync_triggers
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
