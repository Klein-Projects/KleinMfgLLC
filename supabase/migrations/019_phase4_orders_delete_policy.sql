-- ============================================================
-- Phase 4 follow-on — orders DELETE policy
--
-- Migration 010 granted public SELECT / UPDATE / INSERT on
-- orders for the single-tenant staff portal, but skipped DELETE.
-- That left the Revenue page's "delete stray test order" button
-- silently filtered to 0 rows by RLS: Supabase returns
-- { error: null } and the client thinks the delete succeeded.
--
-- This matches the same "single-tenant portal, same access
-- model" reasoning as 010. service_role policies stay in place.
-- ============================================================

CREATE POLICY "public delete orders"
  ON public.orders FOR DELETE TO public USING (true);
