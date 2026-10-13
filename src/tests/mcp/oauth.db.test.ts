/**
 * The MCP OAuth 2.1 authorization server (Google federation) and the /api/mcp bearer gate. The
 * Google leg is stubbed; these cover the domain policy, token round trips, dynamic client
 * registration, the full authorize -> Google callback -> code -> token -> verify flow, and the
 * HTTP route handlers.
 */
import {
  OAuthMetadataSchema,
  OAuthProtectedResourceMetadataSchema,
  OAuthTokensSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as authServerMetadata } from "@/app/.well-known/oauth-authorization-server/route";
import { GET as resourceMetadata } from "@/app/.well-known/oauth-protected-resource/api/mcp/route";
import { GET as rootResourceMetadata } from "@/app/.well-known/oauth-protected-resource/route";
import { DELETE as mcpDelete, GET as mcpGet, POST as mcpPost } from "@/app/api/mcp/route";
import { GET as authorizeGet } from "@/app/api/mcp-oauth/authorize/route";
import { GET as callbackGet } from "@/app/api/mcp-oauth/google/callback/route";
import {
  OPTIONS as registerOptions,
  POST as registerPost,
} from "@/app/api/mcp-oauth/register/route";
import { POST as revokePost } from "@/app/api/mcp-oauth/revoke/route";
import { POST as tokenPost } from "@/app/api/mcp-oauth/token/route";
import { closeDb, getDb } from "@/lib/db";
import { mcpUser, oauthAuthorizationRequest, oauthRevokedToken } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import {
  allowedEmailDomains,
  emailDomainAllowed,
  type GoogleFederation,
  google,
  pkceChallenge,
} from "@/lib/mcp/oauth/google";
import {
  authorizeHandler,
  googleCallbackHandler,
  redirectUriMatches,
} from "@/lib/mcp/oauth/handlers";
import { verifyAccessToken } from "@/lib/mcp/oauth/provider";
import { getClient, purgeExpiredOAuthRows, saveClient } from "@/lib/mcp/oauth/store";
import { decodeToken, mintAccessToken, mintRefreshToken } from "@/lib/mcp/oauth/tokens";
import { resetRateLimits } from "@/lib/server/rate-limit";
import { resetDb } from "@/tests/db/helpers";

const ISSUER = "https://mcp.test.example";
const CLIENT_REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "a-pkce-verifier-that-is-long-enough-to-be-realistic-0123456789";
const SERVICE_KEY = "test-service-key";

function enableOAuth() {
  vi.stubEnv("MCP_PUBLIC_URL", ISSUER);
  vi.stubEnv("MCP_ALLOWED_EMAIL_DOMAINS", "example.org");
  vi.stubEnv("GOOGLE_OAUTH2_CLIENT_ID", "google-client-id");
  vi.stubEnv("GOOGLE_OAUTH2_CLIENT_SECRET", "google-client-secret");
  vi.stubEnv("MCP_ACCESS_TOKEN_TTL", "3600");
  vi.stubEnv("MCP_REFRESH_TOKEN_TTL_DAYS", "30");
  resetEnvCache();
}

function disableOAuth() {
  vi.stubEnv("MCP_PUBLIC_URL", "");
  resetEnvCache();
}

/** Google, stood in for: the callback's code exchange returns these claims. */
function fakeGoogle(claims: Record<string, unknown>): GoogleFederation {
  return { ...google, exchangeCode: async () => claims };
}

function form(url: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields),
  });
}

async function register(metadata: Record<string, unknown> = {}) {
  const response = await registerPost(
    new Request(`${ISSUER}/api/mcp-oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        redirect_uris: [CLIENT_REDIRECT],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        client_name: "Test client",
        ...metadata,
      }),
    }),
  );
  return { response, body: await response.json() };
}

function authorizeUrl(clientId: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: CLIENT_REDIRECT,
    response_type: "code",
    code_challenge: pkceChallenge(VERIFIER),
    code_challenge_method: "S256",
    state: "mcp-state",
    resource: `${ISSUER}/api/mcp`,
    ...extra,
  });
  return `${ISSUER}/api/mcp-oauth/authorize?${params}`;
}

/** Authorize, and return the Google state from the sign-in URL it redirects to. */
async function authorize(clientId: string): Promise<string> {
  const response = await authorizeGet(new Request(authorizeUrl(clientId)));
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location") as string);
  expect(location.origin).toBe("https://accounts.google.com");
  expect(location.searchParams.get("code_challenge_method")).toBe("S256");
  expect(location.searchParams.get("prompt")).toBe("select_account");
  expect(location.searchParams.get("redirect_uri")).toBe(`${ISSUER}/api/mcp-oauth/google/callback`);
  return location.searchParams.get("state") as string;
}

async function callback(googleState: string, claims: Record<string, unknown>) {
  return googleCallbackHandler(
    new Request(`${ISSUER}/api/mcp-oauth/google/callback?state=${googleState}&code=google-code`),
    fakeGoogle(claims),
  );
}

async function token(fields: Record<string, string>) {
  const response = await tokenPost(form(`${ISSUER}/api/mcp-oauth/token`, fields));
  return { response, body: await response.json() };
}

const PERSON = {
  email: "person@example.org",
  email_verified: true,
  given_name: "Pat",
  family_name: "Lee",
};

/** Register, sign in through (fake) Google, and return the client id and authorization code. */
async function signIn(claims: Record<string, unknown> = PERSON) {
  const { body: client } = await register();
  const googleState = await authorize(client.client_id);
  const response = await callback(googleState, claims);
  expect(response.status).toBe(302);
  const location = new URL(response.headers.get("location") as string);
  return { clientId: client.client_id as string, location, googleState };
}

function mcpRequest(body: unknown, token?: string) {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

const TOOLS_LIST = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };

beforeEach(async () => {
  await resetDb();
  resetRateLimits();
  enableOAuth();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

afterAll(async () => {
  await closeDb();
});

describe("email domain policy", () => {
  const allowed = allowedEmailDomains("example.org");

  it("allows a verified address on an allowed domain", () => {
    expect(emailDomainAllowed({ email: "a@example.org", email_verified: true }, allowed)).toBe(
      true,
    );
    expect(emailDomainAllowed({ email: "a@Example.ORG", email_verified: true }, allowed)).toBe(
      true,
    );
  });

  it("denies another domain and unverified addresses", () => {
    expect(emailDomainAllowed({ email: "a@gmail.com", email_verified: true }, allowed)).toBe(false);
    expect(emailDomainAllowed({ email: "a@example.org", email_verified: false }, allowed)).toBe(
      false,
    );
    expect(emailDomainAllowed({ email: "a@example.org" }, allowed)).toBe(false);
  });

  it("trusts Google with an empty allowlist but still requires a verified address", () => {
    const none = allowedEmailDomains("");
    expect(emailDomainAllowed({ email: "a@any.com", email_verified: true }, none)).toBe(true);
    expect(emailDomainAllowed({ email: "a@any.com", email_verified: false }, none)).toBe(false);
  });

  it("parses the setting", () => {
    expect([...allowedEmailDomains(" @Example.org, other.ca  third.net ")]).toEqual([
      "example.org",
      "other.ca",
      "third.net",
    ]);
    expect(emailDomainAllowed({ email: "a@other.ca", email_verified: true })).toBe(false);
  });
});

describe("tokens", () => {
  it("round-trips an access token", async () => {
    const { token: tok, jti } = await mintAccessToken({
      userId: 7,
      email: "a@example.org",
      clientId: "c",
      scopes: ["read"],
    });
    const claims = await decodeToken(tok);
    expect([claims.typ, claims.sub, claims.jti, claims.scope]).toEqual([
      "access",
      "7",
      jti,
      "read",
    ]);
    expect(claims.iss).toBe(ISSUER);
    expect(claims.aud).toBe(`${ISSUER}/api/mcp`);
    expect(claims.exp - claims.iat).toBe(3600);
  });

  it("rejects a tampered token", async () => {
    const { token: tok } = await mintAccessToken({
      userId: 1,
      email: "a@example.org",
      clientId: "c",
      scopes: [],
    });
    await expect(decodeToken(`${tok}tamper`)).rejects.toThrow();
  });

  it("does not accept a refresh token as an access token", async () => {
    const { token: tok } = await mintRefreshToken({
      userId: 1,
      email: "a@example.org",
      clientId: "c",
      scopes: [],
    });
    expect(await verifyAccessToken(tok)).toBeUndefined();
  });
});

describe("provider", () => {
  it("accepts the static service key", async () => {
    const info = await verifyAccessToken(SERVICE_KEY);
    expect(info?.extra?.subject).toBe("service-key");
    expect(info?.clientId).toBe("service-key");
  });

  it("rejects a bad token", async () => {
    expect(await verifyAccessToken("not-a-jwt")).toBeUndefined();
  });

  it("registers and loads a client", async () => {
    await saveClient({
      client_id: "client-123",
      redirect_uris: [CLIENT_REDIRECT],
      token_endpoint_auth_method: "none",
    });
    expect((await getClient("client-123"))?.client_id).toBe("client-123");
    expect(await getClient("nope")).toBeUndefined();
  });

  it("runs the full login flow", async () => {
    const { clientId, location, googleState } = await signIn();
    expect(location.href.startsWith(CLIENT_REDIRECT)).toBe(true);
    expect(location.searchParams.get("state")).toBe("mcp-state");
    const code = location.searchParams.get("code") as string;
    expect(code).toBeTruthy();

    const [user] = await getDb()
      .select()
      .from(mcpUser)
      .where(eq(mcpUser.email, "person@example.org"));
    expect(user).toMatchObject({ firstName: "Pat", lastName: "Lee", isActive: true });

    const exchange = {
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      client_id: clientId,
      redirect_uri: CLIENT_REDIRECT,
    };
    const issued = await token(exchange);
    expect(issued.response.status).toBe(200);
    expect(issued.response.headers.get("cache-control")).toBe("no-store");
    const tokens = OAuthTokensSchema.parse(issued.body);
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.expires_in).toBe(3600);

    const access = await verifyAccessToken(tokens.access_token);
    expect(access?.extra?.subject).toBe(String(user?.id));
    expect(access?.clientId).toBe(clientId);
    expect(access?.resource?.href).toBe(`${ISSUER}/api/mcp`);

    // The authorization code is single-use.
    const again = await token(exchange);
    expect(again.response.status).toBe(400);
    expect(again.body.error).toBe("invalid_grant");

    // A finished request cannot be completed again.
    expect((await callback(googleState, PERSON)).status).toBe(400);

    // Refresh rotates: the old refresh token stops working.
    const refresh = {
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token as string,
      client_id: clientId,
    };
    const rotated = await token(refresh);
    expect(rotated.response.status).toBe(200);
    expect(rotated.body.refresh_token).not.toBe(tokens.refresh_token);
    const reused = await token(refresh);
    expect(reused.response.status).toBe(400);
    expect(reused.body).toMatchObject({
      error: "invalid_grant",
      error_description: "refresh token does not exist",
    });

    // The access token opens /api/mcp.
    const listed = await mcpPost(mcpRequest(TOOLS_LIST, tokens.access_token));
    expect(listed.status).toBe(200);
    expect((await listed.json()).result.tools).toHaveLength(17);

    // Revoked, it no longer does.
    const revoked = await revokePost(
      form(`${ISSUER}/api/mcp-oauth/revoke`, { token: tokens.access_token, client_id: clientId }),
    );
    expect(revoked.status).toBe(200);
    expect(await verifyAccessToken(tokens.access_token)).toBeUndefined();
    expect((await mcpPost(mcpRequest(TOOLS_LIST, tokens.access_token))).status).toBe(401);
  });

  it("checks the PKCE verifier and the redirect_uri", async () => {
    const { clientId, location } = await signIn();
    const code = location.searchParams.get("code") as string;
    const wrongVerifier = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: "not-the-verifier",
      client_id: clientId,
      redirect_uri: CLIENT_REDIRECT,
    });
    expect(wrongVerifier.body).toMatchObject({
      error: "invalid_grant",
      error_description: "incorrect code_verifier",
    });
    const missingRedirect = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      client_id: clientId,
    });
    expect(missingRedirect.body.error).toBe("invalid_request");
    const otherClient = await register();
    const stolen = await token({
      grant_type: "authorization_code",
      code,
      code_verifier: VERIFIER,
      client_id: otherClient.body.client_id,
      redirect_uri: CLIENT_REDIRECT,
    });
    expect(stolen.body.error).toBe("invalid_grant");
  });

  it("denies a Google account on another domain", async () => {
    const { location } = await signIn({ email: "outsider@gmail.com", email_verified: true });
    expect(location.searchParams.get("error")).toBe("access_denied");
    expect(location.searchParams.get("state")).toBe("mcp-state");
    const users = await getDb()
      .select()
      .from(mcpUser)
      .where(eq(mcpUser.email, "outsider@gmail.com"));
    expect(users).toEqual([]);
  });

  it("reports a failed Google exchange and Google errors to the client", async () => {
    const { body: client } = await register();
    const googleState = await authorize(client.client_id);
    const failing: GoogleFederation = {
      ...google,
      exchangeCode: async () => {
        throw new Error("boom");
      },
    };
    const failed = await googleCallbackHandler(
      new Request(`${ISSUER}/api/mcp-oauth/google/callback?state=${googleState}&code=x`),
      failing,
    );
    const location = new URL(failed.headers.get("location") as string);
    expect(location.searchParams.get("error")).toBe("server_error");
    expect(location.searchParams.get("error_description")).toBe("Google token exchange failed");

    const denied = await callbackGet(
      new Request(
        `${ISSUER}/api/mcp-oauth/google/callback?state=${googleState}&error=access_denied`,
      ),
    );
    expect(new URL(denied.headers.get("location") as string).searchParams.get("error")).toBe(
      "access_denied",
    );

    const missing = await callbackGet(new Request(`${ISSUER}/api/mcp-oauth/google/callback`));
    expect(missing.status).toBe(400);
    expect(await missing.text()).toBe("Missing state parameter.");
    const unknown = await callbackGet(
      new Request(`${ISSUER}/api/mcp-oauth/google/callback?state=nope&code=x`),
    );
    expect(await unknown.text()).toBe("Login request expired or invalid. Please try again.");
  });

  it("purges expired rows", async () => {
    const { body: client } = await register();
    await authorize(client.client_id);
    await getDb()
      .insert(oauthRevokedToken)
      .values([
        { jti: "old", expiresAt: new Date(Date.now() - 1000) },
        { jti: "live", expiresAt: new Date(Date.now() + 60_000) },
      ]);
    await getDb()
      .update(oauthAuthorizationRequest)
      .set({ expiresAt: sql`now() - interval '1 minute'` });
    expect(await purgeExpiredOAuthRows()).toEqual({ requests: 1, revokedTokens: 1 });
    const left = await getDb().select().from(oauthRevokedToken);
    expect(left.map((row) => row.jti)).toEqual(["live"]);
  });
});

describe("HTTP: metadata", () => {
  it("serves authorization server metadata", async () => {
    const response = await authServerMetadata();
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const metadata = OAuthMetadataSchema.parse(await response.json());
    expect(metadata).toMatchObject({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/api/mcp-oauth/authorize`,
      token_endpoint: `${ISSUER}/api/mcp-oauth/token`,
      registration_endpoint: `${ISSUER}/api/mcp-oauth/register`,
      revocation_endpoint: `${ISSUER}/api/mcp-oauth/revoke`,
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("serves protected resource metadata at both paths", async () => {
    for (const handler of [resourceMetadata, rootResourceMetadata]) {
      const metadata = OAuthProtectedResourceMetadataSchema.parse(await (await handler()).json());
      expect(metadata.resource).toBe(`${ISSUER}/api/mcp`);
      expect(metadata.authorization_servers).toEqual([ISSUER]);
    }
  });

  it("answers 404 while OAuth is off", async () => {
    disableOAuth();
    for (const response of [
      await authServerMetadata(),
      await resourceMetadata(),
      await registerPost(new Request(`${ISSUER}/api/mcp-oauth/register`, { method: "POST" })),
      await tokenPost(form(`${ISSUER}/api/mcp-oauth/token`, {})),
      await authorizeGet(new Request(authorizeUrl("x"))),
      await callbackGet(new Request(`${ISSUER}/api/mcp-oauth/google/callback?state=x`)),
    ]) {
      expect(response.status).toBe(404);
    }
  });

  it("answers CORS preflights", async () => {
    const response = await registerOptions(
      new Request(`${ISSUER}/api/mcp-oauth/register`, {
        method: "OPTIONS",
        headers: { "Access-Control-Request-Headers": "content-type" },
      }),
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("access-control-allow-headers")).toBe("content-type");
  });
});

describe("HTTP: register", () => {
  it("registers a public client without a secret", async () => {
    const { response, body } = await register();
    expect(response.status).toBe(201);
    expect(body.client_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.client_secret).toBeUndefined();
    expect(body.client_id_issued_at).toBeGreaterThan(0);
    expect((await getClient(body.client_id))?.redirect_uris).toEqual([CLIENT_REDIRECT]);
  });

  it("gives a confidential client an expiring secret", async () => {
    const { body } = await register({ token_endpoint_auth_method: "client_secret_post" });
    expect(body.client_secret).toMatch(/^[0-9a-f]{64}$/);
    expect(body.client_secret_expires_at - body.client_id_issued_at).toBe(30 * 24 * 60 * 60);
  });

  it("rejects invalid metadata", async () => {
    const { response, body } = await register({ redirect_uris: ["not a url"] });
    expect(response.status).toBe(400);
    expect(body.error).toBe("invalid_client_metadata");
  });

  it("is rate limited per IP", async () => {
    // Behind the load balancer: its hop (10.0.0.1) is trusted, the address before it is the client
    vi.stubEnv("TRUSTED_PROXIES", "10.0.0.0/8");
    resetEnvCache();
    const request = () =>
      registerPost(
        new Request(`${ISSUER}/api/mcp-oauth/register`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Forwarded-For": "203.0.113.9, 10.0.0.1",
          },
          body: JSON.stringify({
            redirect_uris: [CLIENT_REDIRECT],
            token_endpoint_auth_method: "none",
          }),
        }),
      );
    for (let i = 0; i < 20; i++) expect((await request()).status).toBe(201);
    const limited = await request();
    expect(limited.status).toBe(429);
    expect((await limited.json()).error).toBe("too_many_requests");
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
    // Another address is unaffected.
    expect((await register()).response.status).toBe(201);
  });
});

describe("HTTP: authorize", () => {
  it("answers client errors directly", async () => {
    const unknown = await authorizeGet(new Request(authorizeUrl("no-such-client")));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toBe("invalid_client");

    const { body: client } = await register();
    const unregistered = await authorizeGet(
      new Request(authorizeUrl(client.client_id, { redirect_uri: "https://evil.example/cb" })),
    );
    expect(unregistered.status).toBe(400);
    expect(await unregistered.json()).toMatchObject({
      error: "invalid_request",
      error_description: "Unregistered redirect_uri",
    });
  });

  it("sends later errors to the redirect URI", async () => {
    const { body: client } = await register();
    const response = await authorizeHandler(
      new Request(authorizeUrl(client.client_id, { code_challenge_method: "plain" })),
    );
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get("location") as string);
    expect(location.href.startsWith(CLIENT_REDIRECT)).toBe(true);
    expect(location.searchParams.get("error")).toBe("invalid_request");
    expect(location.searchParams.get("state")).toBe("mcp-state");
  });

  it("matches loopback redirect URIs on any port", () => {
    expect(redirectUriMatches("http://127.0.0.1:5555/cb", "http://127.0.0.1/cb")).toBe(true);
    expect(redirectUriMatches("http://localhost:5555/cb", "http://127.0.0.1/cb")).toBe(false);
    expect(redirectUriMatches("https://a.example:444/cb", "https://a.example/cb")).toBe(false);
    expect(redirectUriMatches("http://localhost:1/cb?x=1", "http://localhost:2/cb")).toBe(false);
  });
});

describe("HTTP: token", () => {
  it("rejects bad requests", async () => {
    expect((await token({ grant_type: "authorization_code" })).body.error).toBe("invalid_request");
    expect((await token({ grant_type: "authorization_code", client_id: "nope" })).body.error).toBe(
      "invalid_client",
    );
    const { body: client } = await register();
    const unsupported = await token({
      grant_type: "client_credentials",
      client_id: client.client_id,
    });
    expect(unsupported.response.status).toBe(400);
    expect(unsupported.body.error).toBe("unsupported_grant_type");
    const unknownCode = await token({
      grant_type: "authorization_code",
      client_id: client.client_id,
      code: "nope",
      code_verifier: VERIFIER,
    });
    expect(unknownCode.body).toMatchObject({
      error: "invalid_grant",
      error_description: "authorization code does not exist",
    });
    expect(unknownCode.response.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("authenticates confidential clients", async () => {
    const { body: client } = await register({ token_endpoint_auth_method: "client_secret_post" });
    const base = { grant_type: "refresh_token", refresh_token: "x", client_id: client.client_id };
    expect((await token(base)).body).toMatchObject({
      error: "invalid_client",
      error_description: "Client secret is required",
    });
    expect((await token({ ...base, client_secret: "wrong" })).body.error_description).toBe(
      "Invalid client_secret",
    );
    expect((await token({ ...base, client_secret: client.client_secret })).body).toMatchObject({
      error: "invalid_grant",
    });
  });
});

describe("HTTP: /api/mcp", () => {
  it("requires the static key when OAuth is off", async () => {
    disableOAuth();
    const missing = await mcpPost(mcpRequest(TOOLS_LIST));
    expect(missing.status).toBe(401);
    expect(missing.headers.get("www-authenticate")).toBe('Bearer realm="mcp"');
    expect((await mcpPost(mcpRequest(TOOLS_LIST, "wrong-key"))).status).toBe(401);

    const ok = await mcpPost(mcpRequest(TOOLS_LIST, SERVICE_KEY));
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.result.tools.map((t: { name: string }) => t.name)).toContain("award_totals");
  });

  it("fails closed without a key", async () => {
    disableOAuth();
    vi.stubEnv("MCP_API_KEY", "");
    resetEnvCache();
    const response = await mcpPost(mcpRequest(TOOLS_LIST, "anything"));
    expect(response.status).toBe(401);
    expect((await response.json()).detail).toContain("no MCP_API_KEY set");
  });

  it("points unauthenticated clients at the resource metadata when OAuth is on", async () => {
    const response = await mcpPost(mcpRequest(TOOLS_LIST));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/api/mcp"`,
    );
    const invalid = await mcpPost(mcpRequest(TOOLS_LIST, "not-a-token"));
    expect(invalid.status).toBe(401);
    expect(invalid.headers.get("www-authenticate")).toContain('error="invalid_token"');
    // The static key still works.
    expect((await mcpPost(mcpRequest(TOOLS_LIST, SERVICE_KEY))).status).toBe(200);
  });

  it("refuses GET and DELETE", async () => {
    for (const handler of [mcpGet, mcpDelete]) {
      const response = handler();
      expect(response.status).toBe(405);
      expect(response.headers.get("allow")).toBe("POST");
    }
  });
});
