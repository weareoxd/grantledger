/**
 * Google sign-in through Better Auth's real endpoints, with only Google's token endpoint mocked:
 * anyone with a verified Google email gets in, as a user unless an admin gave them a role.
 */
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getAuth } from "@/lib/auth/auth";
import { createUser, ensureAdminUser, findUserByEmail, listUsers } from "@/lib/auth/users";
import { getPool } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { resetDb } from "@/tests/db/helpers";

const ORIGIN = "http://localhost:3000";

/** An unsigned id_token, as Better Auth decodes it in the callback. */
function idToken(claims: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part({
    iss: "https://accounts.google.com",
    aud: "test-client-id",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...claims,
  })}.`;
}

let googleUser: Record<string, unknown>;
const realFetch = globalThis.fetch;

/** Google's signing key, as far as Better Auth can tell: it fetches the public half from the mock */
let signingKey: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  signingKey = await generateKeyPair("RS256");
});

/** An ID token signed as Google would, for the ID-token sign-in (no redirect). */
async function signedIdToken(claims: Record<string, unknown>) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer("https://accounts.google.com")
    .setAudience("test-client-id")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(signingKey.privateKey);
}

/** Google's token endpoint answers with an id_token for `googleUser`; nothing else is mocked. */
function mockGoogle() {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      return Response.json({
        access_token: "access",
        token_type: "Bearer",
        expires_in: 3600,
        id_token: idToken(googleUser),
      });
    }
    if (url.startsWith("https://www.googleapis.com/oauth2/v3/certs")) {
      const key = await exportJWK(signingKey.publicKey);
      return Response.json({ keys: [{ ...key, kid: "test-key", alg: "RS256", use: "sig" }] });
    }
    return realFetch(input, init);
  });
}

function cookieHeader(response: Response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** Start a Google sign-in, then come back from Google: where it lands, and the cookies it set. */
async function signInWithGoogle() {
  const auth = getAuth();
  const start = await auth.handler(
    new Request(`${ORIGIN}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ provider: "google", callbackURL: "/", errorCallbackURL: "/sign-in" }),
    }),
  );
  expect(start.status).toBe(200);
  const { url } = (await start.json()) as { url: string };
  const state = new URL(url).searchParams.get("state");
  expect(new URL(url).hostname).toBe("accounts.google.com");
  const callback = await auth.handler(
    new Request(`${ORIGIN}/api/auth/callback/google?code=a-code&state=${state}`, {
      headers: { cookie: cookieHeader(start) },
    }),
  );
  return { location: callback.headers.get("location") ?? "", cookies: cookieHeader(callback) };
}

async function sessionFor(cookies: string) {
  const session = await getAuth().api.getSession({ headers: new Headers({ cookie: cookies }) });
  return session?.user as (Record<string, unknown> & { email: string; role?: string }) | undefined;
}

beforeEach(async () => {
  await resetDb();
  vi.stubEnv("GOOGLE_OAUTH2_CLIENT_ID", "test-client-id");
  vi.stubEnv("GOOGLE_OAUTH2_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("ADMIN_EMAIL", "boss@example.org");
  resetEnvCache();
  // A fresh Better Auth for these settings
  (globalThis as { __grantsAuth?: unknown }).__grantsAuth = undefined;
  googleUser = {
    sub: "google-1",
    email: "boss@example.org",
    email_verified: true,
    name: "The Boss",
    picture: "https://lh3.googleusercontent.com/a/boss",
  };
  mockGoogle();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  resetEnvCache();
  (globalThis as { __grantsAuth?: unknown }).__grantsAuth = undefined;
});

describe("Google sign-in", () => {
  it("signs the admin in to the account made for ADMIN_EMAIL, with Google's name", async () => {
    await ensureAdminUser();
    const { location, cookies } = await signInWithGoogle();
    expect(location).toBe("/");
    const user = await sessionFor(cookies);
    expect(user).toMatchObject({ email: "boss@example.org", role: "admin", name: "The Boss" });
    expect((await listUsers())[0]).toMatchObject({ joined: true, image: googleUser.picture });
  });

  it("lets in someone an admin added, as what they were added as", async () => {
    await createUser("Analyst@Example.org", "user");
    googleUser = { ...googleUser, sub: "google-2", email: "analyst@example.org", name: "Ana Lyst" };
    const { location, cookies } = await signInWithGoogle();
    expect(location).toBe("/");
    expect(await sessionFor(cookies)).toMatchObject({ email: "analyst@example.org", role: "user" });
    const accounts = await getPool().query('SELECT COUNT(*)::int AS n FROM "user"');
    expect(accounts.rows[0].n).toBe(1);
  });

  it("lets in anyone else, making them an account as a user", async () => {
    await ensureAdminUser();
    googleUser = {
      ...googleUser,
      sub: "google-3",
      email: "stranger@elsewhere.example",
      name: "A Stranger",
    };
    const { location, cookies } = await signInWithGoogle();
    expect(location).toBe("/");
    expect(await sessionFor(cookies)).toMatchObject({
      email: "stranger@elsewhere.example",
      name: "A Stranger",
      role: "user",
    });
    expect(await findUserByEmail("stranger@elsewhere.example")).toMatchObject({ role: "user" });
  });

  it("makes no account for an email Google hasn't verified", async () => {
    googleUser = {
      ...googleUser,
      sub: "google-4",
      email: "unverified@elsewhere.example",
      email_verified: false,
    };
    const { location, cookies } = await signInWithGoogle();
    expect(new URL(location, ORIGIN).searchParams.get("error")).toBe("unverified_email");
    expect(await sessionFor(cookies)).toBeUndefined();
    expect(await findUserByEmail("unverified@elsewhere.example")).toBeNull();
  });

  it("makes no account for an unverified email signing in with an ID token either", async () => {
    const auth = getAuth();
    const signIn = (claims: Record<string, unknown>) =>
      signedIdToken(claims).then((token) =>
        auth.handler(
          new Request(`${ORIGIN}/api/auth/sign-in/social`, {
            method: "POST",
            headers: { "content-type": "application/json", origin: ORIGIN },
            body: JSON.stringify({ provider: "google", idToken: { token } }),
          }),
        ),
      );
    const refused = await signIn({
      sub: "google-6",
      email: "unverified@elsewhere.example",
      email_verified: false,
      name: "Not Verified",
    });
    expect(refused.status).toBe(403);
    expect(await findUserByEmail("unverified@elsewhere.example")).toBeNull();
    // The same sign-in with a verified email works: the refusal is the email, not the token
    const accepted = await signIn({
      sub: "google-7",
      email: "verified@elsewhere.example",
      email_verified: true,
      name: "Verified",
    });
    expect(accepted.status).toBe(200);
    expect(await findUserByEmail("verified@elsewhere.example")).toMatchObject({ role: "user" });
  });

  it("doesn't let an unverified email claim someone's account", async () => {
    await createUser("analyst@example.org", "admin");
    googleUser = {
      ...googleUser,
      sub: "google-5",
      email: "analyst@example.org",
      email_verified: false,
    };
    const { location, cookies } = await signInWithGoogle();
    expect(location).toContain("/sign-in");
    expect(await sessionFor(cookies)).toBeUndefined();
  });

  it("offers no password sign-in or sign-up", async () => {
    const auth = getAuth();
    for (const path of ["/api/auth/sign-in/email", "/api/auth/sign-up/email"]) {
      const response = await auth.handler(
        new Request(`${ORIGIN}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: ORIGIN },
          body: JSON.stringify({
            email: "boss@example.org",
            password: "a-long-password-123",
            name: "x",
          }),
        }),
      );
      expect(response.status, path).toBeGreaterThanOrEqual(400);
    }
  });
});
