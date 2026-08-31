import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  acceptedMigrationChecksums,
  canonicalMigrationSql,
  migrationChecksum,
} from "../scripts/migration-checksum.mjs";

describe("migration checksums", () => {
  const lf = "create table example (\n  id uuid primary key\n);\n";
  const crlf = lf.replaceAll("\n", "\r\n");

  test("normalises line endings before hashing", () => {
    assert.equal(canonicalMigrationSql(crlf), lf);
    assert.equal(migrationChecksum(crlf), migrationChecksum(lf));
  });

  test("accepts a historical raw Windows checksum", () => {
    const legacy = createHash("sha256")
      .update(crlf)
      .digest("hex")
      .slice(0, 16);

    assert.ok(acceptedMigrationChecksums(crlf).has(legacy));
    assert.ok(
      acceptedMigrationChecksums(lf).has(legacy),
      "an LF checkout must accept a ledger written by the old Windows runner",
    );
    assert.ok(acceptedMigrationChecksums(crlf).has(migrationChecksum(lf)));
  });

  test("still rejects genuinely edited SQL", () => {
    const before = acceptedMigrationChecksums(lf);
    const edited = migrationChecksum(`${lf}-- changed\n`);

    assert.equal(before.has(edited), false);
  });
});
