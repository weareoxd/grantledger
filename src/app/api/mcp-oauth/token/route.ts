import { preflight, tokenHandler } from "@/lib/mcp/oauth/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth token endpoint (authorization_code with PKCE, refresh_token). */
export async function POST(request: Request) {
  return tokenHandler(request);
}

export async function OPTIONS(request: Request) {
  return preflight(request, ["POST", "OPTIONS"]);
}
