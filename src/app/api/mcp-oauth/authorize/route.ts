import { authorizeHandler } from "@/lib/mcp/oauth/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** OAuth authorization endpoint: validates the request, then sends the browser to Google. */
export async function GET(request: Request) {
  return authorizeHandler(request);
}

export async function POST(request: Request) {
  return authorizeHandler(request);
}
