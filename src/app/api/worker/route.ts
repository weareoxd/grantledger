import { adminOrForbidden } from "@/lib/auth/session";
import { getWorkerSnapshot } from "@/lib/queries/worker";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The worker's live status, polled by the header indicator and the Worker page (admins only). */
export async function GET() {
  const user = await adminOrForbidden();
  if (user instanceof Response) return user;
  return Response.json(await getWorkerSnapshot());
}
