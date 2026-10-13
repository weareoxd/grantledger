/**
 * HTTP handlers of the MCP OAuth 2.1 authorization server, as plain `Request -> Response`
 * functions for the Next.js route files.
 *
 * Ported from the MCP TypeScript SDK's Express handlers (server/auth/handlers/*), which cannot be
 * imported here because they load Express: metadata, dynamic client registration, authorize
 * (two-phase validation), token (client authentication, PKCE, authorization_code and
 * refresh_token grants) and revoke, with the SDK's CORS and rate limits. The token endpoint's
 * checks follow the Python SDK the server ran on before. Plus the Google federation callback
 * (the Python server's oauth/routes.py).
 *
 * Every handler answers 404 while OAuth is off (MCP_PUBLIC_URL unset).
 */
import { timingSafeEqual } from "node:crypto";
import {
  InvalidClientError,
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidRequestError,
  InvalidScopeError,
  OAuthError,
  ServerError,
  TooManyRequestsError,
  UnsupportedGrantTypeError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import {
  type OAuthClientInformationFull,
  OAuthClientMetadataSchema,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { z } from "zod";
import { createLogger } from "@/lib/server/logger";
import { checkRateLimit, clientIp, type RateLimitRule } from "@/lib/server/rate-limit";
import {
  authorizationServerMetadata,
  type OAuthUrls,
  oauthUrls,
  protectedResourceMetadata,
} from "./config";
import {
  google as defaultGoogle,
  emailDomainAllowed,
  type GoogleFederation,
  pkceChallenge,
} from "./google";
import {
  authorize,
  completeGoogleLogin,
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  loadAuthorizationCode,
  loadRefreshToken,
  revokeToken,
} from "./provider";
import { findRequestByGoogleState, getClient, saveClient } from "./store";

const log = createLogger("mcp_oauth");

/** Client secrets expire after 30 days, as the SDK's registration handler sets them. */
export const CLIENT_SECRET_EXPIRY_SECONDS = 30 * 24 * 60 * 60;
const DEFAULT_GRANT_TYPES = ["authorization_code", "refresh_token"];

const MINUTE = 60 * 1000;
export const RATE_LIMITS = {
  register: { windowMs: 60 * MINUTE, max: 20 },
  token: { windowMs: 15 * MINUTE, max: 50 },
  authorize: { windowMs: 15 * MINUTE, max: 100 },
  revoke: { windowMs: 15 * MINUTE, max: 50 },
} satisfies Record<string, RateLimitRule>;

const RATE_LIMIT_MESSAGES: Record<keyof typeof RATE_LIMITS, string> = {
  register: "You have exceeded the rate limit for client registration requests",
  token: "You have exceeded the rate limit for token requests",
  authorize: "You have exceeded the rate limit for authorization requests",
  revoke: "You have exceeded the rate limit for token revocation requests",
};

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

interface ReplyOptions {
  cors?: boolean;
  headers?: Record<string, string>;
}

function reply(body: unknown, status: number, options: ReplyOptions = {}): Response {
  const headers: Record<string, string> = { "Cache-Control": "no-store", ...options.headers };
  if (options.cors) headers["Access-Control-Allow-Origin"] = "*";
  return Response.json(body, { status, headers });
}

function errorReply(error: unknown, options: ReplyOptions = {}): Response {
  if (error instanceof OAuthError) {
    return reply(error.toResponseObject(), error instanceof ServerError ? 500 : 400, options);
  }
  log.error("oauth request failed", { error });
  return reply(new ServerError("Internal Server Error").toResponseObject(), 500, options);
}

function notFound(): Response {
  return Response.json({ detail: "Not found." }, { status: 404 });
}

/** CORS preflight for the endpoints web-based MCP clients call (`cors()` in the SDK). */
export function preflight(request: Request, methods: string[]): Response {
  if (!oauthUrls()) return notFound();
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": methods.join(","),
      "Access-Control-Allow-Headers":
        request.headers.get("access-control-request-headers") ??
        "Authorization, Content-Type, MCP-Protocol-Version",
      "Access-Control-Max-Age": "86400",
      Vary: "Access-Control-Request-Headers",
    },
  });
}

function rateLimited(
  request: Request,
  name: keyof typeof RATE_LIMITS,
  options: ReplyOptions = {},
): Response | undefined {
  const result = checkRateLimit(`${name}:${clientIp(request)}`, RATE_LIMITS[name]);
  if (result.allowed) return undefined;
  return reply(new TooManyRequestsError(RATE_LIMIT_MESSAGES[name]).toResponseObject(), 429, {
    ...options,
    headers: { "Retry-After": String(result.retryAfterSeconds) },
  });
}

/** An application/x-www-form-urlencoded body as an object (empty for other content types). */
async function readForm(request: Request): Promise<Record<string, string>> {
  const type = request.headers.get("content-type") ?? "";
  if (!type.toLowerCase().includes("application/x-www-form-urlencoded")) return {};
  return Object.fromEntries(new URLSearchParams(await request.text()));
}

function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");
}

function secretsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/** GET /.well-known/oauth-authorization-server (RFC 8414). */
export function authorizationServerMetadataHandler(): Response {
  const urls = oauthUrls();
  if (!urls) return notFound();
  return reply(authorizationServerMetadata(urls), 200, { cors: true });
}

/** GET /.well-known/oauth-protected-resource[/api/mcp] (RFC 9728). */
export function protectedResourceMetadataHandler(): Response {
  const urls = oauthUrls();
  if (!urls) return notFound();
  return reply(protectedResourceMetadata(urls), 200, { cors: true });
}

// ---------------------------------------------------------------------------
// Dynamic client registration
// ---------------------------------------------------------------------------

/** POST /api/mcp-oauth/register (RFC 7591). */
export async function registerHandler(request: Request): Promise<Response> {
  if (!oauthUrls()) return notFound();
  const cors = { cors: true };
  const limited = rateLimited(request, "register", cors);
  if (limited) return limited;
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new InvalidClientMetadataError("Request body must be JSON client metadata");
    }
    const parsed = OAuthClientMetadataSchema.safeParse(body);
    if (!parsed.success) throw new InvalidClientMetadataError(parsed.error.message);
    const metadata = parsed.data;
    const isPublicClient = metadata.token_endpoint_auth_method === "none";
    const issuedAt = Math.floor(Date.now() / 1000);
    const client: OAuthClientInformationFull = {
      ...metadata,
      client_id: crypto.randomUUID(),
      client_id_issued_at: issuedAt,
    };
    if (!isPublicClient) {
      client.client_secret = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        "hex",
      );
      client.client_secret_expires_at = issuedAt + CLIENT_SECRET_EXPIRY_SECONDS;
    }
    await saveClient(client);
    return reply(client, 201, cors);
  } catch (error) {
    return errorReply(error, cors);
  }
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A requested redirect_uri against a registered one: exact match, except that loopback URIs
 * may use any port (RFC 8252 §7.3), as the SDK allows.
 */
export function redirectUriMatches(requested: string, registered: string): boolean {
  if (requested === registered) return true;
  let req: URL;
  let reg: URL;
  try {
    req = new URL(requested);
    reg = new URL(registered);
  } catch {
    return false;
  }
  if (!LOOPBACK_HOSTS.has(req.hostname) || !LOOPBACK_HOSTS.has(reg.hostname)) return false;
  return (
    req.protocol === reg.protocol &&
    req.hostname === reg.hostname &&
    req.pathname === reg.pathname &&
    req.search === reg.search
  );
}

// Parameters that must be valid before errors can be sent to the redirect URI.
const ClientAuthorizationParams = z.object({
  client_id: z.string(),
  redirect_uri: z
    .string()
    .optional()
    .refine((value) => value === undefined || URL.canParse(value), {
      message: "redirect_uri must be a valid URL",
    }),
});

// Parameters whose errors are reported to the redirect URI.
const RequestAuthorizationParams = z.object({
  response_type: z.literal("code"),
  code_challenge: z.string(),
  code_challenge_method: z.literal("S256"),
  scope: z.string().optional(),
  state: z.string().optional(),
  resource: z.url().optional(),
});

function errorRedirect(redirectUri: string, error: OAuthError, state: string | undefined) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error.errorCode);
  url.searchParams.set("error_description", error.message);
  if (error.errorUri) url.searchParams.set("error_uri", error.errorUri);
  if (state) url.searchParams.set("state", state);
  return redirect(url.href);
}

function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: location, "Cache-Control": "no-store" },
  });
}

/** GET or POST /api/mcp-oauth/authorize: validate, then send the browser to Google. */
export async function authorizeHandler(
  request: Request,
  google: GoogleFederation = defaultGoogle,
): Promise<Response> {
  if (!oauthUrls()) return notFound();
  const limited = rateLimited(request, "authorize");
  if (limited) return limited;
  const params =
    request.method === "POST"
      ? await readForm(request)
      : Object.fromEntries(new URL(request.url).searchParams);

  // Phase 1: client_id and redirect_uri. Errors here are answered directly.
  let client: OAuthClientInformationFull;
  let redirectUri: string;
  let redirectUriProvidedExplicitly: boolean;
  try {
    const parsed = ClientAuthorizationParams.safeParse(params);
    if (!parsed.success) throw new InvalidRequestError(zodMessage(parsed.error));
    const found = await getClient(parsed.data.client_id);
    if (!found) throw new InvalidClientError("Invalid client_id");
    client = found;
    const requested = parsed.data.redirect_uri;
    redirectUriProvidedExplicitly = requested !== undefined;
    if (requested !== undefined) {
      if (!client.redirect_uris.some((registered) => redirectUriMatches(requested, registered))) {
        throw new InvalidRequestError("Unregistered redirect_uri");
      }
      redirectUri = requested;
    } else if (client.redirect_uris.length === 1) {
      redirectUri = client.redirect_uris[0] as string;
    } else {
      throw new InvalidRequestError(
        "redirect_uri must be specified when client has multiple registered URIs",
      );
    }
  } catch (error) {
    return errorReply(error);
  }

  // Phase 2: everything else. Errors go back to the client's redirect URI.
  const state = typeof params.state === "string" ? params.state : undefined;
  try {
    const parsed = RequestAuthorizationParams.safeParse(params);
    if (!parsed.success) throw new InvalidRequestError(zodMessage(parsed.error));
    const { scope, code_challenge, resource } = parsed.data;
    const googleUrl = await authorize(
      client,
      {
        state: parsed.data.state,
        scopes: scope !== undefined ? scope.split(" ") : [],
        codeChallenge: code_challenge,
        redirectUri,
        redirectUriProvidedExplicitly,
        resource,
      },
      google,
    );
    return redirect(googleUrl);
  } catch (error) {
    if (error instanceof OAuthError) return errorRedirect(redirectUri, error, state);
    log.error("authorize failed", { error });
    return errorRedirect(redirectUri, new ServerError("Internal Server Error"), state);
  }
}

// ---------------------------------------------------------------------------
// Client authentication (token and revocation endpoints)
// ---------------------------------------------------------------------------

/** client_secret_post or none, as the SDK's authenticateClient middleware. */
async function authenticateClient(
  form: Record<string, string>,
): Promise<OAuthClientInformationFull> {
  const clientId = form.client_id;
  if (typeof clientId !== "string") throw new InvalidRequestError("client_id is required");
  const client = await getClient(clientId);
  if (!client) throw new InvalidClientError("Invalid client_id");
  if (client.client_secret) {
    const secret = form.client_secret;
    if (!secret) throw new InvalidClientError("Client secret is required");
    if (!secretsEqual(client.client_secret, secret)) {
      throw new InvalidClientError("Invalid client_secret");
    }
    if (
      client.client_secret_expires_at &&
      client.client_secret_expires_at < Math.floor(Date.now() / 1000)
    ) {
      throw new InvalidClientError("Client secret has expired");
    }
  }
  return client;
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

const AuthorizationCodeGrant = z.object({
  code: z.string(),
  code_verifier: z.string(),
  redirect_uri: z.string().optional(),
  resource: z.url().optional(),
});

const RefreshTokenGrant = z.object({
  refresh_token: z.string(),
  scope: z.string().optional(),
  resource: z.url().optional(),
});

async function authorizationCodeGrant(
  client: OAuthClientInformationFull,
  form: Record<string, string>,
) {
  const parsed = AuthorizationCodeGrant.safeParse(form);
  if (!parsed.success) throw new InvalidRequestError(zodMessage(parsed.error));
  const { code, code_verifier, redirect_uri } = parsed.data;
  const authCode = await loadAuthorizationCode(client, code);
  if (!authCode || authCode.clientId !== client.client_id) {
    throw new InvalidGrantError("authorization code does not exist");
  }
  if (authCode.expiresAt < Date.now() / 1000) {
    throw new InvalidGrantError("authorization code has expired");
  }
  // When the authorization request named a redirect_uri, the token request must repeat it.
  const expected = authCode.redirectUriProvidedExplicitly ? authCode.redirectUri : undefined;
  if (
    (expected !== undefined && redirect_uri !== expected) ||
    (redirect_uri !== undefined && redirect_uri !== authCode.redirectUri)
  ) {
    throw new InvalidRequestError(
      "redirect_uri did not match the one used when creating auth code",
    );
  }
  // PKCE (S256): this server is the authorization server, so it checks the verifier itself.
  if (!authCode.codeChallenge || pkceChallenge(code_verifier) !== authCode.codeChallenge) {
    throw new InvalidGrantError("incorrect code_verifier");
  }
  return exchangeAuthorizationCode(client, authCode);
}

async function refreshTokenGrant(client: OAuthClientInformationFull, form: Record<string, string>) {
  const parsed = RefreshTokenGrant.safeParse(form);
  if (!parsed.success) throw new InvalidRequestError(zodMessage(parsed.error));
  const refresh = await loadRefreshToken(client, parsed.data.refresh_token);
  if (!refresh || refresh.clientId !== client.client_id) {
    throw new InvalidGrantError("refresh token does not exist");
  }
  if (refresh.expiresAt < Date.now() / 1000) {
    throw new InvalidGrantError("refresh token has expired");
  }
  const scopes = parsed.data.scope?.split(" ").filter(Boolean);
  for (const scope of scopes ?? []) {
    if (!refresh.scopes.includes(scope)) {
      throw new InvalidScopeError(
        `cannot request scope \`${scope}\` not provided by refresh token`,
      );
    }
  }
  return exchangeRefreshToken(client, refresh, scopes);
}

/** POST /api/mcp-oauth/token (form-encoded). */
export async function tokenHandler(request: Request): Promise<Response> {
  if (!oauthUrls()) return notFound();
  const cors = { cors: true };
  const limited = rateLimited(request, "token", cors);
  if (limited) return limited;
  try {
    const form = await readForm(request);
    const client = await authenticateClient(form);
    const grantType = form.grant_type;
    if (typeof grantType !== "string") throw new InvalidRequestError("grant_type is required");
    const allowed = client.grant_types?.length ? client.grant_types : DEFAULT_GRANT_TYPES;
    if (!allowed.includes(grantType)) {
      throw new UnsupportedGrantTypeError(
        `Unsupported grant type (supported grant types are ${allowed.join(", ")})`,
      );
    }
    let tokens: unknown;
    if (grantType === "authorization_code") tokens = await authorizationCodeGrant(client, form);
    else if (grantType === "refresh_token") tokens = await refreshTokenGrant(client, form);
    else {
      throw new UnsupportedGrantTypeError(
        "The grant type is not supported by this authorization server.",
      );
    }
    return reply(tokens, 200, cors);
  } catch (error) {
    return errorReply(error, cors);
  }
}

// ---------------------------------------------------------------------------
// Revocation
// ---------------------------------------------------------------------------

const RevocationRequest = z.object({
  token: z.string(),
  token_type_hint: z.string().optional(),
});

/** POST /api/mcp-oauth/revoke (RFC 7009, form-encoded). */
export async function revokeHandler(request: Request): Promise<Response> {
  if (!oauthUrls()) return notFound();
  const cors = { cors: true };
  const limited = rateLimited(request, "revoke", cors);
  if (limited) return limited;
  try {
    const form = await readForm(request);
    const client = await authenticateClient(form);
    const parsed = RevocationRequest.safeParse(form);
    if (!parsed.success) throw new InvalidRequestError(zodMessage(parsed.error));
    await revokeToken(client, parsed.data.token);
    return reply({}, 200, cors);
  } catch (error) {
    return errorReply(error, cors);
  }
}

// ---------------------------------------------------------------------------
// Google federation callback
// ---------------------------------------------------------------------------

function html(text: string, status: number): Response {
  return new Response(text, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** The client's redirect_uri with these parameters appended. */
export function buildRedirect(redirectUri: string, params: Record<string, string>): string {
  const separator = redirectUri.includes("?") ? "&" : "?";
  return `${redirectUri}${separator}${new URLSearchParams(params).toString()}`;
}

function callbackError(
  redirectUri: string,
  state: string | null,
  error: string,
  description: string,
): Response {
  const params: Record<string, string> = { error, error_description: description };
  if (state) params.state = state;
  return redirect(buildRedirect(redirectUri, params));
}

/**
 * GET /api/mcp-oauth/google/callback: Google sends the browser here after sign-in. Exchange the
 * Google code, enforce the email-domain policy, provision the person, mint a one-time
 * authorization code, and send the browser back to the MCP client's redirect_uri.
 */
export async function googleCallbackHandler(
  request: Request,
  google: GoogleFederation = defaultGoogle,
  urls: OAuthUrls | undefined = oauthUrls(),
): Promise<Response> {
  if (!urls) return notFound();
  const query = new URL(request.url).searchParams;
  const state = query.get("state");
  const code = query.get("code");
  const error = query.get("error");

  if (!state) return html("Missing state parameter.", 400);

  const pending = await findRequestByGoogleState(state);
  if (!pending || pending.used || pending.expiresAt.getTime() < Date.now()) {
    return html("Login request expired or invalid. Please try again.", 400);
  }

  if (error) return callbackError(pending.redirectUri, pending.mcpState, "access_denied", error);
  if (!code) {
    return callbackError(pending.redirectUri, pending.mcpState, "invalid_request", "Missing code");
  }

  let claims: Awaited<ReturnType<GoogleFederation["exchangeCode"]>>;
  try {
    claims = await google.exchangeCode({ code, codeVerifier: pending.googleCodeVerifier });
  } catch (exchangeError) {
    log.warn("google token exchange failed", { error: exchangeError });
    return callbackError(
      pending.redirectUri,
      pending.mcpState,
      "server_error",
      "Google token exchange failed",
    );
  }

  if (!emailDomainAllowed(claims)) {
    return callbackError(
      pending.redirectUri,
      pending.mcpState,
      "access_denied",
      "Your Google account is not permitted to access this connector.",
    );
  }

  const completed = await completeGoogleLogin(state, claims);
  if (!completed) return html("Login request expired. Please try again.", 400);

  const params: Record<string, string> = { code: completed.request.code as string };
  if (completed.request.mcpState) params.state = completed.request.mcpState;
  return redirect(buildRedirect(completed.request.redirectUri, params));
}
