import { purgeExpiredOAuthRows } from "@/lib/mcp/oauth/store";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("maintenance");

/** Daily housekeeping: OAuth authorization requests and revoked token ids past their expiry. */
export async function maintenanceTick() {
  const purged = await purgeExpiredOAuthRows();
  log.info("maintenance done", { purged });
}
