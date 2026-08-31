import { createHash } from "node:crypto";

/**
 * Hash migration text independently of the checkout platform.
 *
 * Git normally stores these files with LF endings, while a Windows checkout
 * may present them as CRLF. The SQL is identical in both cases, so the ledger
 * must not report an applied migration as edited merely because it was read on
 * a different operating system.
 */
export function canonicalMigrationSql(sql) {
  return sql.replace(/\r\n?/g, "\n");
}

export function migrationChecksum(sql) {
  return createHash("sha256")
    .update(canonicalMigrationSql(sql))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Accept the historical raw-text hash as well as the canonical hash. Existing
 * AIC environments were seeded before checksums were platform-independent, so
 * their ledger legitimately contains a mixture of LF and CRLF hashes.
 */
export function acceptedMigrationChecksums(sql) {
  const canonical = canonicalMigrationSql(sql);
  const historicalWindows = canonical.replaceAll("\n", "\r\n");

  return new Set([
    migrationChecksum(canonical),
    createHash("sha256").update(sql).digest("hex").slice(0, 16),
    createHash("sha256")
      .update(historicalWindows)
      .digest("hex")
      .slice(0, 16),
  ]);
}
