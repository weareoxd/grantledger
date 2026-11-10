/**
 * Stateless JWT access and refresh tokens for the MCP OAuth server.
 *
 * Tokens are signed with MCP_JWT_SECRET (HS256) and self-describing, so any process can verify
 * them without shared storage. Revocation and rotation use a small jti denylist
 * (oauth_revoked_token); access tokens are short-lived, so their denylist entries expire quickly.
 */
import { randomUUID } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { getEnv } from "@/lib/env";
import { MCP_PATH, publicUrl } from "./config";

const ALGORITHM = "HS256";

export interface TokenClaims {
  typ: "access" | "refresh";
  sub: string;
  email: string | null;
  client_id: string;
  scope: string;
  iss: string;
  aud?: string;
  iat: number;
  exp: number;
  jti: string;
}

export interface MintedToken {
  token: string;
  exp: number;
  jti: string;
}

function secret(): Uint8Array {
  const value = getEnv().MCP_JWT_SECRET;
  if (!value) throw new Error("MCP_JWT_SECRET is required to issue or verify MCP OAuth tokens");
  return new TextEncoder().encode(value);
}

const now = () => Math.floor(Date.now() / 1000);

async function encode(claims: TokenClaims): Promise<string> {
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALGORITHM, typ: "JWT" })
    .sign(secret());
}

/** Decode and verify a token (signature and expiry; not the audience). Throws on any problem. */
export async function decodeToken(token: string): Promise<TokenClaims> {
  const { payload } = await jwtVerify(token, secret(), { algorithms: [ALGORITHM] });
  return payload as unknown as TokenClaims;
}

interface MintArgs {
  userId: number | string;
  email: string | null;
  clientId: string;
  scopes: string[];
}

export async function mintAccessToken(
  args: MintArgs & { resource?: string | null },
): Promise<MintedToken> {
  const exp = now() + getEnv().MCP_ACCESS_TOKEN_TTL;
  const jti = randomUUID();
  const issuer = publicUrl() ?? "";
  const token = await encode({
    typ: "access",
    sub: String(args.userId),
    email: args.email,
    client_id: args.clientId,
    scope: args.scopes.join(" "),
    iss: issuer,
    aud: args.resource || `${issuer}${MCP_PATH}`,
    iat: now(),
    exp,
    jti,
  });
  return { token, exp, jti };
}

export async function mintRefreshToken(args: MintArgs): Promise<MintedToken> {
  const exp = now() + getEnv().MCP_REFRESH_TOKEN_TTL_DAYS * 86_400;
  const jti = randomUUID();
  const token = await encode({
    typ: "refresh",
    sub: String(args.userId),
    email: args.email,
    client_id: args.clientId,
    scope: args.scopes.join(" "),
    iss: publicUrl() ?? "",
    iat: now(),
    exp,
    jti,
  });
  return { token, exp, jti };
}

/** Python's str.split(): whitespace-separated, no empty entries. */
export function splitScopes(scope: unknown): string[] {
  return typeof scope === "string" ? scope.split(/\s+/).filter(Boolean) : [];
}
