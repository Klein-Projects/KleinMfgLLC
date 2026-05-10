-- ============================================================
-- Klein Manufacturing LLC — Phase 1.5 follow-up:
--                            Cowork run summaries
--
-- Replaces the Cowork-side Gmail draft summary email with an
-- in-portal dashboard panel. Cowork's scheduled tasks now POST
-- a run summary to /api/cowork/run-summary at the end of each
-- run (dry-run or live). The portal stages it here; Sean sees
-- it in the "Recent Cowork activity" panel on /portal/today and
-- dismisses it when he's done reading.
--
-- Additive only. No drops, no renames. Safe to run on prod.
-- ============================================================

CREATE TABLE IF NOT EXISTS cowork_run_summaries (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id       text        NOT NULL,
  run_count     int         NOT NULL,
  run_mode      text        NOT NULL CHECK (run_mode IN ('dry_run', 'live')),
  observed_at   timestamptz NOT NULL,
  summary       jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  dismissed_at  timestamptz,
  dismissed_by  text
);

COMMENT ON TABLE cowork_run_summaries IS
  'Run-completion summaries posted by Cowork scheduled tasks. The "Recent Cowork activity" panel on /portal/today shows undismissed rows.';

COMMENT ON COLUMN cowork_run_summaries.task_id IS
  'Allowlisted task identifier. Set by /api/cowork/run-summary; rejected if not in the per-version allowlist (klein-sent-invitations-scraper for Phase 1.5).';

COMMENT ON COLUMN cowork_run_summaries.run_mode IS
  'dry_run = Cowork did not POST scraped data downstream; live = it did. Surfaced as a pill in the dashboard panel.';

COMMENT ON COLUMN cowork_run_summaries.summary IS
  'Free-form jsonb. Common fields the panel reads when present: kept_invitations[], filtered_as_noise[], post_status, post_response_snippet, errors[]. New tasks can add fields without a migration.';

ALTER TABLE cowork_run_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access" ON cowork_run_summaries
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "service_role full" ON cowork_run_summaries
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Hot path: dashboard panel loads "undismissed, newest first"
-- on every /portal/today render and every 60s thereafter.
-- Postgres treats nulls as "larger" by default in DESC ordering,
-- so dismissed_at NULL rows naturally sort first.
CREATE INDEX IF NOT EXISTS idx_cowork_run_summaries_undismissed
  ON cowork_run_summaries(dismissed_at, created_at DESC);
