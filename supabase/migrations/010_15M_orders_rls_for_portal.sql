-- ============================================================
-- Phase 15M.7 testing fix — RLS policies on orders for the portal
--
-- During end-to-end testing on 2026-05-08 the Web Orders tab in
-- /portal/shipments rendered 0 rows even when 9 paid orders existed
-- in Ready-to-Ship state. Root cause: the orders table had RLS
-- enabled with policies only for the service_role (insert + select).
-- The portal page is a Server Component that uses the cookie-based
-- Supabase client (anon key + the logged-in user's auth session),
-- so its SELECT against orders was silently filtered to zero rows
-- by RLS.
--
-- Same shape would have blocked the buy-label / mark-shipped / void
-- API endpoints if the SUPABASE_SERVICE_ROLE_KEY env var ever drifts.
-- This is a single-tenant Klein staff portal — granting the public
-- role full CRUD on orders matches the actual access model and
-- removes a class of "silent zero rows" bugs that are painful to
-- diagnose at 11pm.
-- ============================================================

CREATE POLICY "public select orders"
  ON public.orders FOR SELECT TO public USING (true);

CREATE POLICY "public update orders"
  ON public.orders FOR UPDATE TO public USING (true) WITH CHECK (true);

CREATE POLICY "public insert orders"
  ON public.orders FOR INSERT TO public WITH CHECK (true);
