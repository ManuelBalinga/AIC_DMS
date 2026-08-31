import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  "supabase/migrations/0016_chat_realtime_notifications.sql",
  "utf8",
);
const client = readFileSync("src/modules/chat/realtime-refresh.tsx", "utf8");
const actions = readFileSync("src/modules/chat/actions.ts", "utf8");

describe("0016 Realtime and notification invariants", () => {
  test("stores quiet mention or reply notifications without copying content", () => {
    assert.match(
      migration,
      /create table if not exists public\.chat_notifications[\s\S]*unique \(recipient_id, message_id\)/i,
    );
    assert.match(migration, /kind text not null check \(kind in \('mention', 'reply'\)\)/i);
    assert.doesNotMatch(
      migration,
      /create table if not exists public\.chat_notifications[\s\S]*\bbody\b/i,
    );
    assert.match(migration, /new\.mentioned_user_id is distinct from source_message\.sender_id/i);
    assert.match(migration, /recipient is distinct from new\.sender_id/i);
    assert.match(
      migration,
      /on conflict \(recipient_id, message_id\) do nothing/i,
    );
  });

  test("keeps notification writes private and withdraws rows with chat access", () => {
    assert.match(
      migration,
      /create policy chat_notifications_select[\s\S]*recipient_id = \(select auth\.uid\(\)\)[\s\S]*private\.can_read_chat_messages\(thread_id\)/i,
    );
    assert.match(
      migration,
      /revoke all on table public\.chat_notifications[\s\S]*grant select[\s\S]*grant update \(read_at\)/i,
    );
    assert.match(migration, /Notification identity cannot be changed/);
    assert.match(migration, /A read notification cannot be made unread/);
  });

  test("publishes only guarded app tables and cleans up the client channel", () => {
    assert.match(migration, /pg_catalog\.pg_publication_tables/i);
    assert.match(
      migration,
      /alter publication supabase_realtime add table public\.chat_messages/i,
    );
    assert.match(
      migration,
      /alter publication supabase_realtime add table public\.chat_notifications/i,
    );
    assert.doesNotMatch(migration, /create table realtime\./i);
    assert.match(client, /participantThreads\.has\(threadId\)/);
    assert.match(client, /filter: `recipient_id=eq\.\$\{currentUserId\}`/);
    assert.match(client, /supabase\.removeChannel\(channel\)/);
  });

  test("read receipts advance only through the last rendered message", () => {
    assert.match(
      migration,
      /mark_chat_thread_read[\s\S]*through_message_id[\s\S]*m\.created_at[\s\S]*greatest/i,
    );
    assert.doesNotMatch(
      actions,
      /from\("chat_participants"\)[\s\S]*last_read_at: new Date/i,
    );
    assert.match(actions, /supabase\.rpc\("mark_chat_thread_read"/);
  });
});
