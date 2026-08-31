import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  buildPromotedThreadMarkdown,
  type PromotionMessage,
} from "@/modules/chat/promotion";

const migration = readFileSync(
  "supabase/migrations/0015_thread_document_promotion.sql",
  "utf8",
);

function message(overrides: Partial<PromotionMessage> = {}): PromotionMessage {
  return {
    id: "message-1",
    body: "The launch date is confirmed.",
    parent_id: null,
    created_at: "2026-08-31T12:00:00.000Z",
    edited_at: null,
    retracted_at: null,
    sender: { full_name: "Ada", email: "ada@example.test" },
    ...overrides,
  };
}

describe("thread promotion transcript", () => {
  test("records source, snapshot size, authorship and reply shape", () => {
    const markdown = buildPromotedThreadMarkdown({
      title: "Launch decision",
      threadKind: "team",
      threadName: "Launch",
      promotedAt: "2026-08-31T13:00:00.000Z",
      messages: [message(), message({ id: "reply", parent_id: "message-1", body: "Confirmed." })],
    });

    assert.match(markdown, /^# Launch decision/m);
    assert.match(markdown, /Promoted from Team #Launch/);
    assert.match(markdown, /snapshot of 2 messages/);
    assert.match(markdown, /## Message — Ada/);
    assert.match(markdown, /## Reply to Ada \(2026-08-31T12:00:00\.000Z\) — Ada/);
    assert.match(markdown, /Document-reference cards are not copied/);
  });

  test("keeps a tombstone and never republishes retained retracted text", () => {
    const markdown = buildPromotedThreadMarkdown({
      title: "Decision",
      threadKind: "direct",
      threadName: "Ignored",
      promotedAt: "2026-08-31T13:00:00.000Z",
      messages: [message({ body: "secret retained text", retracted_at: "2026-08-31T12:05:00.000Z" })],
    });

    assert.match(markdown, /direct conversation/);
    assert.match(markdown, /\\\[Message retracted\\\]/);
    assert.doesNotMatch(markdown, /secret retained text/i);
  });

  test("neutralises message Markdown and raw HTML", () => {
    const markdown = buildPromotedThreadMarkdown({
      title: "A [governed] title",
      threadKind: "team",
      threadName: "<script>team</script>",
      promotedAt: "2026-08-31T13:00:00.000Z",
      messages: [message({ body: "# Fake heading\n<script>alert(1)</script>" })],
    });

    assert.match(markdown, /^# A \\\[governed\\\] title/m);
    assert.match(markdown, /> \\\# Fake heading/);
    assert.doesNotMatch(markdown, /<script>/);
  });
});

describe("0015 promotion transaction", () => {
  test("requires active conversation participation", () => {
    assert.match(
      migration,
      /not private\.can_post_chat_message\(target_thread_id\)[\s\S]*Only a conversation participant may promote it[\s\S]*42501/i,
    );
  });

  test("creates the document and Team Viewer grant atomically", () => {
    assert.match(
      migration,
      /insert into public\.documents[\s\S]*mime_type[\s\S]*'text\/markdown'[\s\S]*if thread_kind = 'team'[\s\S]*insert into public\.document_team_access[\s\S]*'viewer'/i,
    );
  });

  test("binds storage metadata to the caller and document id", () => {
    assert.match(
      migration,
      /document_storage_path <> format\([\s\S]*me, new_document_id, document_file_name/i,
    );
    assert.match(migration, /document_size_bytes not between 1 and 52428800/i);
  });

  test("prevents storage rebinding and editor ownership escalation", () => {
    assert.match(
      migration,
      /create or replace function private\.protect_document_binding[\s\S]*new\.storage_path <> format[\s\S]*Document storage binding is invalid/i,
    );
    assert.match(
      migration,
      /new\.storage_path is distinct from old\.storage_path[\s\S]*new\.size_bytes is distinct from old\.size_bytes[\s\S]*Document file binding cannot be changed/i,
    );
    assert.match(
      migration,
      /new\.owner_id is distinct from old\.owner_id[\s\S]*not private\.is_administrator[\s\S]*Only an administrator may transfer document ownership/i,
    );
  });
});
