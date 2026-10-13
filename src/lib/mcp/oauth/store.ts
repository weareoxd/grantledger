/**
 * Persistence for the MCP OAuth 2.1 authorization server.
 *
 * Only the handshake needs server-side state (registered clients, in-flight authorization
 * requests, revoked token ids, the people who signed in); it must survive restarts and be shared
 * across processes, so it lives in Postgres. Issued access and refresh tokens are stateless
 * signed JWTs (tokens.ts) and are not stored.
 */
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  mcpUser,
  oauthAuthorizationRequest,
  oauthClient,
  oauthRevokedToken,
} from "@/lib/db/schema";

export type AuthorizationRequestRow = typeof oauthAuthorizationRequest.$inferSelect;
export type NewAuthorizationRequest = typeof oauthAuthorizationRequest.$inferInsert;

// ---------------------------------------------------------------------------
// Clients (dynamic client registration)
// ---------------------------------------------------------------------------

export async function getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
  const [row] = await getDb()
    .select({ data: oauthClient.data })
    .from(oauthClient)
    .where(eq(oauthClient.clientId, clientId));
  return row ? (row.data as OAuthClientInformationFull) : undefined;
}

export async function saveClient(client: OAuthClientInformationFull): Promise<void> {
  await getDb()
    .insert(oauthClient)
    .values({ clientId: client.client_id, data: client })
    .onConflictDoUpdate({ target: oauthClient.clientId, set: { data: client } });
}

// ---------------------------------------------------------------------------
// Authorization requests
// ---------------------------------------------------------------------------

export async function createAuthorizationRequest(
  values: NewAuthorizationRequest,
): Promise<AuthorizationRequestRow> {
  const [row] = await getDb().insert(oauthAuthorizationRequest).values(values).returning();
  return row as AuthorizationRequestRow;
}

export async function findRequestByGoogleState(
  googleState: string,
): Promise<AuthorizationRequestRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(oauthAuthorizationRequest)
    .where(eq(oauthAuthorizationRequest.googleState, googleState))
    .limit(1);
  return row;
}

export async function findRequestByCode(
  code: string,
): Promise<AuthorizationRequestRow | undefined> {
  const [row] = await getDb()
    .select()
    .from(oauthAuthorizationRequest)
    .where(eq(oauthAuthorizationRequest.code, code))
    .limit(1);
  return row;
}

/**
 * Bind the signed-in user to a pending (unused, unexpired, not yet completed) request and give it
 * its one-time authorization code. Undefined when there is no such request.
 */
export async function completeAuthorizationRequest(
  googleState: string,
  userId: number,
  code: string,
): Promise<AuthorizationRequestRow | undefined> {
  const t = oauthAuthorizationRequest;
  const [row] = await getDb()
    .update(t)
    .set({ userId, code })
    .where(
      and(
        eq(t.googleState, googleState),
        eq(t.used, false),
        isNull(t.code),
        sql`${t.expiresAt} >= now()`,
      ),
    )
    .returning();
  return row;
}

/** Mark an authorization code used, atomically: undefined if it was unknown or already used. */
export async function consumeCode(code: string): Promise<AuthorizationRequestRow | undefined> {
  const t = oauthAuthorizationRequest;
  const [row] = await getDb()
    .update(t)
    .set({ used: true })
    .where(and(eq(t.code, code), eq(t.used, false)))
    .returning();
  return row;
}

// ---------------------------------------------------------------------------
// Revoked tokens
// ---------------------------------------------------------------------------

export async function isRevoked(jti: string): Promise<boolean> {
  const rows = await getDb()
    .select({ jti: oauthRevokedToken.jti })
    .from(oauthRevokedToken)
    .where(eq(oauthRevokedToken.jti, jti))
    .limit(1);
  return rows.length > 0;
}

export async function revokeJti(jti: string, expiresAt: Date): Promise<void> {
  await getDb().insert(oauthRevokedToken).values({ jti, expiresAt }).onConflictDoNothing();
}

/** Delete expired authorization requests and denylist entries past their token's expiry. */
export async function purgeExpiredOAuthRows(): Promise<{
  requests: number;
  revokedTokens: number;
}> {
  const db = getDb();
  const requests = await db
    .delete(oauthAuthorizationRequest)
    .where(lt(oauthAuthorizationRequest.expiresAt, sql`now()`))
    .returning({ id: oauthAuthorizationRequest.id });
  const revoked = await db
    .delete(oauthRevokedToken)
    .where(lt(oauthRevokedToken.expiresAt, sql`now()`))
    .returning({ jti: oauthRevokedToken.jti });
  return { requests: requests.length, revokedTokens: revoked.length };
}

// ---------------------------------------------------------------------------
// People who signed in through Google
// ---------------------------------------------------------------------------

/** Django's normalize_email: lower-case the domain part only. */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.lastIndexOf("@");
  if (at < 0) return trimmed;
  return `${trimmed.slice(0, at)}@${trimmed.slice(at + 1).toLowerCase()}`;
}

export interface GoogleClaims {
  email?: string | null;
  email_verified?: unknown;
  given_name?: string | null;
  family_name?: string | null;
  [claim: string]: unknown;
}

/**
 * Provision or refresh a person from Google id_token claims. Only identity fields are taken
 * from the claims. Returns the row id and whether it was created.
 */
export async function upsertMcpUser(
  claims: GoogleClaims,
): Promise<{ id: number; email: string; created: boolean }> {
  const email = normalizeEmail(claims.email ?? "");
  if (!email) throw new Error("Google claims did not include an email");
  const names = {
    firstName: Array.from(claims.given_name ?? "")
      .slice(0, 30)
      .join(""),
    lastName: Array.from(claims.family_name ?? "")
      .slice(0, 30)
      .join(""),
  };
  const [row] = await getDb()
    .insert(mcpUser)
    .values({ email, ...names })
    .onConflictDoUpdate({ target: mcpUser.email, set: { ...names, updatedAt: new Date() } })
    .returning({ id: mcpUser.id, email: mcpUser.email, created: sql<boolean>`(xmax = 0)` });
  if (!row) throw new Error("Could not save the MCP user");
  return row;
}

/** The email of an active person, or null. */
export async function activeUserEmail(userId: number): Promise<string | null> {
  const [row] = await getDb()
    .select({ email: mcpUser.email })
    .from(mcpUser)
    .where(and(eq(mcpUser.id, userId), eq(mcpUser.isActive, true)));
  return row?.email ?? null;
}
