import { createClient } from "@supabase/supabase-js";

// Server-side only — never import this in client components.
// Uses the service role key, which bypasses RLS by design for server-side operations.
export function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}
