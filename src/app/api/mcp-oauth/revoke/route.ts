import { preflight, revokeHandler } from "@/lib/mcp/oauth/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth token revocation (RFC 7009). */
export async function POST(request: Request) {
  return revokeHandler(request);
}

export async function OPTIONS(request: Request) {
  return preflight(request, ["POST", "OPTIONS"]);
}
