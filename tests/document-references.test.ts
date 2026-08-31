import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/0014_permission_aware_document_references.sql",
  "utf8",
);

describe("0014 permission-aware document references", () => {
  test("stores a relational reference without copying sensitive metadata", () => {
    assert.match(
      migration,
      /create table if not exists public\.chat_document_references[\s\S]*message_id\s+uuid not null references public\.chat_messages \(id\)[\s\S]*document_id uuid references public\.documents \(id\) on delete set null/i,
    );
    assert.doesNotMatch(
      migration.match(/create table if not exists public\.chat_document_references[\s\S]*?\);/i)?.[0] ?? "",
      /title|file_name|storage_path|excerpt/i,
    );
  });

  test("withholds the base table and CASE-gates every document field", () => {
    assert.match(
      migration,
      /revoke all privileges on table public\.chat_document_references from anon, authenticated[\s\S]*grant insert on table public\.chat_document_references to authenticated/i,
    );
    assert.doesNotMatch(migration, /grant select[^;]*chat_document_references to authenticated/i);
    assert.match(
      migration,
      /create or replace function public\.list_chat_document_references[\s\S]*not allowed as locked[\s\S]*case when allowed then d\.id else null end[\s\S]*case when allowed then d\.title else null end[\s\S]*case when allowed then d\.mime_type else null end/i,
    );
  });

  test("only a sender-readable document can be attached", () => {
    assert.match(
      migration,
      /create policy chat_document_references_insert[\s\S]*private\.can_read_document\(document_id, \(select auth\.uid\(\)\)\)[\s\S]*m\.sender_id = \(select auth\.uid\(\)\)[\s\S]*private\.can_post_chat_message\(m\.thread_id\)/i,
    );
    assert.match(
      migration,
      /every referenced document must be readable by the sender[\s\S]*errcode = '42501'/i,
    );
  });

  test("replaces the old RPC and writes message, mentions and references atomically", () => {
    assert.match(
      migration,
      /drop function if exists public\.send_chat_message\(uuid, text, uuid, uuid\[\]\)/i,
    );
    assert.match(
      migration,
      /create function public\.send_chat_message[\s\S]*referenced_document_ids uuid\[\][\s\S]*reference_mode text[\s\S]*insert into public\.chat_messages[\s\S]*insert into public\.chat_mentions[\s\S]*insert into public\.chat_document_references/i,
    );
  });

  test("preflight is aggregate-only and final send closes the race", () => {
    assert.match(
      migration,
      /create or replace function public\.document_reference_gap_count[\s\S]*returns bigint[\s\S]*count\(\*\)[\s\S]*not private\.can_read_document/i,
    );
    assert.match(
      migration,
      /reference_mode = 'require_access'[\s\S]*document_reference_gap_count\(target_thread_id, document_id\) > 0[\s\S]*errcode = '40001'/i,
    );
  });

  test("Team grants are transactional and DMs never become permission groups", () => {
    assert.match(
      migration,
      /reference_mode = 'grant_team'[\s\S]*t\.kind = 'team'[\s\S]*Direct messages cannot grant document access[\s\S]*insert into public\.document_team_access[\s\S]*'viewer'/i,
    );
    assert.match(migration, /on conflict \(document_id, team_id\) do nothing/i);
  });

  test("the picker excludes administrator-only management metadata", () => {
    assert.match(
      migration,
      /create or replace function public\.list_referenceable_documents\(\)[\s\S]*where private\.can_read_document\(d\.id, \(select auth\.uid\(\)\)\)/i,
    );
  });
});
