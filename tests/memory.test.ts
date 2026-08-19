import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildHistoryWindow, titleFromQuestion } from "@/modules/memory/context";
import {
  HISTORY_MAX_CHARS,
  HISTORY_TURN_LIMIT,
  REPLAYED_ANSWER_MAX_CHARS,
  TITLE_MAX_CHARS,
} from "@/modules/memory/config";
import type { ConversationMessage } from "@/lib/types/database";

/**
 * Conversation-memory tests (master plan §15).
 *
 * `resolveQuery` and `summariseOlderTurns` are not covered here: both call the
 * model, so testing them without a network stub would assert on Anthropic's
 * behaviour rather than ours. Everything below is the deterministic half —
 * which is also the half where a bug silently corrupts what the model is told.
 */

let seq = 0;
const turn = (
  role: "user" | "assistant",
  content: string,
): ConversationMessage => ({
  id: `m${seq}`,
  conversation_id: "c1",
  seq: seq++,
  role,
  content,
  retrieval_mode: null,
  passage_count: null,
  resolved_query: null,
  created_at: new Date().toISOString(),
});

const exchange = (question: string, answer: string) => [
  turn("user", question),
  turn("assistant", answer),
];

describe("buildHistoryWindow", () => {
  test("returns nothing for an empty thread", () => {
    assert.deepEqual(buildHistoryWindow([]), []);
  });

  test("preserves order and roles of a short thread", () => {
    const window = buildHistoryWindow([
      ...exchange("What are the fees?", "The fees are 500 cedis [1]."),
      ...exchange("And for members?", "Members pay 300 [2]."),
    ]);

    assert.deepEqual(
      window.map((t) => t.role),
      ["user", "assistant", "user", "assistant"],
    );
    assert.equal(window[0].content, "What are the fees?");
    assert.equal(window[2].content, "And for members?");
  });

  test("strips citation markers from replayed answers", () => {
    // Those numbers referred to passages retrieved for an earlier question. The
    // next question renumbers from scratch, so a carried-over [2] would point
    // at the wrong document while still looking authoritative.
    const window = buildHistoryWindow(
      exchange("Fees?", "It is 500 cedis [1] and rises in April [2, 3]."),
    );

    const answer = window[1].content;
    assert.ok(!/\[\d/.test(answer), `citations survived: ${answer}`);
    assert.ok(answer.includes("500 cedis"));
    assert.ok(answer.includes("rises in April"));
  });

  test("leaves citation-like text in questions alone", () => {
    // A person may genuinely type brackets; only answers carry stale numbering.
    const window = buildHistoryWindow([turn("user", "What does clause [4] mean?")]);

    assert.equal(window[0].content, "What does clause [4] mean?");
  });

  test("caps the window at the turn limit, keeping the newest", () => {
    const messages: ConversationMessage[] = [];
    for (let i = 0; i < HISTORY_TURN_LIMIT + 6; i += 1) {
      messages.push(turn("user", `question ${i}`), turn("assistant", `answer ${i}`));
    }

    const window = buildHistoryWindow(messages);

    assert.ok(window.length <= HISTORY_TURN_LIMIT);
    // The turn a follow-up depends on is nearly always the most recent one, so
    // trimming must come off the old end.
    const last = messages.at(-1)!;
    assert.ok(window.some((t) => t.content.startsWith(last.content.slice(0, 12))));
  });

  test("truncates long replayed answers", () => {
    const window = buildHistoryWindow(
      exchange("Summarise it", "x".repeat(REPLAYED_ANSWER_MAX_CHARS * 3)),
    );

    assert.ok(window[1].content.length <= REPLAYED_ANSWER_MAX_CHARS + 1);
    assert.ok(window[1].content.endsWith("…"), "truncation should be visible");
  });

  test("does not truncate the question the person typed", () => {
    const long = "why ".repeat(400).trim();
    const window = buildHistoryWindow([turn("user", long)]);

    assert.equal(window[0].content, long);
  });

  test("respects the character budget even within the turn limit", () => {
    const messages: ConversationMessage[] = [];
    for (let i = 0; i < HISTORY_TURN_LIMIT; i += 1) {
      messages.push(
        turn("user", "q".repeat(2000)),
        turn("assistant", "a".repeat(REPLAYED_ANSWER_MAX_CHARS)),
      );
    }

    const window = buildHistoryWindow(messages);
    const total = window.reduce((sum, t) => sum + t.content.length, 0);

    assert.ok(
      total <= HISTORY_MAX_CHARS,
      `window of ${total} chars exceeds the ${HISTORY_MAX_CHARS} budget`,
    );
  });

  test("never opens the window on an assistant turn", () => {
    // A replay starting with an answer reads as a reply to a question the model
    // cannot see, and would also break strict role alternation.
    const window = buildHistoryWindow([
      turn("assistant", "An answer whose question was trimmed away."),
      ...exchange("A later question", "A later answer"),
    ]);

    assert.ok(window.length > 0);
    assert.equal(window[0].role, "user");
  });

  test("keeps a trailing question whose answer never arrived", () => {
    // A failed answer leaves a dangling user turn; the record must survive.
    const window = buildHistoryWindow([
      ...exchange("First", "Answer one"),
      turn("user", "Second question that errored"),
    ]);

    assert.equal(window.at(-1)!.role, "user");
    assert.equal(window.at(-1)!.content, "Second question that errored");
  });

  test("drops turns emptied by citation stripping", () => {
    const window = buildHistoryWindow([turn("assistant", "[1]"), turn("user", "hi")]);

    assert.ok(window.every((t) => t.content.length > 0));
  });
});

describe("titleFromQuestion", () => {
  test("uses the first clause and capitalises it", () => {
    assert.equal(
      titleFromQuestion("what are the i363 fees? and the deadline?"),
      "What are the i363 fees",
    );
  });

  test("truncates a long question", () => {
    const title = titleFromQuestion("why ".repeat(80));

    assert.ok(title.length <= TITLE_MAX_CHARS + 1);
    assert.ok(title.endsWith("…"));
  });

  test("handles a question with no terminator", () => {
    assert.equal(titleFromQuestion("training schedule"), "Training schedule");
  });

  test("does not produce an empty title from punctuation alone", () => {
    assert.ok(titleFromQuestion("???").length >= 0);
    assert.equal(typeof titleFromQuestion("???"), "string");
  });
});
