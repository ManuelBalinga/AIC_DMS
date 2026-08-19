#!/usr/bin/env node
/**
 * Applies `supabase/migrations/*.sql` to a Postgres database, in order, once each.
 *
 * The alternative is pasting six files into the SQL Editor by hand, in the right
 * order, on every environment. That is the step most likely to be done wrong —
 * skipped, half-applied, or repeated — and it is the step everything else
 * depends on, so it is worth automating.
 *
 * Deliberately not the Supabase CLI. The CLI expects `<timestamp>_name.sql`;
 * this project numbers its migrations `0001_`…`0006_`, which reads far better in
 * a repo where the order is a designed sequence rather than a record of when
 * somebody happened to type something. This runner sorts by that prefix and
 * keeps its own ledger, so the naming can stay as it is.
 *
 *   npm run db:migrate           apply anything outstanding
 *   npm run db:migrate -- --dry  list what would run, touch nothing
 *
 * Needs SUPABASE_DB_URL in .env.local — Supabase dashboard, Project Settings ->
 * Database -> Connection string -> URI. Use the *session* pooler or the direct
 * connection; the transaction pooler cannot run DDL.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import pg from "pg";

const MIGRATIONS_DIR = "supabase/migrations";

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

function loadEnv() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local; fall through to the exported environment.
  }
}

loadEnv();

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  fail(
    "Missing SUPABASE_DB_URL.\n\n" +
      "Supabase dashboard -> Project Settings -> Database -> Connection string -> URI,\n" +
      "then add it to .env.local as:\n\n" +
      "    SUPABASE_DB_URL=postgresql://postgres:...@....supabase.com:5432/postgres\n\n" +
      "It contains your database password, so it stays in .env.local (gitignored)\n" +
      "and is never committed.",
  );
}

const dryRun = process.argv.includes("--dry");

/* -------------------------------------------------------------------------- */
/* Migrations on disk                                                         */
/* -------------------------------------------------------------------------- */

function localMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    // Numeric-aware so 0010 would sort after 0009 rather than after 0001.
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((name) => {
      const sql = readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
      return {
        name,
        sql,
        // Recorded so an already-applied migration that has since been edited is
        // reported rather than silently ignored.
        checksum: createHash("sha256").update(sql).digest("hex").slice(0, 16),
      };
    });
}

/* -------------------------------------------------------------------------- */
/* Run                                                                        */
/* -------------------------------------------------------------------------- */

async function main() {
  const migrations = localMigrations();
  if (migrations.length === 0) fail(`No .sql files found in ${MIGRATIONS_DIR}.`);

  const client = new pg.Client({
    connectionString,
    // Supabase terminates unencrypted connections; the CA is theirs, not ours.
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  const host = new URL(connectionString).host;
  console.log(`Database: ${host}\n`);

  await client.query(`
    create table if not exists public.applied_migrations (
      name        text primary key,
      checksum    text not null,
      applied_at  timestamptz not null default now()
    );
  `);

  const { rows: applied } = await client.query(
    "select name, checksum from public.applied_migrations",
  );
  const appliedByName = new Map(applied.map((row) => [row.name, row.checksum]));

  const pending = [];

  for (const migration of migrations) {
    const previous = appliedByName.get(migration.name);

    if (previous === undefined) {
      pending.push(migration);
    } else if (previous !== migration.checksum) {
      // Not fixed automatically: editing an applied migration means the database
      // and the file no longer agree, and only a person knows which is right.
      console.log(
        `  CHANGED  ${migration.name} — applied already, but the file has been edited since.`,
      );
    } else {
      console.log(`  ok       ${migration.name}`);
    }
  }

  if (pending.length === 0) {
    console.log("\nNothing to apply. The database is up to date.");
    await client.end();
    return;
  }

  console.log(`\n${pending.length} migration(s) to apply:\n`);
  for (const migration of pending) console.log(`  - ${migration.name}`);

  if (dryRun) {
    console.log("\n--dry: nothing was applied.");
    await client.end();
    return;
  }

  console.log("");

  for (const migration of pending) {
    process.stdout.write(`  applying ${migration.name} ... `);

    // Each migration is one transaction: a failure half way through leaves the
    // database exactly as it was, rather than in a state no file describes.
    try {
      await client.query("begin");
      await client.query(migration.sql);
      await client.query(
        "insert into public.applied_migrations (name, checksum) values ($1, $2)",
        [migration.name, migration.checksum],
      );
      await client.query("commit");
      console.log("done");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      console.log("FAILED\n");
      await client.end();
      fail(
        `${migration.name} failed and was rolled back:\n\n  ${error.message}\n\n` +
          "Nothing after it was attempted. Fix the cause and re-run;\n" +
          "migrations already applied will be skipped.",
      );
    }
  }

  await client.end();
  console.log("\nAll migrations applied.");
  console.log("Next: npm run bootstrap:admin -- you@aic.example");
}

main().catch((error) => fail(`Migration run failed: ${error.message}`));
