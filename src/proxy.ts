import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";

/**
 * Optimistic redirect to /sign-in when there is no session cookie at all. Pages, actions and
 * route handlers still verify the session (src/lib/auth/session.ts).
 */
export function proxy(request: NextRequest) {
  if (getSessionCookie(request)) return NextResponse.next();
  const { pathname, search } = request.nextUrl;
  const signIn = new URL("/sign-in", request.url);
  if (pathname !== "/") signIn.searchParams.set("redirect", `${pathname}${search}`);
  return NextResponse.redirect(signIn);
}

export const config = {
  // Everything except the sign-in page, API routes (they answer 401 themselves; redirecting them
  // would hand fetch() a sign-in page), OAuth metadata, Next internals and static files.
  matcher: [
    "/((?!sign-in|api/|\\.well-known/|_next/|favicon|.*\\.(?:ico|png|svg|jpe?g|webp|gif|txt|xml|webmanifest)$).*)",
  ],
};
