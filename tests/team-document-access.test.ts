import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  "supabase/migrations/0013_team_document_access.sql",
  "utf8",
);

describe("0013 Team document access", () => {
  test("stores one durable grant per document and Team", () => {
    assert.match(
      sql,
      /create table if not exists public\.document_team_access[\s\S]*primary key \(document_id, team_id\)/i,
    );
    assert.match(sql, /team_id\s+uuid not null references public\.chat_threads/i);
  });

  test("rejects direct-message permission targets", () => {
    assert.match(
      sql,
      /function private\.validate_document_team_access[\s\S]*t\.kind = 'team'[\s\S]*Document access may target a Team only/i,
    );
  });

  test("membership dynamically grants read, comment and edit roles", () => {
    for (const helper of [
      "can_read_document",
      "can_comment_on_document",
      "can_edit_document",
    ]) {
      const body = sql.match(
        new RegExp(`function private\\.${helper}[\\s\\S]*?\\$fn\\$;`, "i"),
      )?.[0];
      assert.ok(body, `${helper} missing`);
      assert.match(body, /public\.document_team_access/i);
      assert.match(body, /public\.chat_participants/i);
      assert.match(body, /t\.kind = 'team'/i);
    }
  });

  test("administrators manage grant metadata without gaining document content", () => {
    const selectPolicy = sql.match(
      /create policy document_team_access_select[\s\S]*?;/i,
    )?.[0];
    const readHelper = sql.match(
      /function private\.can_read_document[\s\S]*?\$fn\$;/i,
    )?.[0];
    assert.ok(selectPolicy);
    assert.ok(readHelper);
    assert.match(selectPolicy, /private\.can_manage_document/i);
    assert.doesNotMatch(readHelper, /private\.is_administrator/i);
  });

  test("uses explicit least-privilege Data API grants", () => {
    assert.match(
      sql,
      /revoke all privileges on table public\.document_team_access from anon, authenticated/i,
    );
    assert.match(
      sql,
      /grant select, insert, update, delete on table public\.document_team_access to authenticated/i,
    );
  });

  test("membership managers receive only the inherited-document count", () => {
    const body = sql.match(
      /function public\.team_document_grant_count[\s\S]*?\$fn\$;/i,
    )?.[0];
    assert.ok(body);
    assert.match(body, /private\.can_add_team_member\(target_team_id\)/i);
    assert.match(body, /select count\(\*\)/i);
    assert.doesNotMatch(body, /select[\s\S]*documents\.title/i);
  });
});
