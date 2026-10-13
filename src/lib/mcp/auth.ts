/**
 * Bearer authentication for the remote MCP endpoint (/api/mcp).
 *
 * Without OAuth (MCP_PUBLIC_URL unset) every request must carry `Authorization: Bearer
 * <MCP_API_KEY>`, and the endpoint fails closed while the key is unset. With OAuth on, it accepts
 * an access token issued by this server's authorization server, or the static key. The stdio
 * transport is local and trusted, and does not use this.
 */
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { getEnv } from "@/lib/env";
import { oauthUrls } from "./oauth/config";
import { isServiceKey, serviceKeyAuthInfo, verifyAccessToken } from "./oauth/provider";

/** The token from an `Authorization: Bearer <token>` header. */
export function bearerToken(header: string | null | undefined): string | undefined {
  const match = /^bearer\s+(.+)$/i.exec(header?.trim() ?? "");
  return match?.[1]?.trim() || undefined;
}

export type AuthResult = { authInfo: AuthInfo } | { response: Response };

function unauthorized(body: Record<string, string>, challenge: string): { response: Response } {
  return {
    response: Response.json(body, {
      status: 401,
      headers: { "WWW-Authenticate": challenge, "Cache-Control": "no-store" },
    }),
  };
}

/** The caller's AuthInfo, or the 401 response to send. */
export async function authenticateMcpRequest(request: Request): Promise<AuthResult> {
  const token = bearerToken(request.headers.get("authorization"));
  const urls = oauthUrls();

  if (!urls) {
    if (!getEnv().MCP_API_KEY) {
      return unauthorized(
        { error: "unauthorized", detail: "MCP server is not configured (no MCP_API_KEY set)" },
        'Bearer realm="mcp"',
      );
    }
    if (token && isServiceKey(token)) return { authInfo: serviceKeyAuthInfo(token) };
    return unauthorized(
      { error: "unauthorized", detail: "Missing or invalid bearer token" },
      'Bearer realm="mcp"',
    );
  }

  const authInfo = token ? await verifyAccessToken(token) : undefined;
  if (authInfo) return { authInfo };
  const metadata = `resource_metadata="${urls.resourceMetadataUrl}"`;
  return unauthorized(
    token
      ? { error: "invalid_token", error_description: "Invalid or expired token" }
      : { error: "invalid_token", error_description: "Authentication required" },
    token
      ? `Bearer error="invalid_token", error_description="Invalid or expired token", ${metadata}`
      : `Bearer ${metadata}`,
  );
}
