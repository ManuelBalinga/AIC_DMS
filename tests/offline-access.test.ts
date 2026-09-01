import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/0017_offline_document_leases.sql",
  "utf8",
);
const portable = readFileSync("db/portable-schema.sql", "utf8");
const types = readFileSync("src/lib/types/database.ts", "utf8");
const serviceWorker = readFileSync("public/sw.js", "utf8");
const uploadUi = readFileSync(
  "src/app/(app)/dashboard/upload-document.tsx",
  "utf8",
);
const finaliseRoute = readFileSync("src/app/api/documents/route.ts", "utf8");
const offlineStorage = readFileSync("src/modules/offline/storage.ts", "utf8");

function ordered(source: string, fragments: string[]) {
  let cursor = 0;
  for (const fragment of fragments) {
    const next = source.indexOf(fragment, cursor);
    assert.notEqual(next, -1, "missing ordered fragment: " + fragment);
    cursor = next + fragment.length;
  }
}

describe("0017 offline lease invariants", () => {
  test("uses an owner-controlled veto and server-authored 30-day lease", () => {
    assert.ok(
      migration.includes(
        "add column if not exists offline_allowed boolean not null default true",
      ),
    );
    assert.ok(
      migration.includes("Only the document owner may change offline availability"),
    );
    ordered(migration, [
      "public.request_offline_document(",
      "security definer",
      "for share",
      "private.can_read_document",
      "interval '30 days'",
    ]);
  });

  test("retains audit state and prevents clients forging lease rows", () => {
    ordered(migration, [
      "create table if not exists public.offline_document_leases",
      "first_granted_at",
      "last_validated_at",
      "revoked_at",
      "revocation_reason",
      "grant_count",
      "primary key (user_id, client_device_id, document_id)",
    ]);
    ordered(migration, [
      "revoke all on table public.offline_document_leases",
      "grant select on table public.offline_document_leases to authenticated",
    ]);
    assert.equal(
      migration.includes(
        "grant insert on table public.offline_document_leases to authenticated",
      ),
      false,
    );
  });

  test("revalidates in a bounded batch and records every denial reason", () => {
    ordered(migration, [
      "public.revalidate_offline_documents(",
      "target_document_ids uuid[]",
      "returns table (document_id uuid, allowed boolean, expires_at timestamptz)",
      "At most 500 offline documents may be checked at once",
    ]);
    for (const reason of ["expired", "permission_revoked", "owner_veto"]) {
      assert.ok(migration.includes("'" + reason + "'"), "missing reason: " + reason);
    }
    assert.ok(
      migration.includes("renewed_expiry := now() + interval '30 days'"),
    );
  });

  test("mirrors schema and RPC contracts into the portable schema and app types", () => {
    const offlinePortable = portable.slice(
      portable.indexOf("-- Offline document leases"),
    );
    assert.ok(offlinePortable.includes("public.offline_document_leases"));
    assert.ok(offlinePortable.includes("references public.app_users"));
    assert.ok(offlinePortable.includes("app.current_user_id()"));
    for (const forbidden of ["auth.uid", "authenticated", "service_role"]) {
      assert.equal(offlinePortable.includes(forbidden), false);
    }
    for (const contract of [
      "offline_allowed: boolean",
      "offline_document_leases:",
      "request_offline_document:",
      "revalidate_offline_documents:",
    ]) {
      assert.ok(types.includes(contract), "missing type contract: " + contract);
    }
  });

  test("keeps authenticated data and signed document URLs out of the service-worker cache", () => {
    assert.ok(serviceWorker.includes('url.pathname === "/offline"'));
    assert.ok(serviceWorker.includes('url.pathname.startsWith("/_next/static/")'));
    assert.equal(serviceWorker.includes('url.pathname.startsWith("/api/")'), false);
    assert.ok(
      serviceWorker.includes('url.pathname === "/offline" ? "/offline" : event.request'),
      "offline links with a document query must resolve to the cached shell",
    );
  });

  test("persists uploads before network work and makes finalization retry-safe", () => {
    assert.ok(uploadUi.includes("key: crypto.randomUUID()"));
    ordered(uploadUi, ["await saveQueuedUpload(upload)", "await processQueuedUpload(upload)"]);
    ordered(offlineStorage, ["transaction.oncomplete", "resolve(result)"]);
    ordered(finaliseRoute, [
      "const { data: existing }",
      "existing?.owner_id === profile.id",
      "return NextResponse.json({ id: documentId }, { status: 200 })",
    ]);
  });
});
