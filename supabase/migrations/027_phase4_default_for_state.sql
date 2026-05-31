-- ============================================================
-- Klein Manufacturing LLC — Conversation-Aware Build Plan
--                            Phase 4, Step 2: state-level defaults
--
-- Adds prompt_templates.default_for_state so each conversation
-- state can name one fallback template. The classifier
-- (lib/portal/classify-lead.ts) resolves its suggested prompt
-- title first; when the title doesn't match (or it returned the
-- NEEDS_NEW_PROMPT sentinel), it falls back to the template whose
-- default_for_state equals the lead's conversation_state. The
-- classifier's state output stays source-of-truth — the fallback
-- only fills the prompt so the NEEDS_NEW_PROMPT banner drains.
--
-- Additive only. No drops, no renames. Idempotent.
-- ============================================================

ALTER TABLE prompt_templates
  ADD COLUMN IF NOT EXISTS default_for_state text;

COMMENT ON COLUMN prompt_templates.default_for_state IS
  'Conversation state (leads.conversation_state) this template is the default prompt for. NULL = not a state default. At most one template per state (partial unique index).';

-- At most one default template per conversation state.
CREATE UNIQUE INDEX IF NOT EXISTS prompt_templates_default_for_state_unique
  ON prompt_templates (default_for_state)
  WHERE default_for_state IS NOT NULL;

-- Seed the 8 state → default-template mappings by exact title.
-- Titles use em-dashes (—); they must match the rows in
-- prompt_templates exactly. Re-running is safe (idempotent UPDATEs).
UPDATE prompt_templates SET default_for_state = 'awaiting_reply'
  WHERE title = 'Gentle Nudge — 2nd Follow-Up';
UPDATE prompt_templates SET default_for_state = 'replied_affirmative'
  WHERE title = 'Address Request — They Said Yes to Samples';
UPDATE prompt_templates SET default_for_state = 'replied_objection'
  WHERE title = 'Objection — Already Have a Vendor';
UPDATE prompt_templates SET default_for_state = 'replied_not_interested'
  WHERE title = 'Polite Close — Not Interested';
UPDATE prompt_templates SET default_for_state = 'samples_in_transit'
  WHERE title = 'Shipping Notification — Samples on the Way';
UPDATE prompt_templates SET default_for_state = 'samples_received'
  WHERE title = 'Check-In — How Are the Scrapers Holding Up?';
UPDATE prompt_templates SET default_for_state = 'asked_question'
  WHERE title = 'More Info — Product Details + Sample Offer';
UPDATE prompt_templates SET default_for_state = 'long_cold'
  WHERE title = 'Quarterly Check-In — Staying in Touch';
