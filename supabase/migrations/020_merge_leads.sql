-- Phase 4 cleanup: lead-deduplication helper.
--
-- Two scrapers (linkedin_dm_scraper, sent_invitations_scraper) each
-- created lead rows for the same people, producing ~43 dup groups
-- in the leads table after Sean approved the May 14 batch.
--
-- merge_two_leads(winner, loser):
--   1. Promote non-null fields from loser → winner on both `leads`
--      and `contacts` (the contact row attached to each lead).
--   2. URL upgrade: if winner has an opaque LinkedIn ACoAA-ID URL
--      and loser has the human vanity URL, replace winner's with
--      the vanity. Same for contact-level linkedin_url.
--   3. Status: only promote loser's status if it ranks higher than
--      winner's. Rank: won > sample_sent > quoted > engaged >
--      contacted > nurture > invited > new > lost. `nurture` ranks
--      above `invited` because it's an explicit human classification,
--      not a scraper default.
--   4. Time fields: last_activity_at, last_inbox_sync_at take MAX.
--      invited_at, connection_accepted_at, closed_won_at take MIN
--      (earliest observed truth).
--   5. Notes: concatenated with a separator when both sides have
--      distinct content, otherwise winner-wins.
--   6. Repoint FKs (activities.lead_id is CASCADE — must repoint
--      BEFORE deleting the loser, or activities get wiped).
--      manual_orders/shipments/review_queue are SET NULL but still
--      repointed to preserve attribution.
--   7. Delete the loser lead, then delete the loser contact if it
--      no longer has any lead referencing it.
--
-- Idempotent in the trivial sense: calling it again after a merge
-- returns an error because the loser row no longer exists. That's
-- intentional — the function is destructive on the loser and should
-- not be retried silently.

CREATE OR REPLACE FUNCTION public.merge_two_leads(p_winner uuid, p_loser uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  w RECORD;
  lo RECORD;
  wc RECORD;
  loc RECORD;
  status_rank constant jsonb := jsonb_build_object(
    'won', 9, 'sample_sent', 8, 'quoted', 7, 'engaged', 6,
    'contacted', 5, 'nurture', 4, 'invited', 3, 'new', 2, 'lost', 1
  );
  w_rank int;
  l_rank int;
  resolved_status text;
  resolved_url text;
  contact_still_in_use boolean;
  activities_moved int := 0;
  orders_moved int := 0;
  shipments_moved int := 0;
  queue_moved int := 0;
BEGIN
  IF p_winner IS NULL OR p_loser IS NULL THEN
    RAISE EXCEPTION 'merge_two_leads: winner and loser are both required';
  END IF;
  IF p_winner = p_loser THEN
    RAISE EXCEPTION 'merge_two_leads: winner and loser are the same row';
  END IF;

  SELECT * INTO w FROM leads WHERE id = p_winner FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_two_leads: winner % not found', p_winner; END IF;
  SELECT * INTO lo FROM leads WHERE id = p_loser FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'merge_two_leads: loser % not found', p_loser; END IF;

  IF w.contact_id IS NOT NULL THEN
    SELECT * INTO wc FROM contacts WHERE id = w.contact_id FOR UPDATE;
  END IF;
  IF lo.contact_id IS NOT NULL THEN
    SELECT * INTO loc FROM contacts WHERE id = lo.contact_id FOR UPDATE;
  END IF;

  -- Contact-level merge: if both leads have distinct contacts, promote
  -- nulls from loser contact → winner contact. If winner has no contact,
  -- adopt loser's wholesale (and skip the later contact-delete step).
  IF w.contact_id IS NOT NULL AND lo.contact_id IS NOT NULL AND w.contact_id <> lo.contact_id THEN
    UPDATE contacts SET
      title             = COALESCE(wc.title, loc.title),
      email             = COALESCE(wc.email, loc.email),
      phone             = COALESCE(wc.phone, loc.phone),
      linkedin_url      = CASE
                            WHEN wc.linkedin_url IS NULL THEN loc.linkedin_url
                            WHEN wc.linkedin_url LIKE '%ACoAA%' AND loc.linkedin_url IS NOT NULL AND loc.linkedin_url NOT LIKE '%ACoAA%' THEN loc.linkedin_url
                            ELSE wc.linkedin_url
                          END,
      linkedin_profile_text = COALESCE(wc.linkedin_profile_text, loc.linkedin_profile_text),
      notes             = CASE
                            WHEN wc.notes IS NULL THEN loc.notes
                            WHEN loc.notes IS NOT NULL AND loc.notes <> wc.notes
                              THEN wc.notes || E'\n\n---\n\n' || loc.notes
                            ELSE wc.notes
                          END,
      address           = COALESCE(wc.address, loc.address),
      company_id        = COALESCE(wc.company_id, loc.company_id)
    WHERE id = w.contact_id;
  ELSIF w.contact_id IS NULL AND lo.contact_id IS NOT NULL THEN
    UPDATE leads SET contact_id = lo.contact_id WHERE id = w.id;
    -- Mark the loser as no longer owning a contact so the post-delete
    -- cleanup doesn't try to remove the contact we just adopted.
    lo.contact_id := NULL;
  END IF;

  -- Lead-level resolved status + URL
  w_rank := COALESCE((status_rank ->> w.status)::int, -1);
  l_rank := COALESCE((status_rank ->> lo.status)::int, -1);
  resolved_status := CASE WHEN l_rank > w_rank THEN lo.status ELSE w.status END;
  resolved_url := CASE
    WHEN w.linkedin_url IS NULL THEN lo.linkedin_url
    WHEN w.linkedin_url LIKE '%ACoAA%' AND lo.linkedin_url IS NOT NULL AND lo.linkedin_url NOT LIKE '%ACoAA%' THEN lo.linkedin_url
    ELSE w.linkedin_url
  END;

  UPDATE leads SET
    company_id             = COALESCE(w.company_id, lo.company_id),
    status                 = resolved_status,
    source                 = COALESCE(w.source, lo.source),
    sample_request_id      = COALESCE(w.sample_request_id, lo.sample_request_id),
    follow_up_date         = COALESCE(w.follow_up_date, lo.follow_up_date),
    value_estimate         = COALESCE(w.value_estimate, lo.value_estimate),
    notes                  = CASE
                                WHEN w.notes IS NULL THEN lo.notes
                                WHEN lo.notes IS NOT NULL AND lo.notes <> w.notes
                                  THEN w.notes || E'\n\n---\n\n' || lo.notes
                                ELSE w.notes
                              END,
    last_activity_at       = GREATEST(w.last_activity_at, lo.last_activity_at),
    email                  = COALESCE(w.email, lo.email),
    linkedin_url           = resolved_url,
    linkedin_thread_id     = COALESCE(w.linkedin_thread_id, lo.linkedin_thread_id),
    phone                  = COALESCE(w.phone, lo.phone),
    connection_accepted_at = LEAST(w.connection_accepted_at, lo.connection_accepted_at),
    invited_at             = LEAST(w.invited_at, lo.invited_at),
    wake_up_at             = COALESCE(w.wake_up_at, lo.wake_up_at),
    wake_up_reason         = COALESCE(w.wake_up_reason, lo.wake_up_reason),
    last_inbox_sync_at     = GREATEST(w.last_inbox_sync_at, lo.last_inbox_sync_at),
    closed_won_at          = LEAST(w.closed_won_at, lo.closed_won_at)
  WHERE id = p_winner;

  -- Repoint dependents. activities.lead_id is ON DELETE CASCADE — this
  -- step MUST happen before deleting the loser lead.
  UPDATE activities    SET lead_id = p_winner WHERE lead_id = p_loser;
  GET DIAGNOSTICS activities_moved = ROW_COUNT;
  UPDATE manual_orders SET lead_id = p_winner WHERE lead_id = p_loser;
  GET DIAGNOSTICS orders_moved = ROW_COUNT;
  UPDATE shipments     SET lead_id = p_winner WHERE lead_id = p_loser;
  GET DIAGNOSTICS shipments_moved = ROW_COUNT;
  UPDATE review_queue  SET lead_id = p_winner WHERE lead_id = p_loser;
  GET DIAGNOSTICS queue_moved = ROW_COUNT;

  DELETE FROM leads WHERE id = p_loser;

  -- Drop the loser contact only if no other lead still references it.
  IF lo.contact_id IS NOT NULL AND lo.contact_id IS DISTINCT FROM w.contact_id THEN
    SELECT EXISTS (SELECT 1 FROM leads WHERE contact_id = lo.contact_id) INTO contact_still_in_use;
    IF NOT contact_still_in_use THEN
      DELETE FROM contacts WHERE id = lo.contact_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'winner', p_winner,
    'loser', p_loser,
    'status_after', resolved_status,
    'url_after', resolved_url,
    'activities_moved', activities_moved,
    'orders_moved', orders_moved,
    'shipments_moved', shipments_moved,
    'queue_moved', queue_moved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_two_leads(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_two_leads(uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.merge_two_leads(uuid, uuid) IS
  'Merge a duplicate lead row into a canonical winner. Promotes non-null fields, repoints activities/orders/shipments/queue, deletes the loser. See migration 020.';
