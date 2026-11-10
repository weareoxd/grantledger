import { authenticateMcpRequest } from "@/lib/mcp/auth";
import { handleMcpRequest } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only MCP server (Streamable HTTP, stateless, JSON responses) for claude.ai / ChatGPT
 * connectors and Claude Code: `Authorization: Bearer <MCP_API_KEY>` or, when MCP_PUBLIC_URL is
 * set, an OAuth access token from /api/mcp-oauth. Tools live in src/lib/mcp/.
 */
export async function POST(request: Request) {
  const auth = await authenticateMcpRequest(request);
  if ("response" in auth) return auth.response;
  return handleMcpRequest(request, auth.authInfo);
}

/**
 * The server is stateless and answers in JSON, so there is no server-initiated SSE stream to
 * open (GET) and no session to end (DELETE); the MCP spec allows 405 for both.
 */
function methodNotAllowed() {
  return Response.json(
    { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null },
    { status: 405, headers: { Allow: "POST" } },
  );
}

export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
