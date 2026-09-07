import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { logger, startEvent, describeError } from "@/lib/log";

/**
 * The logger is pure — it takes an object and writes a line — so these assert
 * what actually comes out rather than how the file is written.
 *
 * The redaction tests are the ones that matter most. This platform's whole
 * claim is that a document is readable only by the people it was shared with,
 * and a log that quietly accumulated document text, storage paths or session
 * tokens would undo that in a place no Postgres policy reaches.
 */

let out: string[] = [];
let err: string[] = [];
let restoreOut: typeof process.stdout.write;
let restoreErr: typeof process.stderr.write;

beforeEach(() => {
  out = [];
  err = [];
  restoreOut = process.stdout.write.bind(process.stdout);
  restoreErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = restoreOut;
  process.stderr.write = restoreErr;
});

const parse = (lines: string[]) => lines.map((line) => JSON.parse(line));

describe("the logger emits queryable JSON", () => {
  test("one line per call, parseable, newline-terminated", () => {
    logger.info({ event: "probe" });
    assert.equal(out.length, 1);
    assert.ok(out[0].endsWith("\n"));
    assert.equal(parse(out)[0].event, "probe");
  });

  test("every event carries level, timestamp and deployment context", () => {
    logger.info({ event: "probe" });
    const line = parse(out)[0];
    assert.equal(line.level, "info");
    assert.ok(!Number.isNaN(Date.parse(line.timestamp)));
    assert.equal(line.service, "aic-dms");
    // Present as keys even when unset, so a query never silently matches
    // nothing because the field is absent rather than null.
    assert.ok("commit" in line);
    assert.ok("environment" in line);
  });

  test("errors go to stderr, info to stdout", () => {
    logger.info({ event: "fine" });
    logger.error({ event: "broken" });
    assert.equal(out.length, 1);
    assert.equal(err.length, 1);
    assert.equal(parse(err)[0].level, "error");
  });
});

describe("the logger refuses to accumulate what the database protects", () => {
  test("secrets and PII are redacted wherever they appear", () => {
    logger.info({
      event: "probe",
      password: "hunter2",
      access_token: "eyJhbGciOi",
      email: "someone@aic.example",
      nested: { cookie: "sb-access-token=abc", deeper: { content: "the document text" } },
    });
    const raw = out[0];
    for (const secret of [
      "hunter2",
      "eyJhbGciOi",
      "someone@aic.example",
      "sb-access-token=abc",
      "the document text",
    ]) {
      assert.ok(!raw.includes(secret), `${secret} reached the log`);
    }
    const line = parse(out)[0];
    assert.equal(line.password, "[redacted]");
    assert.equal(line.nested.deeper.content, "[redacted]");
  });

  test("ids survive redaction, because they are what makes an event queryable", () => {
    logger.info({ event: "probe", user: { id: "user-123", role: "member" } });
    const line = parse(out)[0];
    assert.equal(line.user.id, "user-123");
    assert.equal(line.user.role, "member");
  });

  test("a cyclic object cannot take the process down through the logger", () => {
    const cyclic: Record<string, unknown> = { event: "probe" };
    cyclic.self = cyclic;
    assert.doesNotThrow(() => logger.info(cyclic as never));
    assert.equal(out.length, 1);
  });
});

describe("a wide event is one row per request, emitted in finally", () => {
  test("context accumulated across the request lands on a single line", () => {
    const event = startEvent({ event: "req", path: "/x" });
    event.set({ user: { id: "u1" } });
    event.set({ document: { id: "d1" } });
    event.end({ status_code: 201 });

    assert.equal(out.length, 1, "a wide event is one line, not several");
    const line = parse(out)[0];
    assert.equal(line.path, "/x");
    assert.equal(line.user.id, "u1");
    assert.equal(line.document.id, "d1");
    assert.equal(line.status_code, 201);
    assert.equal(line.outcome, "success");
    assert.equal(typeof line.duration_ms, "number");
  });

  test("a failure marks the outcome and keeps the cause", () => {
    const event = startEvent({ event: "req" });
    event.fail(new Error("Document storage binding is invalid"), {
      failed_at: "documents_insert",
    });
    event.end();

    assert.equal(out.length, 0);
    assert.equal(err.length, 1);
    const line = parse(err)[0];
    assert.equal(line.outcome, "error");
    assert.equal(line.failed_at, "documents_insert");
    assert.equal(line.error.message, "Document storage binding is invalid");
  });

  test("end is idempotent, so a finally after an early return emits once", () => {
    const event = startEvent({ event: "req" });
    event.end();
    event.end();
    assert.equal(out.length, 1);
  });

  test("an explicit outcome is not overwritten by the default", () => {
    const event = startEvent({ event: "req" });
    event.set({ outcome: "rejected" });
    event.end();
    assert.equal(parse(out)[0].outcome, "rejected");
  });
});

describe("describeError", () => {
  test("keeps the message, which is the diagnosis", () => {
    const described = describeError(new TypeError("boom"));
    assert.equal(described.type, "TypeError");
    assert.equal(described.message, "boom");
  });

  test("survives a thrown non-Error", () => {
    assert.equal(describeError("just a string").message, "just a string");
    assert.equal(describeError("just a string").type, "unknown");
  });
});

/**
 * Outcome must follow the status code, not only whether something threw.
 *
 * Caught by reading a real log line rather than by these tests: a 409 was
 * recorded as `"outcome": "success"` because the handler returned its refusal
 * instead of raising it. A wrong row is worse than a missing one — "show me
 * failed uploads" came back clean while uploads were being refused.
 */
describe("outcome follows the status code", () => {
  test("a 4xx is a rejection, and stays on stdout", () => {
    const event = startEvent({ event: "req" });
    event.end({ status_code: 409 });
    assert.equal(err.length, 0, "a refused request is not our error");
    assert.equal(parse(out)[0].outcome, "rejected");
  });

  test("a 5xx is an error, and goes to stderr", () => {
    const event = startEvent({ event: "req" });
    event.end({ status_code: 500 });
    assert.equal(out.length, 0);
    assert.equal(parse(err)[0].outcome, "error");
  });

  test("a 2xx is still a success", () => {
    const event = startEvent({ event: "req" });
    event.end({ status_code: 201 });
    assert.equal(parse(out)[0].outcome, "success");
  });

  test("a thrown failure outranks a success-looking status", () => {
    const event = startEvent({ event: "req" });
    event.fail(new Error("boom"));
    event.end({ status_code: 200 });
    assert.equal(parse(err)[0].outcome, "error");
  });
});
