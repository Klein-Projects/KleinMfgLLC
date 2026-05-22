-- ============================================================
-- Klein Manufacturing LLC — Clear scraper-generated activity rows
--
-- Sean is rebuilding the LinkedIn activity log from an official
-- LinkedIn data export. To make that the single source of truth
-- we delete every activity row that was inserted by the LinkedIn
-- scrapers, leaving only rows logged manually by Sean (`manual`)
-- or via the /portal/outreach logging page (`outreach_page`).
--
-- Scraper source names matched:
--   * dm_inbox_scraper              — the only scraper source
--                                     currently writing to
--                                     activities.source (per
--                                     inbox-sync and review-queue
--                                     approve routes).
--   * linkedin_dm_scraper           — listed in the Conversation-
--   * deep_sweep_dm_threads           Aware Build Plan v5 as
--   * deep_sweep_connections          planned scraper sources.
--   * deep_sweep_pending_invitations  Included defensively so
--   * sent_invitations_scraper        future scraper rows (if
--                                     they ever land in
--                                     activities) are cleared
--                                     by the same migration.
--
-- Out of scope (intentionally NOT touched):
--   * activities.source = 'manual'         (Sean's manual logs)
--   * activities.source = 'outreach_page'  (logged via portal)
--   * shipments, leads (status), notes, prompt_templates
--   * inbox_sync_proposals (left alone; the scraper will rebuild
--     proposals on the next run if needed)
--
-- Idempotent — re-running deletes 0 rows on a clean slate.
-- Hard delete (no soft-delete column on activities); rebuild
-- comes from the LinkedIn export.
-- ============================================================

DO $$
DECLARE
  v_before_total bigint;
  v_after_total bigint;
  v_deleted bigint;
  rec record;
BEGIN
  -- Pre-delete report: grouped count by source
  RAISE NOTICE '--- Pre-delete scraper-source counts ---';
  FOR rec IN
    SELECT source, COUNT(*) AS row_count
    FROM activities
    WHERE source IN (
      'dm_inbox_scraper',
      'linkedin_dm_scraper',
      'deep_sweep_dm_threads',
      'deep_sweep_connections',
      'deep_sweep_pending_invitations',
      'sent_invitations_scraper'
    )
    GROUP BY source
    ORDER BY source
  LOOP
    RAISE NOTICE '  %: % rows', rec.source, rec.row_count;
  END LOOP;

  SELECT COUNT(*) INTO v_before_total
  FROM activities
  WHERE source IN (
    'dm_inbox_scraper',
    'linkedin_dm_scraper',
    'deep_sweep_dm_threads',
    'deep_sweep_connections',
    'deep_sweep_pending_invitations',
    'sent_invitations_scraper'
  );

  RAISE NOTICE '  TOTAL to delete: %', v_before_total;

  -- Delete
  WITH deleted AS (
    DELETE FROM activities
    WHERE source IN (
      'dm_inbox_scraper',
      'linkedin_dm_scraper',
      'deep_sweep_dm_threads',
      'deep_sweep_connections',
      'deep_sweep_pending_invitations',
      'sent_invitations_scraper'
    )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM deleted;

  -- Post-delete verification
  SELECT COUNT(*) INTO v_after_total
  FROM activities
  WHERE source IN (
    'dm_inbox_scraper',
    'linkedin_dm_scraper',
    'deep_sweep_dm_threads',
    'deep_sweep_connections',
    'deep_sweep_pending_invitations',
    'sent_invitations_scraper'
  );

  RAISE NOTICE '--- Post-delete verification ---';
  RAISE NOTICE '  Rows deleted:           %', v_deleted;
  RAISE NOTICE '  Remaining scraper rows: %', v_after_total;

  IF v_after_total <> 0 THEN
    RAISE EXCEPTION
      'Post-delete check failed: % scraper-source rows remain',
      v_after_total;
  END IF;
END $$;
