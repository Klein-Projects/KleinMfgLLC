-- ============================================================
-- Klein Manufacturing LLC — Phase 1 Step 3a: Cadence Rules
-- Replaces the static stage→category prompt picker and the
-- universal +7-days bump with a configurable cadence-rules
-- engine, editable from /portal/settings/cadence.
--
-- Additive only. No drops, no renames.
-- ============================================================

-- =========================
-- activities.direction
-- Needed by the Today queue's "skip responsive leads" filter.
-- Default outbound so existing rows are unchanged. Phase 1.5/2's
-- DM scraper will tag inbound messages explicitly.
-- =========================
ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'outbound';

ALTER TABLE activities
  DROP CONSTRAINT IF EXISTS activities_direction_check;

ALTER TABLE activities
  ADD CONSTRAINT activities_direction_check
  CHECK (direction IN ('inbound', 'outbound'));

COMMENT ON COLUMN activities.direction IS
  'Direction of the activity from Sean''s perspective. Defaults to outbound. Phase 1.5/2''s LinkedIn DM scraper writes inbound rows.';

-- =========================
-- leads.connection_accepted_at
-- Timestamp of when the lead accepted Sean's LinkedIn connection
-- request. Captured precisely by Phase 1.5's accept-reconciliation;
-- backfilled below as a best-effort proxy for existing contacted
-- leads so the cadence engine can fire on day one.
-- =========================
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS connection_accepted_at timestamptz;

UPDATE leads
   SET connection_accepted_at = COALESCE(
         (SELECT MIN(created_at) FROM activities a WHERE a.lead_id = leads.id),
         leads.created_at
       )
 WHERE status = 'contacted'
   AND connection_accepted_at IS NULL;

-- =========================
-- cadence_rules
-- Each row is a single fire of an outbound message: a trigger
-- event + a delay + a prompt to use + an optional action when
-- it sends. Editable from /portal/settings/cadence.
-- =========================
CREATE TABLE cadence_rules (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name               text        NOT NULL,
  trigger_event      text        NOT NULL
    CHECK (trigger_event IN ('connection_accepted', 'sample_delivered')),
  days_after_trigger integer     NOT NULL CHECK (days_after_trigger >= 0),
  prompt_id          uuid        NOT NULL
    REFERENCES prompt_templates(id) ON DELETE RESTRICT,
  action_on_send     text        NOT NULL DEFAULT 'none'
    CHECK (action_on_send IN ('none', 'mark_lost')),
  active             boolean     NOT NULL DEFAULT true,
  display_order      integer     NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cadence_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated full access" ON cadence_rules
  FOR ALL USING (auth.uid() IS NOT NULL);

CREATE POLICY "service_role full" ON cadence_rules
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Hot-path index: the queue walks active rules per trigger.
CREATE INDEX idx_cadence_rules_trigger_active
  ON cadence_rules(trigger_event, display_order)
  WHERE active;

-- Lookup: when a lead surfaces, we may need to re-resolve a rule
-- by prompt_id during the "already fired" check.
CREATE INDEX idx_cadence_rules_prompt_id
  ON cadence_rules(prompt_id);

-- =========================
-- Seed five rules. Fails loudly if any prompt title can't be
-- resolved or returns multiple matches.
--
-- NOTE: Spec asked for "Follow-Up — 1 Week After Connect (General)"
-- on the 3-Day Acceptance rule. That title does not exist in
-- prompt_templates; "Follow-Up — 3 Days After Connect (General)"
-- does and matches the 3-day trigger. Substituted at write time
-- with explicit confirmation from Sean.
-- =========================
DO $$
DECLARE
  p_3day_after_connect uuid;
  p_gentle_nudge       uuid;
  p_final_checkin      uuid;
  p_post_received      uuid;
  p_holding_up         uuid;
BEGIN
  SELECT id INTO STRICT p_3day_after_connect
    FROM prompt_templates
   WHERE title = 'Follow-Up — 3 Days After Connect (General)';

  SELECT id INTO STRICT p_gentle_nudge
    FROM prompt_templates
   WHERE title = 'Gentle Nudge — 2nd Follow-Up';

  SELECT id INTO STRICT p_final_checkin
    FROM prompt_templates
   WHERE title = 'Final Check-In — No Reply';

  SELECT id INTO STRICT p_post_received
    FROM prompt_templates
   WHERE title = 'Follow-Up — After Samples Were Received';

  SELECT id INTO STRICT p_holding_up
    FROM prompt_templates
   WHERE title = 'Check-In — How Are the Scrapers Holding Up?';

  INSERT INTO cadence_rules
    (name,                             trigger_event,         days_after_trigger, prompt_id,            action_on_send, display_order)
  VALUES
    ('3-Day Acceptance Follow-Up',     'connection_accepted',  3, p_3day_after_connect, 'none',      10),
    ('14-Day Acceptance Follow-Up',    'connection_accepted', 14, p_gentle_nudge,       'none',      20),
    ('30-Day Final Touch',             'connection_accepted', 30, p_final_checkin,      'mark_lost', 30),
    ('7-Day Post-Delivery Check-In',   'sample_delivered',     7, p_post_received,      'none',      10),
    ('14-Day Post-Delivery Check-In',  'sample_delivered',    14, p_holding_up,         'none',      20);

EXCEPTION
  WHEN no_data_found THEN
    RAISE EXCEPTION
      'Cadence seed failed: at least one prompt_templates.title returned zero rows. Verify the five seed titles exist before re-running.';
  WHEN too_many_rows THEN
    RAISE EXCEPTION
      'Cadence seed failed: at least one prompt_templates.title returned more than one row. Resolve duplicates before re-running.';
END $$;
