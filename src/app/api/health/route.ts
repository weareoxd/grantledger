import { getPool } from "@/lib/db";
import { bootstrapOnce } from "@/lib/server/bootstrap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Health check for a load balancer and for Docker: 200 once
 * startup has finished (settings checked, migrations applied, admin created) and the database
 * answers; 503 until then. No sign-in needed, and nothing about the data is revealed.
 */
export async function GET() {
  try {
    await bootstrapOnce();
  } catch {
    return Response.json(
      { status: "starting", error: "Startup has not finished" },
      { status: 503 },
    );
  }
  try {
    await getPool().query("SELECT 1");
  } catch {
    return Response.json({ status: "error", error: "Database unavailable" }, { status: 503 });
  }
  return Response.json({ status: "ok" });
}
