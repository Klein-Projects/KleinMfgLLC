-- ============================================================
-- Klein Manufacturing LLC — Phase 1.5: Outreach Capture
--
-- Closes the cold-outreach blind spot: every connection request
-- Sean sends becomes a lead with status='invited' the moment it
-- goes out, with the prompt attached and the date stamped.
--
-- Adds the long-term snooze ("Park lead") mechanism so leads
-- with a future wake_up_at drop off the Today queue entirely
-- and resurface automatically.
--
-- Lands the review_queue table additively so Phase 2's
-- /portal/review-queue UI and approve/reject endpoints can
-- light it up without another migration. Phase 1.5's
-- POST /api/sent-invitations-sync inserts kind='new_lead'
-- proposals here.
--
-- Adds activities.source so Phase 1.5's log-invitation can
-- tag rows 'outreach_page' per the API contract; defaults to
-- 'manual' so existing writers (e.g. mark-contacted, the
-- activity-log form) need no change.
--
-- Additive only. No drops, no renames. Safe to run on prod.
-- ============================================================

-- =========================
-- leads.status: allow 'invited'
-- Sits between 'new' and 'contacted' in the lifecycle. Covers
-- the slice between "connection request sent" and "they
-- accepted". Today queue excludes this status (already handled
-- in TODAY_EXCLUDED_STATUSES, see lib/portal/today-queue.ts).
-- =========================
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (
  status = ANY (ARRAY[
    'new', 'invited', 'contacted', 'engaged', 'sample_sent',
    'quoted', 'won', 'lost', 'nurture'
  ])
);

-- =========================
-- activities.type: allow 'connection_request'
-- Distinct from 'linkedin_message' so the connection-request
-- send fires (Phase 1.5) and post-accept follow-ups
-- (Phase 1) can be told apart in analytics.
-- =========================
ALTER TABLE activities DROP CONSTRAINT IF EXISTS activities_type_check;
ALTER TABLE activities ADD CONSTRAINT activities_type_check CHECK (
  type = ANY (ARRAY[
    'linkedin_message', 'connection_request', 'email', 'phone',
    'note', 'sample_sent', 'follow_up', 'web_order'
  ])
);

-- =========================
-- leads.invited_at
-- Stamped by /api/leads/log-invitation when a brand-new lead
-- is created from /portal/outreach, and by sent-invitations-sync
-- approvals when the 10pm scraper fills in cold outreach Sean
-- did from his phone.
-- =========================
ALTER TABLE leads ADD COLUMN IF NOT EXISTS invited_at timestamptz;

COMMENT ON COLUMN leads.invited_at IS
  'When Sean sent the LinkedIn connection request. Set by /portal/outreach (real time) or by approving a sent-invitations-scraper proposal in the review queue. Distinct from connection_accepted_at, which Phase 2 stamps when the prospect actually accepts.';

-- =========================
-- leads.wake_up_at + wake_up_reason ("Park lead")
-- Long-term snooze. While wake_up_at > now(), the Today queue
-- skips the lead entirely. Cleared by setting wake_up_at = NULL.
-- Sean parks leads who say "not now, talk to me in three months"
-- with a free-text reason for context.
-- =========================
ALTER TABLE leads ADD COLUMN IF NOT EXISTS wake_up_at     timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS wake_up_reason text;

COMMENT ON COLUMN leads.wake_up_at IS
  'Long-term snooze target. While wake_up_at > now(), the Today queue (lib/portal/today-queue.ts) skips this lead. Set NULL to unpark.';
COMMENT ON COLUMN leads.wake_up_reason IS
  'Free-text note paired with wake_up_at, shown on lead detail (e.g. "Said wait until Q3 budget reset").';

-- =========================
-- activities.source
-- Tags where each activity row originated. Phase 1.5's
-- log-invitation writes 'outreach_page'; sent-invitations-sync
-- approvals write 'sent_invitations_scraper'; today-page's
-- mark-contacted writes 'today_page' (when updated). Default
-- 'manual' covers the legacy lead-detail activity-log form
-- and existing rows.
-- =========================
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

COMMENT ON COLUMN activities.source IS
  'Origin of the activity row. Known values: manual (lead-detail form), today_page (mark-contacted), outreach_page (log-invitation), sent_invitations_scraper, dm_inbox_scraper (Phase 2). No CHECK constraint — additive open enum.';

-- =========================
-- Indexes
-- =========================
-- Hot-path: /portal/outreach client-side dedupe + the 10pm
-- scraper's skip-list both query "give me invited leads".
CREATE INDEX IF NOT EXISTS idx_leads_status_invited
  ON leads(invited_at DESC)
  WHERE status = 'invited';

-- Today queue's wake-up filter walks "any lead with a
-- non-null future wake_up_at". Partial index keeps it tight.
CREATE INDEX IF NOT EXISTS idx_leads_wake_up_at
  ON leads(wake_up_at)
  WHERE wake_up_at IS NOT NULL;

-- =========================
-- review_queue (lands in Phase 1.5; Phase 2 lights up the UI)
--
-- Every scraper-sourced change routes through this table so
-- Sean approves before it touches production data. Phase 1.5's
-- sent-invitations-sync inserts kind='new_lead' proposals;
-- Phase 2's inbox-sync inserts the rest. Phase 2 builds the
-- approve/reject endpoints and the /portal/review-queue page.
-- =========================
CREATE TABLE IF NOT EXISTS review_queue (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  kind                text        NOT NULL
    CHECK (kind IN (
      'new_lead', 'new_activity', 'stage_change',
      'update_contact', 'set_wake_up'
    )),
  source              text        NOT NULL DEFAULT 'linkedin_dm_scraper',
  payload             jsonb       NOT NULL,
  lead_id             uuid        REFERENCES leads(id) ON DELETE SET NULL,
  linkedin_thread_id  text,
  status              text        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_at          timestamptz,
  decided_by          uuid        REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE review_queue IS
  'Staging table for scraper-proposed changes. Sean approves each row from /portal/review-queue (Phase 2). Phase 1.5 inserts kind=new_lead from the 10pm sent-invitations scraper.';

ALTER TABLE review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access" ON review_queue
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "service_role full" ON review_queue
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Hot path: /portal/review-queue lists pending items by recency.
CREATE INDEX IF NOT EXISTS idx_review_queue_pending_created
  ON review_queue(created_at DESC)
  WHERE status = 'pending';

-- Dedupe path: sent-invitations-sync and inbox-sync both look up
-- existing pending proposals by linkedin_thread_id when scraping
-- on consecutive runs.
CREATE INDEX IF NOT EXISTS idx_review_queue_thread_pending
  ON review_queue(linkedin_thread_id)
  WHERE status = 'pending' AND linkedin_thread_id IS NOT NULL;

-- Dedupe path 2: sent-invitations-sync looks up by linkedin_url
-- inside the JSON payload. Use a functional index so the per-run
-- skip-list query stays cheap as the queue grows.
CREATE INDEX IF NOT EXISTS idx_review_queue_payload_linkedin_url_pending
  ON review_queue((payload->>'linkedin_url'))
  WHERE status = 'pending';
