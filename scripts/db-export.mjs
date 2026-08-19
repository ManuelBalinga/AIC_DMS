#!/usr/bin/env node
/**
 * Export every record the platform owns, in a provider-neutral form.
 *
 * Half of the portability contract described in `db/README.md`: this script
 * gets records *out* of the current Supabase project; `db-import.mjs` puts them
 * into anything that speaks Postgres, Neon included.
 *
 *   node scripts/db-export.mjs [--out db/export]
 *
 * Reads with the service-role key, so it deliberately bypasses RLS — an export
 * that only contained the exporter's own documents would not be a backup.
 * That also means the output is the whole company's documents in plaintext:
 * treat the directory it writes as production data.
 *
 * Output is one JSONL file per table plus a manifest, rather than one large
 * JSON document: a corpus of chunk embeddings does not fit comfortably in
 * memory as a single parsed value on either side of the move.
 */

import { createClient } from "@supabase/supabase-js";
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

function loadEnv() {
  // Plain node script, so it does not get Next's env loading.
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local; fall through to whatever is already exported.
  }
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Set them in .env.local or the environment.",
  );
  process.exit(1);
}

const outDir = (() => {
  const flag = process.argv.indexOf("--out");
  return flag === -1 ? "db/export" : process.argv[flag + 1];
})();

/* -------------------------------------------------------------------------- */
/* What travels                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The tables that make up a complete dataset, in dependency order, with the
 * columns that are actually portable.
 *
 * Columns are listed explicitly rather than selected with `*` for two reasons.
 * Generated columns (`documents.search_vector`) cannot be inserted into and
 * would break the import if carried. And an explicit list is a statement of
 * what the platform considers its own data — anything a provider adds around
 * the edges is, by construction, not part of the move.
 */
export const TABLES = [
  {
    name: "profiles",
    portableName: "app_users",
    orderBy: ["id"],
    columns: ["id", "email", "full_name", "role", "created_at", "updated_at"],
  },
  {
    name: "invitations",
    orderBy: ["id"],
    columns: ["id", "email", "role", "status", "invited_by", "accepted_at", "created_at"],
  },
  {
    name: "documents",
    orderBy: ["id"],
    columns: [
      "id",
      "owner_id",
      "title",
      "description",
      "file_name",
      "storage_path",
      "mime_type",
      "size_bytes",
      "tags",
      "index_status",
      "indexed_at",
      "index_error",
      "chunk_count",
      "summary",
      "summary_generated_at",
      "suggested_tags",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "document_access",
    orderBy: ["document_id", "user_id"],
    columns: ["document_id", "user_id", "granted_by", "created_at"],
  },
  {
    name: "document_chunks",
    orderBy: ["id"],
    columns: [
      "id",
      "document_id",
      "chunk_index",
      "content",
      "token_count",
      "page_number",
      "embedding",
      "created_at",
    ],
  },
  {
    name: "conversations",
    orderBy: ["id"],
    columns: [
      "id",
      "user_id",
      "title",
      "summary",
      "summary_through_seq",
      "message_count",
      "last_message_at",
      "created_at",
      "updated_at",
    ],
  },
  {
    name: "conversation_messages",
    orderBy: ["id"],
    columns: [
      "id",
      "conversation_id",
      "seq",
      "role",
      "content",
      "retrieval_mode",
      "passage_count",
      "resolved_query",
      "created_at",
    ],
  },
  {
    name: "message_citations",
    orderBy: ["id"],
    columns: [
      "id",
      "message_id",
      "position",
      "document_id",
      "document_title",
      "page_number",
      "excerpt",
    ],
  },
];

/**
 * Rows per request. Chunk rows carry a 1536-float embedding, so keep it modest.
 *
 * Paging is ordered by primary key, not by `created_at`: two rows written in the
 * same millisecond would otherwise be free to swap places between pages, which
 * silently drops one and duplicates the other.
 */
const PAGE_SIZE = 500;

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

const supabase = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function exportTable(table) {
  const file = join(outDir, `${table.name}.jsonl`);
  rmSync(file, { force: true });
  writeFileSync(file, "");

  let exported = 0;

  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase.from(table.name).select(table.columns.join(","));
    for (const column of table.orderBy) {
      query = query.order(column, { ascending: true });
    }

    const { data, error } = await query.range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Reading ${table.name} failed: ${error.message}`);
    }
    if (!data || data.length === 0) break;

    // Appended per page rather than accumulated: the chunk table is the one
    // that gets large, and it is also the one that would be held in memory.
    appendFileSync(file, `${data.map((row) => JSON.stringify(row)).join("\n")}\n`);
    exported += data.length;

    if (data.length < PAGE_SIZE) break;
  }

  return exported;
}

async function main() {
  mkdirSync(outDir, { recursive: true });

  const counts = {};

  for (const table of TABLES) {
    process.stdout.write(`  ${table.name}… `);
    counts[table.name] = await exportTable(table);
    console.log(`${counts[table.name]} rows`);
  }

  const manifest = {
    exported_at: new Date().toISOString(),
    source: { provider: "supabase", url },
    // The import script reads this rather than re-deriving the shape, so a
    // dataset stays importable even after this file's TABLES list moves on.
    tables: TABLES.map((table) => ({
      name: table.name,
      portable_name: table.portableName ?? table.name,
      columns: table.columns,
      primary_key: table.orderBy,
      rows: counts[table.name],
    })),
  };

  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
  console.log(`\nExported ${total} rows to ${outDir}/`);
  console.log("Next: node scripts/db-import.mjs --from " + outDir);
  console.log(
    "\nNote: document bytes live in object storage, not in these tables.\n" +
      "See db/README.md for moving the files themselves.",
  );
}

main().catch((cause) => {
  console.error(`\nExport failed: ${cause.message}`);
  process.exit(1);
});
