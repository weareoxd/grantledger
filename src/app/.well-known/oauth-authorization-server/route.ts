import { authorizationServerMetadataHandler, preflight } from "@/lib/mcp/oauth/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth authorization server metadata (RFC 8414) for the MCP connector. */
export async function GET() {
  return authorizationServerMetadataHandler();
}

export async function OPTIONS(request: Request) {
  return preflight(request, ["GET", "OPTIONS"]);
}
