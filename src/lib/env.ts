/**
 * Environment access with fail-fast validation.
 *
 * Public values are inlined by Next at build time, so they must be referenced
 * as full `process.env.NEXT_PUBLIC_*` expressions rather than looked up
 * dynamically.
 */

/**
 * Where a missing value has to be supplied depends on where the code is running,
 * and the two places behave differently enough that the message says which:
 *
 *   - Locally, values come from `.env.local`, read fresh on every request.
 *   - On a host such as Vercel, they come from the project's environment
 *     settings. A `NEXT_PUBLIC_*` value is inlined into the bundle when the
 *     project is built, so adding one to a project that has already been
 *     deployed changes nothing until the project is redeployed. That is the
 *     failure people lose an afternoon to, so it is written down here, where
 *     somebody reading the error will find it.
 */
function required(value: string | undefined, name: string): string {
  if (!value) {
    const isPublic = name.startsWith("NEXT_PUBLIC_");
    throw new Error(
      `Missing environment variable ${name}. ` +
        "Locally: copy .env.example to .env.local and fill it in. " +
        "On a host: add it to the project's environment variables" +
        (isPublic
          ? " and redeploy — NEXT_PUBLIC_ values are baked in at build time, so " +
            "setting one without rebuilding leaves the old (missing) value in place."
          : "."),
    );
  }
  return value;
}

export const publicEnv = {
  get supabaseUrl() {
    return required(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      "NEXT_PUBLIC_SUPABASE_URL",
    );
  },
  get supabaseAnonKey() {
    return required(
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    );
  },
};

/** Server-only secrets. Never import this from a client component. */
export const serverEnv = {
  get supabaseServiceRoleKey() {
    return required(
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      "SUPABASE_SERVICE_ROLE_KEY",
    );
  },
  get siteUrl() {
    return process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  },
};
