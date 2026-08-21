import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Schema-parity tests.
 *
 * `supabase/migrations/` is what is deployed. `db/portable-schema.sql` is the
 * same schema with its provider-specific dependencies isolated, and it is the
 * whole basis of the claim that this platform can move to Neon or plain
 * Postgres. `db/README.md` says the two are reconciled by hand — which is
 * exactly the kind of discipline that holds until the week somebody is busy.
 *
 * A portable schema discovered to be three migrations stale at the moment you
 * need it is not a portable schema. These tests turn that from a promise into
 * a build failure.
 *
 * They compare declarations, not semantics: a column present in both but with
 * a different type would pass here. That is a deliberate limit — the failure
 * mode being defended against is a migration adding something and the portable
 * copy never hearing about it, which is a presence problem.
 */

const MIGRATIONS_DIR = "supabase/migrations";
const PORTABLE = "db/portable-schema.sql";

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
  .map((name) => readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"))
  .join("\n");

const portable = readFileSync(PORTABLE, "utf8");

/**
 * The one intended substitution. Supabase owns `auth.users`, so the portable
 * schema owns an equivalent it can carry to a provider that has no auth
 * service at all.
 */
const TABLE_ALIASES: Record<string, string> = { profiles: "app_users" };

/**
 * Deliberately absent from the portable schema, with the reason. Anything not
 * on this list that goes missing is drift.
 */
const EXPECTED_ABSENCES: Record<string, string> = {
  handle_new_user:
    "trigger on auth.users, a table only Supabase has — the portable schema has no auth provider to hook",
};

function tableNames(sql: string): Set<string> {
  return new Set(
    [...sql.matchAll(/create table if not exists public\.([a-z_]+)/gi)].map(
      (m) => m[1].toLowerCase(),
    ),
  );
}

function functionNames(sql: string): Set<string> {
  return new Set(
    [
      ...sql.matchAll(/create or replace function (?:public|app)\.([a-z_]+)/gi),
    ].map((m) => m[1].toLowerCase()),
  );
}

/** Columns of one table: those declared in the CREATE, plus later ALTER ADDs. */
function columnNames(sql: string, table: string): Set<string> {
  const columns = new Set<string>();

  const created = sql.match(
    new RegExp(`create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, "i"),
  );

  if (created) {
    for (const line of created[1].split("\n")) {
      const name = line.trim().match(/^([a-z_]+)\s+/i)?.[1];
      // Table-level constraints share the shape of a column declaration.
      if (
        name &&
        !["primary", "unique", "constraint", "foreign", "check"].includes(
          name.toLowerCase(),
        )
      ) {
        columns.add(name.toLowerCase());
      }
    }
  }

  for (const m of sql.matchAll(
    new RegExp(
      `alter table public\\.${table}\\s+add column if not exists ([a-z_]+)`,
      "gi",
    ),
  )) {
    columns.add(m[1].toLowerCase());
  }

  return columns;
}

describe("portable schema keeps up with the migrations", () => {
  test("every deployed table exists in the portable schema", () => {
    const deployed = tableNames(migrations);
    const carried = tableNames(portable);

    assert.ok(deployed.size > 0, "no tables parsed from the migrations");

    const missing = [...deployed]
      .map((name) => TABLE_ALIASES[name] ?? name)
      .filter((name) => !carried.has(name));

    assert.deepEqual(
      missing,
      [],
      `db/portable-schema.sql is missing table(s): ${missing.join(", ")}. ` +
        "Add them in the same commit as the migration that introduced them.",
    );
  });

  test("no column has been added to a table without the portable copy hearing", () => {
    const drift: string[] = [];

    for (const table of tableNames(migrations)) {
      const carriedName = TABLE_ALIASES[table] ?? table;

      const deployedColumns = columnNames(migrations, table);
      const carriedColumns = columnNames(portable, carriedName);

      for (const column of deployedColumns) {
        if (!carriedColumns.has(column)) {
          drift.push(`${carriedName}.${column}`);
        }
      }
    }

    assert.deepEqual(
      drift,
      [],
      `Column(s) present in supabase/migrations but not db/portable-schema.sql: ${drift.join(", ")}`,
    );
  });

  test("every function exists in the portable schema, or is a documented absence", () => {
    const deployed = functionNames(migrations);
    const carried = functionNames(portable);

    const unexplained = [...deployed].filter(
      (name) => !carried.has(name) && !(name in EXPECTED_ABSENCES),
    );

    assert.deepEqual(
      unexplained,
      [],
      `Function(s) missing from db/portable-schema.sql: ${unexplained.join(", ")}`,
    );
  });

  test("the documented absences are still genuinely absent", () => {
    // If one of these turns up in the portable schema, the exemption is stale
    // and the note explaining it is now misleading.
    const carried = functionNames(portable);

    for (const [name, why] of Object.entries(EXPECTED_ABSENCES)) {
      assert.equal(
        carried.has(name),
        false,
        `${name} is now in the portable schema, but is listed as absent because: ${why}`,
      );
    }
  });

  test("the portable schema carries its own identity table and adapter", () => {
    // These are what make it portable at all. Their loss would be silent —
    // the file would still parse and still create a working schema, just one
    // welded back to a single provider.
    const carried = tableNames(portable);
    const functions = functionNames(portable);

    assert.ok(
      carried.has("app_users"),
      "app_users is gone — the portable schema no longer owns its identities",
    );
    assert.ok(
      functions.has("current_user_id"),
      "app.current_user_id() is gone — every RLS policy would need rewriting per provider",
    );
    // `app.current_user_id()` legitimately calls `auth.uid()` — that is its
    // Supabase branch, and the point of the indirection. The invariant is
    // narrower: no *policy* may reach for it directly, because that is what
    // would have to be rewritten per provider.
    const policies = [
      ...portable
        .replace(/--.*$/gm, "")
        .matchAll(/create policy[\s\S]*?;/gi),
    ].map((m) => m[0]);

    assert.ok(policies.length > 0, "no policies parsed from the portable schema");

    const leaking = policies
      .filter((policy) => /auth\.uid\(\)/.test(policy))
      .map((policy) => policy.match(/create policy (\w+)/i)?.[1] ?? "unnamed");

    assert.deepEqual(
      leaking,
      [],
      `policies calling auth.uid() directly instead of app.current_user_id(): ${leaking.join(", ")}. ` +
        "Each one would need rewriting to move provider, which is the cost this schema exists to avoid.",
    );
  });
});
