#!/usr/bin/env node
/**
 * Permission-boundary test for the beta acceptance criterion
 * "unauthorised users cannot open restricted documents".
 *
 * Everything in this platform's security model rests on Row Level Security, and
 * RLS policies fail silently: a wrong policy does not throw, it just returns
 * rows. The only honest check is to sign in as somebody with no grant and
 * confirm the rows are not there.
 *
 * Run against a development project, never production:
 *
 *   node scripts/verify-rls.mjs
 *
 * It creates two throwaway users, uploads a document as one, and asserts the
 * other cannot see it by any route. Both users and the document are deleted at
 * the end, including when an assertion fails.
 */

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/* -------------------------------------------------------------------------- */
/* Environment                                                                */
/* -------------------------------------------------------------------------- */

function loadEnv() {
  // Read .env.local directly: this is a plain node script, so it does not get
  // Next's env loading.
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
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !anonKey || !serviceKey) {
  console.error(
    "Missing Supabase credentials. Fill in .env.local before running this.",
  );
  process.exit(1);
}
if (anonKey.startsWith("placeholder") || serviceKey.startsWith("placeholder")) {
  console.error(
    ".env.local still holds placeholder values — connect a real Supabase project first.",
  );
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/* -------------------------------------------------------------------------- */
/* Assertions                                                                 */
/* -------------------------------------------------------------------------- */

let failures = 0;

function check(description, passed, detail = "") {
  if (passed) {
    console.log(`  PASS  ${description}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${description}${detail ? ` — ${detail}` : ""}`);
  }
}

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const stamp = Date.now();
const owner = { email: `rls-owner-${stamp}@example.invalid`, password: "verify-rls-owner-pw" };
const outsider = {
  email: `rls-outsider-${stamp}@example.invalid`,
  password: "verify-rls-outsider-pw",
};

const created = { userIds: [], documentId: null, storagePath: null };

async function createUser({ email, password }) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Could not create ${email}: ${error.message}`);
  created.userIds.push(data.user.id);
  return data.user.id;
}

async function signedInClient({ email, password }) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Could not sign in ${email}: ${error.message}`);
  return client;
}

async function cleanup() {
  if (created.documentId) {
    await admin.from("documents").delete().eq("id", created.documentId);
  }
  if (created.storagePath) {
    await admin.storage.from("documents").remove([created.storagePath]);
  }
  for (const id of created.userIds) {
    await admin.auth.admin.deleteUser(id);
  }
}

/* -------------------------------------------------------------------------- */
/* The test                                                                   */
/* -------------------------------------------------------------------------- */

async function main() {
  console.log(`Testing against ${url}\n`);

  const ownerId = await createUser(owner);
  await createUser(outsider);

  const ownerClient = await signedInClient(owner);
  const outsiderClient = await signedInClient(outsider);

  // -- A private document, owned by `owner`, shared with nobody --------------
  // The id is generated here rather than by the database, because migration
  // `0015` binds `storage_path` to `{owner_id}/{id}/{file_name}` and makes that
  // binding immutable — it is what lets the download route sign private bytes
  // for a row without re-deriving who may read them. The path therefore has to
  // name the id before the insert that creates it, which is exactly what
  // `api/documents/upload-url` does in the real upload flow.
  const documentId = randomUUID();
  created.storagePath = `${ownerId}/${documentId}/secret.txt`;
  const { error: uploadError } = await admin.storage
    .from("documents")
    .upload(created.storagePath, Buffer.from("board minutes"), {
      contentType: "text/plain",
    });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  // No `.select()` on the way in, which is also what `api/documents` does.
  // Asking PostgREST to return the row makes the statement satisfy the SELECT
  // policy as well, and that policy calls `can_read_document`, which re-queries
  // `documents`. Mid-INSERT that query cannot see the row being written, so the
  // read is refused and the whole statement fails — even though the row is
  // perfectly readable a moment later. Generating the id here removes the only
  // reason to ask for it back.
  const { error: insertError } = await ownerClient.from("documents").insert({
    id: documentId,
    owner_id: ownerId,
    title: `RLS probe ${stamp}`,
    file_name: "secret.txt",
    storage_path: created.storagePath,
    mime_type: "text/plain",
    size_bytes: 13,
  });
  if (insertError) throw new Error(`Insert failed: ${insertError.message}`);
  created.documentId = documentId;
  const document = { id: documentId };

  console.log("documents");
  const { data: ownerRows } = await ownerClient
    .from("documents")
    .select("id")
    .eq("id", document.id);
  check("owner can read their own document", ownerRows?.length === 1);

  const { data: outsiderRows } = await outsiderClient
    .from("documents")
    .select("id")
    .eq("id", document.id);
  check(
    "outsider cannot read an unshared document",
    (outsiderRows?.length ?? 0) === 0,
    `saw ${outsiderRows?.length ?? 0} row(s)`,
  );

  const { error: outsiderUpdateError } = await outsiderClient
    .from("documents")
    .update({ title: "hijacked" })
    .eq("id", document.id)
    .select("id");
  const { data: afterUpdate } = await admin
    .from("documents")
    .select("title")
    .eq("id", document.id)
    .single();
  check(
    "outsider cannot rename an unshared document",
    afterUpdate?.title !== "hijacked",
    outsiderUpdateError?.message ?? "the title changed",
  );

  await outsiderClient.from("documents").delete().eq("id", document.id);
  const { count: survives } = await admin
    .from("documents")
    .select("id", { count: "exact", head: true })
    .eq("id", document.id);
  check("outsider cannot delete an unshared document", survives === 1);

  console.log("\ndocument_access");
  const { error: grantError } = await outsiderClient
    .from("document_access")
    .insert({ document_id: document.id, user_id: created.userIds[1] });
  check(
    "outsider cannot grant themselves access",
    Boolean(grantError),
    "the insert succeeded",
  );

  console.log("\ndocument_chunks (RAG retrieval boundary)");
  const { error: chunkError } = await admin.from("document_chunks").insert({
    document_id: document.id,
    chunk_index: 0,
    content: "The board approved the confidential budget.",
  });
  if (chunkError) throw new Error(`Chunk insert failed: ${chunkError.message}`);

  const { data: ownerChunks } = await ownerClient
    .from("document_chunks")
    .select("id")
    .eq("document_id", document.id);
  check("owner can retrieve their own chunks", (ownerChunks?.length ?? 0) === 1);

  const { data: outsiderChunks } = await outsiderClient
    .from("document_chunks")
    .select("id")
    .eq("document_id", document.id);
  check(
    "outsider cannot retrieve chunks of an unshared document",
    (outsiderChunks?.length ?? 0) === 0,
    `saw ${outsiderChunks?.length ?? 0} chunk(s)`,
  );

  const { data: keywordHits } = await outsiderClient.rpc("search_document_chunks", {
    query_text: "confidential budget",
    match_count: 10,
  });
  check(
    "keyword search does not surface an unshared document",
    !(keywordHits ?? []).some((hit) => hit.document_id === document.id),
  );

  console.log("\nsharing");
  await ownerClient
    .from("document_access")
    .insert({ document_id: document.id, user_id: created.userIds[1] });

  const { data: afterShare } = await outsiderClient
    .from("documents")
    .select("id")
    .eq("id", document.id);
  check("a granted user can read the document", afterShare?.length === 1);

  const { data: chunksAfterShare } = await outsiderClient
    .from("document_chunks")
    .select("id")
    .eq("document_id", document.id);
  check(
    "a granted user can retrieve its chunks",
    (chunksAfterShare?.length ?? 0) === 1,
  );

  await ownerClient
    .from("document_access")
    .delete()
    .eq("document_id", document.id)
    .eq("user_id", created.userIds[1]);

  const { data: afterRevoke } = await outsiderClient
    .from("documents")
    .select("id")
    .eq("id", document.id);
  check("revoking access takes it away again", (afterRevoke?.length ?? 0) === 0);

  console.log("\ninvitations (administrator only)");
  const { error: inviteError } = await outsiderClient
    .from("invitations")
    .insert({ email: `sneaky-${stamp}@example.invalid` });
  check(
    "a member cannot create an invitation",
    Boolean(inviteError),
    "the insert succeeded",
  );

  console.log("\nstorage");
  const anonStorage = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: bucketError } = await anonStorage.storage
    .from("documents")
    .download(created.storagePath);
  check(
    "the storage bucket is not readable from the browser",
    Boolean(bucketError),
    "the download succeeded",
  );
}

main()
  .catch((error) => {
    failures += 1;
    console.error(`\nERROR ${error.message}`);
  })
  .finally(async () => {
    await cleanup();
    console.log(
      failures === 0
        ? "\nAll permission-boundary checks passed."
        : `\n${failures} check(s) failed.`,
    );
    process.exit(failures === 0 ? 0 : 1);
  });
