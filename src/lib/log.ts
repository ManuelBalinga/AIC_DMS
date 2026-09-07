/**
 * The logger. One of them, for the whole application.
 *
 * The pattern is the canonical log line, also called a wide event: **one
 * context-rich JSON object per request**, emitted once when the request
 * finishes, rather than a scatter of lines through the handler. A scatter
 * cannot be queried — "show me every failed upload by a member on a phone" is
 * unanswerable when the user, the outcome and the device each live on a
 * different line. One wide row answers it, and answers questions nobody
 * thought to ask when the code was written.
 *
 * Output is JSON on stdout, which is what a serverless host collects. There is
 * no logging dependency on purpose: this project runs 200-odd tests on
 * `node:test` with no framework, and a log line is `JSON.stringify` of an
 * object. A library would buy transports and redaction we do not use yet.
 *
 * Two levels, `info` and `error`, and nothing between. `warn` is where events
 * go to be ignored: nobody pages on it and nobody reads it, so a real problem
 * logged at `warn` is a problem nobody sees.
 */

/** What a wide event may hold. Structured values only — never a bare string. */
export type LogValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | LogValue[]
  | { [key: string]: LogValue };

export type LogFields = Record<string, LogValue>;

/**
 * Facts about the deployment, attached to every event.
 *
 * Without these, a log tells you something broke but not *where* — and the
 * first question about any new failure is whether it started with the last
 * deploy. `commit` answers that. Read lazily so a value set after module load
 * is still picked up, and so importing the logger never throws on a missing
 * variable the way `env.ts` deliberately does.
 */
function deployment(): LogFields {
  return {
    service: "aic-dms",
    environment:
      process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 8) ?? null,
    region: process.env.VERCEL_REGION ?? null,
  };
}

/**
 * Keys whose values never reach the log, whatever a caller passes.
 *
 * A document platform's logs must not slowly become a copy of the documents,
 * a staff directory, or a credential store. The permission model is enforced
 * in Postgres and would be undone by a log file that quietly accumulates the
 * contents it protects. Ids are kept — they are what makes an event
 * queryable — and the values behind them stay in the database, where the
 * policies are.
 */
const REDACTED = new Set([
  "password",
  "token",
  "access_token",
  "refresh_token",
  "apiKey",
  "api_key",
  "authorization",
  "cookie",
  "email",
  "content",
  "body",
  "answer",
  "question",
  "snippet",
  "storage_path",
  "storagePath",
]);

function redact(value: LogValue, depth = 0): LogValue {
  // Depth-bounded: a cyclic or pathologically nested object must not be able to
  // take the process down through the logger, of all things.
  if (depth > 6) return "[deep]";
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, LogValue> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = REDACTED.has(key) ? "[redacted]" : redact(inner, depth + 1);
    }
    return out;
  }
  return value;
}

function emit(level: "info" | "error", fields: LogFields) {
  const line = JSON.stringify({
    level,
    timestamp: new Date().toISOString(),
    ...deployment(),
    ...(redact(fields) as LogFields),
  });

  // stderr for errors so a host that separates the streams keeps that split.
  if (level === "error") process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  info: (fields: LogFields) => emit("info", fields),
  error: (fields: LogFields) => emit("error", fields),
};

/* -------------------------------------------------------------------------- */
/* Wide events                                                                */
/* -------------------------------------------------------------------------- */

/**
 * An error, reduced to what is safe and useful to keep.
 *
 * The message is kept because it is the diagnosis — this is the field that
 * would have named "Document storage binding is invalid" the first time an
 * upload failed, instead of leaving a generic apology on screen and nothing
 * behind it. The stack is kept only outside production, where it is a
 * developer reading it rather than a log aggregator storing it.
 */
export function describeError(error: unknown): LogFields {
  if (error instanceof Error) {
    return {
      type: error.name,
      message: error.message,
      ...(process.env.NODE_ENV === "production"
        ? {}
        : { stack: error.stack?.split("\n").slice(0, 4).join(" | ") ?? null }),
    };
  }
  return { type: "unknown", message: String(error) };
}

export type WideEvent = {
  /** Add business context as it becomes known. Merged into the final event. */
  set: (fields: LogFields) => void;
  /** Record the failure. Does not emit; the `finally` block still does that. */
  fail: (error: unknown, extra?: LogFields) => void;
  /** Emit exactly once. Safe to call twice; the second call does nothing. */
  end: (fields?: LogFields) => void;
};

/**
 * Starts a wide event for one request.
 *
 * Call `end()` in a `finally` block. That placement is the whole point: an
 * event emitted on the success path only is missing precisely the requests
 * worth reading about.
 */
export function startEvent(base: LogFields): WideEvent {
  const startedAt = Date.now();
  const fields: LogFields = { ...base };
  let failed = false;
  let ended = false;

  return {
    set(next) {
      Object.assign(fields, next);
    },
    fail(error, extra) {
      failed = true;
      fields.error = describeError(error);
      if (extra) Object.assign(fields, extra);
    },
    end(next) {
      if (ended) return;
      ended = true;
      if (next) Object.assign(fields, next);
      fields.duration_ms = Date.now() - startedAt;

      /*
       * Outcome follows the status code, not merely whether something threw.
       *
       * The first version recorded a 409 as a success, because the handler
       * returned a rejection rather than raising one. That is worse than not
       * logging it: the row is queryable and wrong, so "show me failed
       * uploads" comes back clean while members are being turned away. A
       * handler that returns a refusal is refusing.
       */
      const status = typeof fields.status_code === "number" ? fields.status_code : null;
      fields.outcome ??= failed || (status !== null && status >= 500)
        ? "error"
        : status !== null && status >= 400
          ? "rejected"
          : "success";

      // 5xx and thrown errors are ours; a 4xx is the request's, and belongs on
      // stdout with everything else rather than in the error stream.
      if (failed || fields.outcome === "error") logger.error(fields);
      else logger.info(fields);
    },
  };
}
