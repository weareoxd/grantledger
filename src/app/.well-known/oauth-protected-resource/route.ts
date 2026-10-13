import { preflight, protectedResourceMetadataHandler } from "@/lib/mcp/oauth/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth protected resource metadata (RFC 9728) for /api/mcp, at the root path. */
export async function GET() {
  return protectedResourceMetadataHandler();
}

export async function OPTIONS(request: Request) {
  return preflight(request, ["GET", "OPTIONS"]);
}
