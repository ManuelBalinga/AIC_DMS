import type { Instrumentation } from "next";

import { logger, describeError } from "@/lib/log";

/**
 * Server-error reporting.
 *
 * This exists to keep a promise the error page already makes. `app/error.tsx`
 * tells a member: *"send an administrator the reference below"* — and until
 * now there was nowhere for that administrator to look. The reference is
 * React's `digest`, a hash Next shows the browser precisely so the real
 * message, which may carry a database error or a storage path, never reaches
 * a screen. That design is right, and it is only half a system: the digest is
 * useful when something on the server writes it down next to the real cause.
 * This is that half.
 *
 * So `212777269@E7` on a member's screen becomes one greppable line here,
 * carrying the route that failed, the kind of failure, and the message.
 *
 * The error Next hands us may not be the one that was thrown — React can
 * replace it while rendering Server Components — which is exactly why the
 * digest, not the message, is the identifier that ties the two ends together.
 */
export const onRequestError: Instrumentation.onRequestError = (
  error,
  request,
  context,
) => {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest?: unknown }).digest)
      : null;

  logger.error({
    event: "server_error",
    // The reference a member can read off their screen and quote to somebody.
    digest,
    path: request.path,
    method: request.method,
    route: context.routePath,
    // 'render' is a Server Component, 'route' a handler, 'action' a Server
    // Action. Worth keeping: the same message means different things in each,
    // and it decides where to start looking.
    route_type: context.routeType,
    router: context.routerKind,
    render_source: context.renderSource ?? null,
    error: describeError(error),
  });
};
