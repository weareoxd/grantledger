import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { UserRole } from "@/lib/domain";
import { bootstrapOnce } from "@/lib/server/bootstrap";
import { getAuth } from "./auth";

export interface SessionUser {
  id: string;
  email: string;
  /** As Google has it (or the email, for someone an admin added who hasn't signed in yet). */
  name: string;
  image: string | null;
  role: UserRole;
}

export class AuthUnavailableError extends Error {}

/**
 * The signed-in user for this request, or null (memoised per request). Normally read from the
 * signed session cookie, which Better Auth trusts for five minutes (src/lib/auth/auth.ts); `fresh`
 * reads the database instead, so a role changed or a user removed in the meantime counts at once.
 * Every decision about admin rights reads fresh.
 */
export const getSessionUser = cache(async (fresh = false): Promise<SessionUser | null> => {
  await bootstrapOnce();
  const session = await getAuth().api.getSession({
    headers: await headers(),
    query: fresh ? { disableCookieCache: true } : undefined,
  });
  if (!session) return null;
  const user = session.user as typeof session.user & { role?: string };
  return {
    id: user.id,
    email: user.email,
    name: user.name || user.email,
    image: user.image ?? null,
    role: user.role === "admin" ? "admin" : "user",
  };
});

/**
 * Required by every page, server action and route handler that reads app data. src/proxy.ts only
 * checks that a cookie exists; this is the actual authorization boundary.
 */
export async function requireUser(
  returnTo?: string,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<SessionUser> {
  const user = await getSessionUser(fresh);
  if (!user) {
    redirect(returnTo ? `/sign-in?redirect=${encodeURIComponent(returnTo)}` : "/sign-in");
  }
  return user;
}

/** For admin pages and actions: non-admins go back to the home page. */
export async function requireAdmin(returnTo?: string): Promise<SessionUser> {
  const user = await requireUser(returnTo, { fresh: true });
  if (user.role !== "admin") redirect("/");
  return user;
}

/**
 * For route handlers: the user, or a response to return as-is (401 without a session, 503 when
 * the sessions can't be read). The body is `{detail}`, as the UI's error handling expects.
 */
export async function userOrUnauthorized({
  fresh = false,
}: {
  fresh?: boolean;
} = {}): Promise<SessionUser | Response> {
  let user: SessionUser | null;
  try {
    user = await getSessionUser(fresh);
  } catch {
    return Response.json(
      { detail: "Sign-in isn't available right now. Try again in a moment." },
      { status: 503 },
    );
  }
  return (
    user ??
    Response.json(
      { detail: "Authentication credentials were not provided." },
      { status: 401, headers: { "WWW-Authenticate": "Session" } },
    )
  );
}

/** For admin-only route handlers: the admin, or a 401/403/503 response. */
export async function adminOrForbidden(): Promise<SessionUser | Response> {
  const user = await userOrUnauthorized({ fresh: true });
  if (user instanceof Response) return user;
  if (user.role !== "admin") {
    return Response.json(
      { detail: "You do not have permission to perform this action." },
      { status: 403 },
    );
  }
  return user;
}
