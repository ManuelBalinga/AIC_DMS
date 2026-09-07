import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

/** Routes reachable without a session. Everything else requires login. */
const PUBLIC_ROUTES = [
  "/login",
  "/auth/callback",
  "/auth/set-password",
  "/auth/forgot-password",
  "/auth/error",
];

function isPublicRoute(pathname: string) {
  return PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

export default async function proxy(request: NextRequest) {
  /*
   * One id per request, minted here because this runs before everything else.
   *
   * It is what joins the events a single click produces: finalising an upload
   * and then indexing it are two events, emitted seconds apart, and without a
   * shared id they are two unrelated rows. An id supplied by the caller is
   * honoured so a trace started upstream survives; otherwise one is made.
   *
   * It also goes back on the response, so a member reporting a problem can
   * read it out of their own network tab.
   */
  const requestId = request.headers.get("x-request-id") ?? crypto.randomUUID();
  request.headers.set("x-request-id", requestId);

  let response = NextResponse.next({ request });
  response.headers.set("x-request-id", requestId);

  // The cookie jar is rebuilt on refresh, which drops headers set above, so
  // the id is re-applied wherever a new response is created.
  const supabase = createServerClient(
    publicEnv.supabaseUrl,
    publicEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          response.headers.set("x-request-id", requestId);
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // Refreshes the auth token and keeps the cookie jar in sync. Do not remove:
  // without this call the session silently expires mid-use.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (!user && !isPublicRoute(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    const redirect = NextResponse.redirect(loginUrl);
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  if (user && pathname === "/login") {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    const redirect = NextResponse.redirect(dashboardUrl);
    redirect.headers.set("x-request-id", requestId);
    return redirect;
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except Next internals and static assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
