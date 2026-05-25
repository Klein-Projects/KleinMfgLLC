-- =========================
-- leads.status: allow 'pending_ship'
-- Sits between 'quoted' and 'won' in the lifecycle. Lands here
-- when a paid web order is auto-attributed to a lead but the
-- order has not yet been marked shipped. mark-shipped flips the
-- lead to 'won' (and stamps closed_won_at) once tracking is in
-- hand. Samples never use this status — they go straight to
-- 'sample_sent'.
-- =========================
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_status_check CHECK (
  status = ANY (ARRAY[
    'new', 'invited', 'contacted', 'engaged', 'sample_sent',
    'quoted', 'pending_ship', 'won', 'lost', 'nurture'
  ])
);
