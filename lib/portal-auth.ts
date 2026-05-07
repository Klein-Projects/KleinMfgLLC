import { NextResponse } from "next/server";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

/**
 * Verifies a portal session and returns a service-role Supabase client for
 * unrestricted DB access. Returns a 401 NextResponse instead if unauthenticated.
 *
 * Usage:
 *   const auth = await requirePortalAuth();
 *   if (auth instanceof NextResponse) return auth;
 *   const { supabase } = auth;
 */
export async function requirePortalAuth(): Promise<
  NextResponse | { supabase: SupabaseClient; userId: string }
> {
  const cookieClient = createCookieClient();
  const {
    data: { user },
  } = await cookieClient.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase: SupabaseClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  return { supabase, userId: user.id };
}
