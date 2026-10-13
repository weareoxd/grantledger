/**
 * Google OAuth federation for the MCP authorization server.
 *
 * The MCP server is Google's OAuth *client* here: the person signs in with Google, and on success
 * the server issues its own tokens to the MCP client (claude.ai, ChatGPT, ...). It uses its own
 * redirect URI and PKCE verifier.
 */
import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getEnv } from "@/lib/env";
import { oauthUrls } from "./config";
import type { GoogleClaims } from "./store";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
export const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];
export const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "openid",
];

export function googleRedirectUri(): string {
  const urls = oauthUrls();
  if (!urls) throw new Error("MCP_PUBLIC_URL is not set");
  return urls.googleRedirectUri;
}

function clientConfig() {
  const { GOOGLE_OAUTH2_CLIENT_ID: clientId, GOOGLE_OAUTH2_CLIENT_SECRET: clientSecret } = getEnv();
  if (!clientId || !clientSecret) {
    throw new Error(
      "GOOGLE_OAUTH2_CLIENT_ID and GOOGLE_OAUTH2_CLIENT_SECRET are required when MCP_PUBLIC_URL is set.",
    );
  }
  return { clientId, clientSecret };
}

/** A random URL-safe string (Python's secrets.token_urlsafe). */
export function tokenUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** PKCE S256: base64url(sha256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/** The Google sign-in URL for this PKCE verifier, and the state that identifies the request. */
export function buildAuthorizationUrl(codeVerifier: string): { url: string; state: string } {
  const { clientId } = clientConfig();
  const state = tokenUrlSafe(24);
  const url = new URL(GOOGLE_AUTH_URL);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    scope: SCOPES.join(" "),
    state,
    code_challenge: pkceChallenge(codeVerifier),
    code_challenge_method: "S256",
    access_type: "offline",
    include_granted_scopes: "true",
    prompt: "select_account",
  }).toString();
  return { url: url.toString(), state };
}

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined;

/** Verify a Google id_token (signature against Google's keys, issuer, audience, expiry). */
export async function verifyIdToken(idToken: string): Promise<GoogleClaims> {
  jwks ??= createRemoteJWKSet(new URL(GOOGLE_CERTS_URL));
  const { payload } = await jwtVerify(idToken, jwks, {
    issuer: GOOGLE_ISSUERS,
    audience: clientConfig().clientId,
  });
  return payload as GoogleClaims;
}

/** Exchange a Google authorization code and return the verified id_token claims. */
export async function exchangeCode(args: {
  code: string;
  codeVerifier: string;
}): Promise<GoogleClaims> {
  const { clientId, clientSecret } = clientConfig();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: googleRedirectUri(),
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: args.codeVerifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Google token exchange failed with HTTP ${response.status}`);
  }
  const payload = (await response.json()) as { id_token?: unknown };
  if (typeof payload.id_token !== "string") {
    throw new Error("Google token response had no id_token");
  }
  return verifyIdToken(payload.id_token);
}

/** MCP_ALLOWED_EMAIL_DOMAINS as a set of lower-case domains (space- or comma-separated). */
export function allowedEmailDomains(raw = getEnv().MCP_ALLOWED_EMAIL_DOMAINS): Set<string> {
  return new Set(
    (raw ?? "")
      .split(/[\s,]+/)
      .map((domain) => domain.trim().toLowerCase().replace(/^@+/, ""))
      .filter(Boolean),
  );
}

/**
 * Whether a Google identity may sign in.
 *
 * The email must be verified. MCP_ALLOWED_EMAIL_DOMAINS is an optional app-side allowlist
 * enforced as defence in depth; blank trusts the Google OAuth app's own restriction (e.g. an
 * Internal / Workspace-scoped app).
 */
export function emailDomainAllowed(
  claims: GoogleClaims,
  allowed: Set<string> = allowedEmailDomains(),
): boolean {
  if (claims.email_verified !== true && claims.email_verified !== "true") return false;
  if (allowed.size === 0) return true;
  const email = String(claims.email ?? "").toLowerCase();
  // Python's rpartition("@")[2]: the text after the last "@" (all of it when there is none).
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return Boolean(domain) && allowed.has(domain);
}

/** The Google leg of the flow, injectable so tests can stand in for Google. */
export interface GoogleFederation {
  buildAuthorizationUrl: (codeVerifier: string) => { url: string; state: string };
  exchangeCode: (args: { code: string; codeVerifier: string }) => Promise<GoogleClaims>;
}

export const google: GoogleFederation = { buildAuthorizationUrl, exchangeCode };
