#!/usr/bin/env node
/**
 * Turn an export into records in another Postgres database.
 *
 * The other half of the portability contract in `db/README.md`. Two targets:
 *
 *   node scripts/db-import.mjs --from db/export --target neon
 *     Writes db/export/import.sql. Apply it with any Postgres client:
 *       psql "$NEON_DATABASE_URL" -f db/export/import.sql
 *       neonctl connection-string | xargs -I {} psql {} -f db/export/import.sql
 *
 *   node scripts/db-import.mjs --from db/export --target supabase
 *     Writes rows straight into the project in TARGET_SUPABASE_URL /
 *     TARGET_SUPABASE_SERVICE_ROLE_KEY.
 *
 * Emitting SQL rather than opening a connection is what keeps this script
 * dependency-free. Adding a Postgres driver to the app's package.json to move
 * data once a year is a worse trade than a file you can read before you run it
 * — and being able to read it before running it is the point.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/* -------------------------------------------------------------------------- */
/* Arguments                                                                  */
/*                                                                            */
/* Resolved inside `main` rather than at module scope so this file can be      */
/* imported — by the tests, or by any other script — without reading a         */
/* manifest, parsing argv, or calling process.exit as a side effect of the     */
/* import itself.                                                             */
/* -------------------------------------------------------------------------- */

let fromDir = "db/export";
let target = "neon";
let manifest = null;

function flag(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

function loadContext() {
  fromDir = flag("from", "db/export");
  target = flag("target", "neon");

  if (!["neon", "supabase"].includes(target)) {
    console.error(`Unknown --target "${target}". Use "neon" or "supabase".`);
    process.exit(1);
  }

  try {
    manifest = JSON.parse(readFileSync(join(fromDir, "manifest.json"), "utf8"));
  } catch {
    console.error(
      `No manifest at ${fromDir}/manifest.json. Run scripts/db-export.mjs first.`,
    );
    process.exit(1);
  }
}

function readRows(tableName) {
  let contents;
  try {
    contents = readFileSync(join(fromDir, `${tableName}.jsonl`), "utf8");
  } catch {
    return [];
  }

  return contents
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line));
}

/* -------------------------------------------------------------------------- */
/* SQL literals                                                               */
/* -------------------------------------------------------------------------- */

export function quote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Postgres array literal, for `text[]` columns.
 *
 * Not JSON: `["a","b"]` is a valid JSON array and an invalid Postgres one.
 * Elements are double-quoted so a tag containing a comma or a brace survives.
 */
export function arrayLiteral(values) {
  const elements = values.map(
    (value) => `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
  );
  return quote(`{${elements.join(",")}}`);
}

/**
 * One value, as a literal Postgres can coerce into the target column.
 *
 * Everything non-numeric is emitted as an untyped string literal and left for
 * Postgres to coerce from the column's own type. That is what makes this work
 * across `timestamptz`, the enums, `uuid`, and `vector` without this script
 * carrying a copy of the schema's types — and a copy of the types is exactly
 * the thing that would silently rot the next time a column changes.
 *
 * pgvector reads back as the string "[0.1,0.2,…]", which is already its own
 * input format, so embeddings need no special handling beyond quoting.
 */
export function literal(value) {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return arrayLiteral(value);
  if (typeof value === "object") return quote(JSON.stringify(value));
  return quote(value);
}

/* -------------------------------------------------------------------------- */
/* SQL emission                                                               */
/* -------------------------------------------------------------------------- */

/** Rows per INSERT. Large enough to be fast, small enough to stay readable. */
const BATCH_SIZE = 200;

function tableStatements(spec, rows) {
  // `profiles` is a table on Supabase and an updatable view on the portable
  // schema, and ON CONFLICT does not work through a view — so a Neon target is
  // pointed at the underlying `app_users` instead.
  const table = target === "neon" ? spec.portable_name : spec.name;
  const conflict = spec.primary_key.join(", ");
  const out = [];

  for (let index = 0; index < rows.length; index += BATCH_SIZE) {
    const batch = rows.slice(index, index + BATCH_SIZE);
    const values = batch
      .map((row) => `  (${spec.columns.map((c) => literal(row[c])).join(", ")})`)
      .join(",\n");

    // `do nothing` rather than `do update`: an import is for a database that
    // does not have these rows yet. Re-running it must be safe, but it must not
    // quietly overwrite anything that has changed on the target since.
    out.push(
      `insert into public.${table} (${spec.columns.join(", ")})\nvalues\n${values}\n` +
        `on conflict (${conflict}) do nothing;`,
    );
  }

  return out;
}

function buildSql() {
  const parts = [
    "-- Generated by scripts/db-import.mjs — do not edit by hand.",
    `-- Source: ${manifest.source?.provider ?? "unknown"} ${manifest.source?.url ?? ""}`,
    `-- Exported: ${manifest.exported_at}`,
    "--",
    "-- Apply the schema first (db/portable-schema.sql on a new provider), then:",
    "--   psql \"$NEON_DATABASE_URL\" -f db/export/import.sql",
    "",
    // One transaction: a half-imported dataset with documents but no owners is
    // harder to recover from than no import at all.
    "begin;",
    "",
    // Foreign keys resolve because the manifest lists tables in dependency
    // order, not because constraints are relaxed — nothing here is deferrable,
    // and an import that needed them to be would be hiding a real ordering bug.
    //
    // Triggers are the other thing a naive copy gets wrong: inserting into
    // conversation_messages fires touch_conversation_on_message, which would
    // add to a message_count that was already correct in the exported row.
    "alter table public.conversation_messages disable trigger conversation_messages_touch_conversation;",
    "",
  ];

  for (const spec of manifest.tables) {
    const rows = readRows(spec.name);
    if (rows.length === 0) {
      parts.push(`-- ${spec.name}: no rows`, "");
      continue;
    }

    parts.push(`-- ${spec.name}: ${rows.length} row${rows.length === 1 ? "" : "s"}`);
    parts.push(...tableStatements(spec, rows));
    parts.push("");
  }

  parts.push(
    "alter table public.conversation_messages enable trigger conversation_messages_touch_conversation;",
    "",
    "-- Reconcile the counters the disabled trigger would have maintained, from",
    "-- the messages that actually landed rather than from the exported values.",
    "update public.conversations c set",
    "  message_count = (",
    "    select count(*) from public.conversation_messages m",
    "    where m.conversation_id = c.id",
    "  ),",
    "  last_message_at = coalesce((",
    "    select max(m.created_at) from public.conversation_messages m",
    "    where m.conversation_id = c.id",
    "  ), c.created_at);",
    "",
    "-- Same idea for the document chunk counts.",
    "update public.documents d set",
    "  chunk_count = (",
    "    select count(*) from public.document_chunks k",
    "    where k.document_id = d.id",
    "  );",
    "",
    "commit;",
    "",
  );

  return parts.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Targets                                                                    */
/* -------------------------------------------------------------------------- */

function writeSqlTarget() {
  mkdirSync(fromDir, { recursive: true });
  const path = join(fromDir, "import.sql");
  writeFileSync(path, buildSql());

  const total = manifest.tables.reduce((sum, t) => sum + (t.rows ?? 0), 0);
  console.log(`Wrote ${path} — ${total} rows across ${manifest.tables.length} tables.`);
  console.log("\nApply the schema, then the data:");
  console.log('  psql "$NEON_DATABASE_URL" -f db/portable-schema.sql');
  console.log(`  psql "$NEON_DATABASE_URL" -f ${path}`);
}

async function writeSupabaseTarget() {
  const url = process.env.TARGET_SUPABASE_URL;
  const key = process.env.TARGET_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      "A supabase target needs TARGET_SUPABASE_URL and " +
        "TARGET_SUPABASE_SERVICE_ROLE_KEY.\n" +
        "They are named TARGET_ so an import can never be pointed at the " +
        "project it was exported from by leaving a variable set.",
    );
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  for (const spec of manifest.tables) {
    const rows = readRows(spec.name);
    if (rows.length === 0) {
      console.log(`  ${spec.name}: nothing to import`);
      continue;
    }

    process.stdout.write(`  ${spec.name}… `);

    for (let index = 0; index < rows.length; index += BATCH_SIZE) {
      const batch = rows.slice(index, index + BATCH_SIZE);
      const { error } = await supabase
        .from(spec.name)
        .upsert(batch, { onConflict: spec.primary_key.join(","), ignoreDuplicates: true });

      if (error) {
        console.log("failed");
        throw new Error(`${spec.name}: ${error.message}`);
      }
    }

    console.log(`${rows.length} rows`);
  }

  console.log(
    "\nImported. Counters maintained by triggers (conversations.message_count)\n" +
      "will be high — re-run the reconciliation at the end of import.sql, or\n" +
      "use the neon target, which handles it.",
  );
}

/* -------------------------------------------------------------------------- */

async function main() {
  loadContext();

  if (target === "neon") {
    writeSqlTarget();
  } else {
    await writeSupabaseTarget();
  }

  console.log(
    "\nDocument bytes are not in this dataset — only the storage paths that\n" +
      "point at them. See db/README.md for moving the files.",
  );
}

// Only run when invoked directly; a plain import gets the helpers alone.
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((cause) => {
    console.error(`\nImport failed: ${cause.message}`);
    process.exit(1);
  });
}
