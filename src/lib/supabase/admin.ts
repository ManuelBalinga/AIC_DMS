import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types/database";
import { publicEnv, serverEnv } from "@/lib/env";

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Only for operations the user genuinely cannot perform as themselves:
 *  - creating auth users / sending invitations (admin API)
 *  - writing and reading document bytes in the private storage bucket
 *
 * Every call site must check the caller's permission FIRST. Treat an
 * unguarded use of this client as a security bug.
 */
export function createAdminClient() {
  return createClient<Database>(
    publicEnv.supabaseUrl,
    serverEnv.supabaseServiceRoleKey,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
