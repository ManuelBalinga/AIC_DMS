import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildMessageTree,
  type MessageWithSender,
} from "@/modules/chat/presentation";

const migration = readFileSync(
  "supabase/migrations/0011_message_collaboration.sql",
  "utf8",
);

function message(
  id: string,
  parentId: string | null = null,
): MessageWithSender {
  return {
    id,
    thread_id: "thread-1",
    sender_id: "person-1",
    body: id,
    embedding: null,
    parent_id: parentId,
    created_at: "2026-08-31T00:00:00.000Z",
    edited_at: null,
    retracted_at: null,
    retracted_by: null,
    sender: null,
    mentions: [],
    reactions: [],
    versions: [],
  };
}

describe("buildMessageTree", () => {
  test("groups replies beneath their roots while preserving reading order", () => {
    const rootA = message("root-a");
    const replyA1 = message("reply-a-1", rootA.id);
    const rootB = message("root-b");
    const replyA2 = message("reply-a-2", rootA.id);
    const replyB = message("reply-b", rootB.id);

    const tree = buildMessageTree([rootA, replyA1, rootB, replyA2, replyB]);

    assert.deepEqual(
      tree.map((entry) => ({
        id: entry.id,
        replies: entry.replies.map((reply) => reply.id),
      })),
      [
        { id: "root-a", replies: ["reply-a-1", "reply-a-2"] },
        { id: "root-b", replies: ["reply-b"] },
      ],
    );
  });

  test("does not mutate the flat query result", () => {
    const root = message("root");
    const reply = message("reply", root.id);
    const flat = [root, reply];

    const tree = buildMessageTree(flat);

    assert.equal("replies" in root, false);
    assert.equal("replies" in reply, false);
    assert.notEqual(tree[0], root);
    assert.deepEqual(flat, [root, reply]);
  });

  test("keeps a recent reply visible when its older parent is outside the page", () => {
    const reply = message("recent-reply", "older-root-outside-page");

    const tree = buildMessageTree([reply]);

    assert.deepEqual(tree.map((entry) => entry.id), ["recent-reply"]);
  });
});

describe("0011 collaboration migration invariants", () => {
  test("database guard confines replies to the same thread and one level", () => {
    assert.match(
      migration,
      /if parent_thread is null or parent_thread <> new\.thread_id then/i,
    );
    assert.match(migration, /if parent_parent is not null then/i);
    assert.match(
      migration,
      /create trigger chat_messages_validate_write[\s\S]*before insert or update on public\.chat_messages/i,
    );
  });

  test("mentions are relational, unique, and limited to thread participants", () => {
    assert.match(
      migration,
      /create table if not exists public\.chat_mentions[\s\S]*message_id\s+uuid not null references public\.chat_messages[\s\S]*mentioned_user_id uuid not null references public\.profiles[\s\S]*primary key \(message_id, mentioned_user_id\)/i,
    );
    assert.match(
      migration,
      /create policy chat_mentions_insert[\s\S]*m\.sender_id = \(select auth\.uid\(\)\)[\s\S]*private\.is_chat_participant\(m\.thread_id, mentioned_user_id\)/i,
    );
    assert.match(
      migration,
      /select distinct unnest\(mentioned_user_ids\) as member_id/i,
    );
  });

  test("reactions use the agreed allowlist and cannot be forged", () => {
    assert.match(
      migration,
      /emoji\s+text not null check \(emoji in \('👍', '❤️', '🎉', '👀', '✅'\)\)/u,
    );
    assert.match(
      migration,
      /primary key \(message_id, user_id, emoji\)/i,
    );
    assert.match(
      migration,
      /create policy chat_reactions_insert[\s\S]*user_id = \(select auth\.uid\(\)\)[\s\S]*m\.retracted_at is null[\s\S]*private\.is_chat_participant/i,
    );
  });

  test("removes both policy and table privilege for hard deletion", () => {
    assert.match(
      migration,
      /drop policy if exists chat_messages_delete_own on public\.chat_messages/i,
    );
    assert.match(
      migration,
      /revoke delete on table public\.chat_messages from authenticated/i,
    );
    assert.doesNotMatch(
      migration,
      /create policy chat_messages_delete_own/i,
    );
  });

  test("edits and retractions preserve history and lock the tombstone", () => {
    assert.match(
      migration,
      /create table if not exists public\.chat_message_versions[\s\S]*message_id uuid not null references public\.chat_messages \(id\) on delete restrict/i,
    );
    assert.match(
      migration,
      /if new\.body is distinct from old\.body[\s\S]*insert into public\.chat_message_versions[\s\S]*new\.edited_at := now\(\)[\s\S]*new\.embedding := null/i,
    );
    assert.match(
      migration,
      /if old\.retracted_at is not null and new is distinct from old then[\s\S]*raise exception 'A retracted message cannot be changed'/i,
    );
    assert.match(
      migration,
      /if new\.retracted_at is distinct from old\.retracted_at then[\s\S]*insert into public\.chat_message_versions[\s\S]*new\.body := '\[Message retracted\]'[\s\S]*new\.embedding := null/i,
    );
  });
});
