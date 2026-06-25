import { createClient } from "@supabase/supabase-js";

// Server-side only — never import this in client components.
// Uses the anon key; RLS is disabled on all tables so server routes have full access.
export function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
}
