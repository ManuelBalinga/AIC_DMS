import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/types/database";
import { publicEnv } from "@/lib/env";

/** Supabase client for browser/client components. Uses the anon key + RLS. */
export function createClient() {
  return createBrowserClient<Database>(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
  );
}
