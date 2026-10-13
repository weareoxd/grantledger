import { preflight, registerHandler } from "@/lib/mcp/oauth/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth dynamic client registration (RFC 7591) for MCP clients. */
export async function POST(request: Request) {
  return registerHandler(request);
}

export async function OPTIONS(request: Request) {
  return preflight(request, ["POST", "OPTIONS"]);
}
