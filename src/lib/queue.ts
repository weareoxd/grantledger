/**
 * Job queues shared by the web app (which enqueues) and the worker (which runs them).
 *
 * One queue holds every import: the worker takes one job at a time, so imports never overlap
 * (they share the recipient table and the rollup). Each source has its own singleton key, so a
 * source is queued at most once while one of its runs is in progress, and its own cron schedule.
 */
import { PgBoss } from "pg-boss";
import { connectionOptions } from "@/lib/db";
import { DB_SCHEMA } from "@/lib/db/schema-name";
import type { ImportSource, RunTrigger } from "@/lib/domain";
import { getEnv } from "@/lib/env";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("queue");

export const QUEUES = {
  /** Housekeeping: expired OAuth rows. */
  maintenance: "maintenance",
  imports: "import-source",
} as const;

export interface ImportJob {
  source: ImportSource;
  trigger: RunTrigger;
  /** Download and import even when the file has not changed since the last import. */
  force?: boolean;
  /** Who asked for a manual run. */
  requestedBy?: string;
}

/** Whether the worker may download and import this source (federal: FEDERAL_IMPORTS_ENABLED). */
export function sourceEnabled(source: ImportSource): boolean {
  return source !== "federal" || getEnv().FEDERAL_IMPORTS_ENABLED;
}

/** Why the worker won't import this source, or null when it will. */
export function sourceDisabledReason(source: ImportSource): string | null {
  return sourceEnabled(source)
    ? null
    : "Federal imports are turned off. Set FEDERAL_IMPORTS_ENABLED=true to run them.";
}

/** The sources the worker imports on a schedule, with their cron settings. */
export function scheduledSources(): { source: ImportSource; cron: string }[] {
  const env = getEnv();
  return [
    { source: "alberta_live" as const, cron: env.ALBERTA_LIVE_CRON },
    { source: "federal" as const, cron: env.FEDERAL_CRON },
  ].filter(({ source }) => sourceEnabled(source));
}

type QueueGlobal = { __grantsBoss?: Promise<PgBoss> };
const store = globalThis as QueueGlobal;

/**
 * Started pg-boss client, cached on globalThis. The web app only sends jobs, so it skips the
 * scheduling and maintenance loops that the worker runs.
 */
export function getBoss(role: "web" | "worker" = "web"): Promise<PgBoss> {
  if (!store.__grantsBoss) {
    const connection = connectionOptions();
    const boss = new PgBoss({
      // The app's own connection settings (URL, TLS); its tables are named with their schema
      connectionString: connection.connectionString,
      ssl: connection.ssl,
      // Its tables (job, queue, schedule, ...) go in the app's schema, with ours: the shared
      // database gives each app one schema of its own
      schema: DB_SCHEMA,
      schedule: role === "worker",
      supervise: role === "worker",
      max: role === "worker" ? 4 : 2,
    });
    boss.on("error", (error) => log.error("pg-boss error", { error }));
    store.__grantsBoss = boss
      .start()
      .then(async (started) => {
        await ensureQueues(started);
        return started;
      })
      .catch((error: unknown) => {
        store.__grantsBoss = undefined;
        throw error;
      });
  }
  return store.__grantsBoss;
}

/**
 * Creates a queue, then applies its settings: pg-boss's create is a no-op for a queue that
 * already exists, so without the update a changed setting never reaches an existing database.
 */
async function ensureQueue(
  boss: PgBoss,
  name: string,
  policy: "standard" | "stately" | "singleton",
  settings: { expireInSeconds?: number; retryLimit: number; heartbeatSeconds?: number },
) {
  await boss.createQueue(name, { policy, ...settings });
  await boss.updateQueue(name, settings);
}

async function ensureQueues(boss: PgBoss) {
  // The federal file is 2.3 GB: a download and an import can take a while. The job's heartbeat
  // (sent by the worker while it runs) fails it within minutes if the worker dies instead.
  await ensureQueue(boss, QUEUES.imports, "stately", {
    expireInSeconds: 6 * 60 * 60,
    retryLimit: 0,
    heartbeatSeconds: 60,
  });
  await ensureQueue(boss, QUEUES.maintenance, "singleton", { retryLimit: 0 });
}

export async function stopBoss() {
  const boss = await store.__grantsBoss?.catch(() => undefined);
  store.__grantsBoss = undefined;
  await boss?.stop({ graceful: true, timeout: 30_000 });
}

/** Queue an import; null when that source already has one waiting. */
export async function enqueueImport(job: ImportJob): Promise<string | null> {
  const boss = await getBoss();
  return boss.send(QUEUES.imports, job, { singletonKey: job.source });
}
