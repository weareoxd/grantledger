/**
 * The OAuth 2.1 authorization server logic, federated to Google.
 *
 * The MCP client (claude.ai, ChatGPT, Claude Desktop) is the OAuth *client*; this server is the
 * authorization server. Human sign-in is delegated to Google (google.ts); on success the person
 * is provisioned (domain-restricted) and the server issues its own stateless JWTs (tokens.ts).
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { getEnv } from "@/lib/env";
import { google as defaultGoogle, type GoogleFederation, tokenUrlSafe } from "./google";
import {
  activeUserEmail,
  completeAuthorizationRequest,
  consumeCode,
  createAuthorizationRequest,
  findRequestByCode,
  type GoogleClaims,
  isRevoked,
  revokeJti,
  upsertMcpUser,
} from "./store";
import {
  decodeToken,
  mintAccessToken,
  mintRefreshToken,
  splitScopes,
  type TokenClaims,
} from "./tokens";

export const AUTH_REQUEST_TTL_MS = 10 * 60 * 1000;

export const SERVICE_KEY_CLIENT = "service-key";

export interface AuthorizationParams {
  state?: string;
  scopes: string[];
  codeChallenge: string;
  redirectUri: string;
  redirectUriProvidedExplicitly: boolean;
  resource?: string;
}

export interface AuthorizationCode {
  code: string;
  scopes: string[];
  expiresAt: number;
  clientId: string;
  codeChallenge: string;
  redirectUri: string;
  redirectUriProvidedExplicitly: boolean;
  resource: string | null;
  subject: string;
}

export interface RefreshTokenInfo {
  token: string;
  clientId: string;
  scopes: string[];
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Static service key
// ---------------------------------------------------------------------------

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time comparison against MCP_API_KEY (false when it is unset). */
export function isServiceKey(token: string | undefined): boolean {
  const expected = getEnv().MCP_API_KEY;
  if (!expected || !token) return false;
  return timingSafeEqual(digest(token), digest(expected));
}

export function serviceKeyAuthInfo(token: string): AuthInfo {
  return {
    token,
    clientId: SERVICE_KEY_CLIENT,
    scopes: [],
    extra: { subject: SERVICE_KEY_CLIENT },
  };
}

// ---------------------------------------------------------------------------
// Authorization: send the person up to Google
// ---------------------------------------------------------------------------

/** Record the request and return the Google sign-in URL to redirect the browser to. */
export async function authorize(
  client: OAuthClientInformationFull,
  params: AuthorizationParams,
  google: GoogleFederation = defaultGoogle,
): Promise<string> {
  const codeVerifier = tokenUrlSafe(64);
  const { url, state } = google.buildAuthorizationUrl(codeVerifier);
  await createAuthorizationRequest({
    clientId: client.client_id,
    redirectUri: params.redirectUri,
    redirectUriProvidedExplicitly: params.redirectUriProvidedExplicitly,
    codeChallenge: params.codeChallenge,
    scopes: params.scopes,
    resource: params.resource ?? null,
    mcpState: params.state ?? null,
    googleState: state,
    googleCodeVerifier: codeVerifier,
    expiresAt: new Date(Date.now() + AUTH_REQUEST_TTL_MS),
  });
  return url;
}

/**
 * The Google callback succeeded for this request: provision the person and issue the one-time
 * authorization code. Undefined when the request is gone, used, completed or expired.
 */
export async function completeGoogleLogin(googleState: string, claims: GoogleClaims) {
  const user = await upsertMcpUser(claims);
  const code = tokenUrlSafe(32);
  const request = await completeAuthorizationRequest(googleState, user.id, code);
  return request ? { request, user } : undefined;
}

// ---------------------------------------------------------------------------
// Authorization code (issued by the Google callback)
// ---------------------------------------------------------------------------

export async function loadAuthorizationCode(
  client: OAuthClientInformationFull,
  code: string,
): Promise<AuthorizationCode | undefined> {
  const request = await findRequestByCode(code);
  if (
    !request ||
    request.used ||
    request.userId === null ||
    request.clientId !== client.client_id ||
    request.expiresAt.getTime() < Date.now()
  ) {
    return undefined;
  }
  return {
    code,
    scopes: request.scopes ?? [],
    expiresAt: Math.floor(request.expiresAt.getTime() / 1000),
    clientId: request.clientId,
    codeChallenge: request.codeChallenge ?? "",
    redirectUri: request.redirectUri,
    redirectUriProvidedExplicitly: request.redirectUriProvidedExplicitly,
    resource: request.resource,
    subject: String(request.userId),
  };
}

export async function exchangeAuthorizationCode(
  client: OAuthClientInformationFull,
  authorizationCode: AuthorizationCode,
): Promise<OAuthTokens> {
  const request = await consumeCode(authorizationCode.code);
  if (!request || request.userId === null) {
    throw new InvalidGrantError("Authorization code is invalid or used");
  }
  const email = await activeUserEmail(request.userId);
  return issueTokens(
    request.userId,
    email,
    client.client_id,
    authorizationCode.scopes,
    authorizationCode.resource,
  );
}

// ---------------------------------------------------------------------------
// Refresh (rotating)
// ---------------------------------------------------------------------------

async function tryDecode(token: string): Promise<TokenClaims | undefined> {
  try {
    return await decodeToken(token);
  } catch {
    return undefined;
  }
}

export async function loadRefreshToken(
  client: OAuthClientInformationFull,
  refreshToken: string,
): Promise<RefreshTokenInfo | undefined> {
  const claims = await tryDecode(refreshToken);
  if (claims?.typ !== "refresh" || claims.client_id !== client.client_id) {
    return undefined;
  }
  if (await isRevoked(claims.jti ?? "")) return undefined;
  return {
    token: refreshToken,
    clientId: client.client_id,
    scopes: splitScopes(claims.scope),
    expiresAt: claims.exp,
  };
}

export async function exchangeRefreshToken(
  client: OAuthClientInformationFull,
  refreshToken: RefreshTokenInfo,
  scopes: string[] | undefined,
): Promise<OAuthTokens> {
  const claims = await decodeToken(refreshToken.token);
  // Rotate: the presented refresh token stops working.
  const days = getEnv().MCP_REFRESH_TOKEN_TTL_DAYS;
  await revokeJti(claims.jti, new Date(Date.now() + days * 86_400_000));
  const granted = scopes && scopes.length > 0 ? scopes : splitScopes(claims.scope);
  return issueTokens(claims.sub, claims.email ?? null, client.client_id, granted, null);
}

// ---------------------------------------------------------------------------
// Access tokens (gate /api/mcp)
// ---------------------------------------------------------------------------

/** AuthInfo for the static service key or a valid, unrevoked OAuth access token. */
export async function verifyAccessToken(token: string): Promise<AuthInfo | undefined> {
  // Static service key for programmatic clients (Claude Code / Desktop).
  if (isServiceKey(token)) return serviceKeyAuthInfo(token);
  if (!getEnv().MCP_JWT_SECRET) return undefined;
  const claims = await tryDecode(token);
  if (claims?.typ !== "access") return undefined;
  if (await isRevoked(claims.jti ?? "")) return undefined;
  let resource: URL | undefined;
  if (typeof claims.aud === "string" && URL.canParse(claims.aud)) resource = new URL(claims.aud);
  return {
    token,
    clientId: claims.client_id ?? "",
    scopes: splitScopes(claims.scope),
    expiresAt: claims.exp,
    resource,
    extra: { subject: claims.sub ?? null, email: claims.email ?? null },
  };
}

/** Revoke an access or refresh token this client holds (unknown tokens are ignored, RFC 7009). */
export async function revokeToken(
  client: OAuthClientInformationFull,
  token: string,
): Promise<void> {
  const claims = await tryDecode(token);
  if (!claims?.jti || claims.client_id !== client.client_id) return;
  const exp = typeof claims.exp === "number" ? claims.exp : Math.floor(Date.now() / 1000);
  await revokeJti(claims.jti, new Date(exp * 1000));
}

async function issueTokens(
  userId: number | string,
  email: string | null,
  clientId: string,
  scopes: string[],
  resource: string | null,
): Promise<OAuthTokens> {
  const access = await mintAccessToken({ userId, email, clientId, scopes, resource });
  const refresh = await mintRefreshToken({ userId, email, clientId, scopes });
  const tokens: OAuthTokens = {
    access_token: access.token,
    token_type: "Bearer",
    expires_in: getEnv().MCP_ACCESS_TOKEN_TTL,
    refresh_token: refresh.token,
  };
  if (scopes.length > 0) tokens.scope = scopes.join(" ");
  return tokens;
}
