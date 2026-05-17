-- ============================================================
-- Klein Manufacturing LLC — Conversation-Aware Build Plan
--                            Phase 2, Step 1: classifier
--
-- Adds the per-lead classifier output columns. The Haiku
-- classifier reads each lead's recent activity and writes back:
--
--   conversation_state   — one of:
--                          awaiting_reply, replied_affirmative,
--                          replied_objection, replied_not_interested,
--                          samples_in_transit, samples_received,
--                          asked_question, long_cold
--                          (enum from Phase 0, Decision 1 — kept
--                          as plain text so we can add states
--                          without a migration; app-level validates)
--   suggested_prompt_id  — FK into prompt_templates.id. NULL when
--                          the classifier returned NEEDS_NEW_PROMPT
--                          (Phase 3 surfaces those in a banner via
--                          `state_updated_at IS NOT NULL
--                           AND suggested_prompt_id IS NULL`)
--   state_confidence     — 0.0..1.0. Phase 5 auto-apply threshold
--                          is 0.70 (Phase 0, Decision 2)
--   state_reasoning      — classifier's one-sentence justification
--   state_updated_at     — when the classifier last touched this lead
--
-- Additive only. No drops, no renames. Safe to run on prod.
-- Idempotent — re-running is a no-op.
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS conversation_state text,
  ADD COLUMN IF NOT EXISTS suggested_prompt_id uuid REFERENCES prompt_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS state_confidence numeric,
  ADD COLUMN IF NOT EXISTS state_reasoning text,
  ADD COLUMN IF NOT EXISTS state_updated_at timestamptz;

COMMENT ON COLUMN leads.conversation_state IS
  'Haiku classifier output. One of awaiting_reply, replied_affirmative, replied_objection, replied_not_interested, samples_in_transit, samples_received, asked_question, long_cold. NULL = never classified.';

COMMENT ON COLUMN leads.suggested_prompt_id IS
  'Haiku classifier output. FK into prompt_templates.id, looked up by the title the classifier returns. NULL means either (a) never classified yet, or (b) classifier returned NEEDS_NEW_PROMPT — distinguish via state_updated_at.';

COMMENT ON COLUMN leads.state_confidence IS
  'Haiku classifier confidence 0.0..1.0. Phase 5 auto-apply threshold = 0.70.';

COMMENT ON COLUMN leads.state_reasoning IS
  'Haiku classifier one-sentence justification for the chosen state + prompt.';

COMMENT ON COLUMN leads.state_updated_at IS
  'When the classifier last ran for this lead. Bumped whenever conversation_state is rewritten — including when suggested_prompt_id resolves to NULL.';

-- Phase 3's Today filter chips group leads by conversation_state.
-- The cardinality is low (~8 distinct states) but the query filters
-- inside the active subset, so a plain btree is fine.
CREATE INDEX IF NOT EXISTS idx_leads_conversation_state
  ON leads (conversation_state)
  WHERE conversation_state IS NOT NULL;

-- Phase 3 banner query: leads where the classifier explicitly said
-- it has no template for this conversation.
CREATE INDEX IF NOT EXISTS idx_leads_needs_new_prompt
  ON leads (state_updated_at)
  WHERE state_updated_at IS NOT NULL AND suggested_prompt_id IS NULL;
