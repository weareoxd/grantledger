import { googleCallbackHandler } from "@/lib/mcp/oauth/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Google federation callback. Register <MCP_PUBLIC_URL>/api/mcp-oauth/google/callback as an
 * authorized redirect URI of the Google OAuth client.
 */
export async function GET(request: Request) {
  return googleCallbackHandler(request);
}
