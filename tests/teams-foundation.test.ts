import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(
  "supabase/migrations/0012_teams_foundation.sql",
  "utf8",
);

describe("0012 Teams foundation", () => {
  test("introduces the durable app-facing kind and visibility contract", () => {
    assert.match(sql, /create type public\.chat_thread_kind as enum \('direct', 'team'\)/i);
    assert.match(sql, /create type public\.chat_team_visibility as enum \('open', 'closed'\)/i);
    assert.match(
      sql,
      /chat_threads_kind_shape_check[\s\S]*kind = 'direct'[\s\S]*visibility is null[\s\S]*kind = 'team'[\s\S]*visibility is not null[\s\S]*topic is not null/i,
    );
  });

  test("preserves orphaned historical DMs as closed Teams", () => {
    assert.match(
      sql,
      /when not t\.is_group and count\(p\.user_id\) = 2[\s\S]*then 'direct'::public\.chat_thread_kind[\s\S]*else 'team'::public\.chat_thread_kind/i,
    );
    assert.match(
      sql,
      /when c\.durable_kind = 'team' then 'closed'::public\.chat_team_visibility/i,
    );
  });

  test("makes kind and participant identity immutable and DMs exactly two-person", () => {
    assert.match(sql, /create trigger chat_threads_protect_kind[\s\S]*before update/i);
    assert.match(sql, /create trigger chat_participants_protect_identity[\s\S]*before update/i);
    assert.match(
      sql,
      /create constraint trigger chat_participants_direct_count[\s\S]*deferrable initially deferred/i,
    );
    assert.match(sql, /participant_count <> 2/i);
    assert.match(sql, /pg_advisory_xact_lock/i);
  });

  test("exposes the exact Team RPC contract used by the application", () => {
    assert.match(
      sql,
      /function public\.create_team\([\s\S]*team_visibility public\.chat_team_visibility/i,
    );
    assert.match(sql, /function public\.join_team\(target_thread_id uuid\)/i);
    assert.match(
      sql,
      /function public\.add_team_member\(\s*target_thread_id uuid,\s*target_user_id uuid/i,
    );
    assert.match(
      sql,
      /function public\.remove_team_member\(\s*target_thread_id uuid,\s*target_user_id uuid/i,
    );
    const createBody = sql.match(
      /function public\.create_team[\s\S]*?\$fn\$;/i,
    )?.[0];
    assert.ok(createBody);
    assert.match(createBody, /security definer/i);
    assert.match(createBody, /me uuid := auth\.uid\(\)/i);
    assert.match(createBody, /p\.deactivated_at is null/i);
  });

  test("separates closed-Team metadata management from message reading", () => {
    const viewHelper = sql.match(
      /function private\.can_view_chat_thread[\s\S]*?\$fn\$;/i,
    )?.[0];
    const readHelper = sql.match(
      /function private\.can_read_chat_messages[\s\S]*?\$fn\$;/i,
    )?.[0];

    assert.ok(viewHelper);
    assert.ok(readHelper);
    assert.match(viewHelper, /private\.is_administrator/i);
    assert.doesNotMatch(readHelper, /private\.is_administrator/i);
    assert.match(readHelper, /t\.visibility = 'open'/i);
    assert.match(readHelper, /public\.chat_participants/i);
  });

  test("retrieval is Team-only and remains security invoker", () => {
    for (const functionName of ["match_chat_messages", "search_chat_messages"]) {
      const body = sql.match(
        new RegExp(
          `function public\\.${functionName}[\\s\\S]*?\\$fn\\$;`,
          "i",
        ),
      )?.[0];
      assert.ok(body, `${functionName} is missing`);
      assert.match(body, /security invoker/i);
      assert.match(body, /t\.kind = 'team'/i);
    }
  });

  test("keeps policy helpers private while granting the policy caller execution", () => {
    const helpers = [
      "can_view_chat_thread",
      "can_read_chat_messages",
      "can_post_chat_message",
      "can_update_chat_thread",
      "can_add_team_member",
      "can_remove_team_member",
    ];

    for (const helper of helpers) {
      assert.match(
        sql,
        new RegExp(
          `revoke execute on function private\\.${helper}\\([^;]*\\)[\\s\\S]*?from public, anon, authenticated, service_role[\\s\\S]*?grant execute on function private\\.${helper}\\([^;]*\\)[\\s\\S]*?to authenticated, service_role`,
          "i",
        ),
        `${helper} does not have the required revoke-then-policy grant`,
      );
    }

    for (const triggerOnly of [
      "protect_chat_thread_kind",
      "protect_chat_participant_identity",
      "enforce_direct_participant_count",
    ]) {
      assert.match(
        sql,
        new RegExp(
          `revoke execute on function private\\.${triggerOnly}\\([^;]*\\)[\\s\\S]*?from public, anon, authenticated, service_role`,
          "i",
        ),
      );
    }
  });

  test("retention still denies hard deletion of messages", () => {
    assert.match(sql, /drop policy if exists chat_messages_delete_own/i);
    assert.doesNotMatch(sql, /grant[^;]*delete[^;]*public\.chat_messages/i);
  });
});
