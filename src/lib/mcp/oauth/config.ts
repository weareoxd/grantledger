/**
 * Where the MCP OAuth 2.1 authorization server lives. It is on only when MCP_PUBLIC_URL (this
 * server's public https origin) is set; otherwise /api/mcp accepts the static MCP_API_KEY only.
 */
import { getEnv } from "@/lib/env";

export const MCP_PATH = "/api/mcp";
export const OAUTH_PATH = "/api/mcp-oauth";

export interface OAuthUrls {
  /** MCP_PUBLIC_URL without a trailing slash: the issuer. */
  issuer: string;
  /** The protected resource (the MCP endpoint). */
  resource: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
  revocationEndpoint: string;
  googleRedirectUri: string;
  /** Where the protected-resource metadata for /api/mcp is served (RFC 9728). */
  resourceMetadataUrl: string;
}

export function publicUrl(): string | undefined {
  const url = getEnv().MCP_PUBLIC_URL;
  return url ? url.replace(/\/+$/, "") : undefined;
}

export function oauthEnabled(): boolean {
  return publicUrl() !== undefined;
}

/** The server's OAuth URLs, or undefined when OAuth is off. */
export function oauthUrls(): OAuthUrls | undefined {
  const issuer = publicUrl();
  if (!issuer) return undefined;
  return {
    issuer,
    resource: `${issuer}${MCP_PATH}`,
    authorizationEndpoint: `${issuer}${OAUTH_PATH}/authorize`,
    tokenEndpoint: `${issuer}${OAUTH_PATH}/token`,
    registrationEndpoint: `${issuer}${OAUTH_PATH}/register`,
    revocationEndpoint: `${issuer}${OAUTH_PATH}/revoke`,
    googleRedirectUri: `${issuer}${OAUTH_PATH}/google/callback`,
    resourceMetadataUrl: `${issuer}/.well-known/oauth-protected-resource${MCP_PATH}`,
  };
}

/** RFC 8414 authorization server metadata (as the MCP SDK builds it). */
export function authorizationServerMetadata(urls: OAuthUrls) {
  return {
    issuer: urls.issuer,
    authorization_endpoint: urls.authorizationEndpoint,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint: urls.tokenEndpoint,
    token_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    revocation_endpoint: urls.revocationEndpoint,
    revocation_endpoint_auth_methods_supported: ["client_secret_post"],
    registration_endpoint: urls.registrationEndpoint,
  };
}

/** RFC 9728 protected resource metadata for /api/mcp. */
export function protectedResourceMetadata(urls: OAuthUrls) {
  return {
    resource: urls.resource,
    authorization_servers: [urls.issuer],
    bearer_methods_supported: ["header"],
  };
}
