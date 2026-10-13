import { ensureAdminUser } from "@/lib/auth/users";
import { runMigrations } from "@/lib/db/migrate";
import { getAuthEnv, getEnv } from "@/lib/env";
import { getDataVersion } from "@/lib/grants/version";
import { createLogger } from "./logger";

const log = createLogger("bootstrap");

type BootstrapState = { __grantsBootstrap?: Promise<void> };
const store = globalThis as BootstrapState;

async function run() {
  const started = Date.now();
  const env = getEnv();
  getAuthEnv();

  if (env.RUN_MIGRATIONS) await runMigrations();
  else log.info("RUN_MIGRATIONS=false; skipping migrations");

  await ensureAdminUser();
  await getDataVersion();
  log.info("ready", { ms: Date.now() - started });
}

/**
 * One-time web server startup: validate env, migrate, create the admin user. The worker runs
 * its own startup (src/worker/index.ts). Concurrent callers share one attempt; a failed attempt
 * is retried on the next call.
 */
export function bootstrapOnce(): Promise<void> {
  if (!store.__grantsBootstrap) {
    store.__grantsBootstrap = run().then(
      () => {},
      (error: unknown) => {
        store.__grantsBootstrap = undefined;
        log.error("startup failed; will retry on the next request", { error });
        throw error;
      },
    );
  }
  return store.__grantsBootstrap;
}
