#!/usr/bin/env node
/**
 * Runs the RLS permission-boundary test against a local Postgres.
 *
 * `verify-rls.mjs` is the authority — it exercises a real Supabase project
 * through the API, with Supabase's own roles and grants. This is the cheap
 * version: it applies the migrations to a throwaway local database and asserts
 * the policies grant and deny the right things.
 *
 * It cannot prove Supabase's role grants or PostgREST exposure behave the same.
 * What it does prove is that the policy *logic* is right, without credentials,
 * without a network, and fast enough to run on every change.
 *
 *   npm run verify:rls:local
 *
 * Needs a local Postgres with pgvector, and LOCAL_DB_URL pointing at a database
 * that is safe to drop the contents of.
 */

import { execFileSync } from "node:child_process";

const url = process.env.LOCAL_DB_URL;

if (!url) {
  console.error(
    "\nMissing LOCAL_DB_URL.\n\n" +
      "Point it at a throwaway local database with pgvector available, e.g.\n\n" +
      "    LOCAL_DB_URL=postgresql://user:pass@127.0.0.1:5432/aic_test npm run verify:rls:local\n\n" +
      "This test writes and deletes rows, so never point it at anything real.\n",
  );
  process.exit(1);
}

function psql(args, label) {
  try {
    return execFileSync("psql", [url, "-v", "ON_ERROR_STOP=1", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    console.error(`\n${label} failed:\n${error.stderr || error.message}`);
    process.exit(1);
  }
}

// `auth` and `storage` go too: the harness owns them, and leaving auth.users
// behind makes the boundary test fail on its own fixtures the second time.
console.log("Resetting the schemas…");
psql(
  [
    "-q",
    "-c",
    "drop schema if exists public cascade;" +
      "drop schema if exists auth cascade;" +
      "drop schema if exists storage cascade;" +
      "create schema public;",
  ],
  "reset",
);

console.log("Building the Supabase stand-in…");
psql(["-q", "-c", "create extension if not exists pgcrypto"], "pgcrypto");
psql(["-q", "-f", "db/local-test/00_supabase_harness.sql"], "harness");

console.log("Applying migrations…");
execFileSync("node", ["scripts/db-migrate.mjs"], {
  stdio: "inherit",
  env: { ...process.env, SUPABASE_DB_URL: url },
});

// Granted after the migrations, since the tables do not exist before them.
psql(
  [
    "-q",
    "-c",
    "grant select, insert, update, delete on all tables in schema public to authenticated;" +
      "grant execute on all functions in schema public to authenticated;",
  ],
  "grants",
);

console.log("\nChecking the permission boundary…\n");
// -tA suppresses the empty result table each assertion returns; the checks
// report through NOTICE, and the tuples are noise.
const out = psql(["-q", "-tA", "-f", "db/local-test/01_permission_boundary.sql"], "boundary");
console.log(out.replace(/^psql:[^:]+:\d+: NOTICE:\s*/gm, "  ").trimEnd());
console.log("");
