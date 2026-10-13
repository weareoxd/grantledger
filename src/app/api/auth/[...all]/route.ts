import { getAuth } from "@/lib/auth/auth";
import { bootstrapOnce } from "@/lib/server/bootstrap";

/**
 * Better Auth endpoints. Accounts come only from Google sign-in (anyone's first sign-in makes them
 * a user) or from admins, server-side; there is no password sign-up, so its endpoints answer 404.
 */
async function handle(request: Request) {
  const { pathname } = new URL(request.url);
  if (pathname.startsWith("/api/auth/sign-up")) {
    return Response.json({ detail: "Not found." }, { status: 404 });
  }
  await bootstrapOnce();
  return getAuth().handler(request);
}

export const GET = handle;
export const POST = handle;
