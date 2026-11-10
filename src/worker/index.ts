// Background worker: downloads and imports the open data on a schedule, or when an admin asks,
// one import at a time.
//
//   npm run worker          (dev: npm run worker:dev, or `make start` for web + worker)
//   node dist/worker/index.mjs   (Docker image)
import { closeDb, getPool } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { getEnv, loadDotEnv } from "@/lib/env";
import { refreshRollup, rollupIsEmpty } from "@/lib/grants/rollup";
import { getBoss, type ImportJob, QUEUES, scheduledSources, stopBoss } from "@/lib/queue";
import { createLogger } from "@/lib/server/logger";
import { importSource } from "./jobs/import-source";
import { maintenanceTick } from "./jobs/maintenance";
import { recoverInterruptedWork } from "./recover";
import { startStatus, stopStatus } from "./status";

loadDotEnv();
const log = createLogger("worker");

async function main() {
  const env = getEnv();
  if (env.RUN_MIGRATIONS) await runMigrations();

  const boss = await getBoss("worker");
  // Reporting first: recovery may rebuild the rollup, which the Worker page should show
  await startStatus();
  await recoverInterruptedWork(boss);

  // A database restored without its rollup (it isn't needed in a backup) gets one now
  const awards = await getPool().query("SELECT 1 FROM award LIMIT 1");
  if (awards.rowCount && (await rollupIsEmpty())) {
    log.info("rollup is empty; rebuilding it");
    await refreshRollup();
  }

  // One import at a time: they share the recipient table and the rollup
  await boss.work<ImportJob>(QUEUES.imports, { localConcurrency: 1 }, async ([job]) => {
    if (job) await importSource(job.data, { jobId: job.id, signal: job.signal });
  });
  await boss.work(QUEUES.maintenance, async () => {
    await maintenanceTick();
  });

  // Each scheduled source has its own schedule on the imports queue; ones no longer configured go
  const wanted = scheduledSources();
  for (const schedule of await boss.getSchedules(QUEUES.imports)) {
    if (!wanted.some((s) => s.source === schedule.key))
      await boss.unschedule(QUEUES.imports, schedule.key);
  }
  for (const { source, cron } of wanted) {
    await boss.schedule(QUEUES.imports, cron, { source, trigger: "schedule" } satisfies ImportJob, {
      key: source,
      tz: env.TZ,
      singletonKey: source,
    });
  }
  await boss.schedule(QUEUES.maintenance, "17 4 * * *", null, { tz: env.TZ });

  log.info("worker ready", { schedules: wanted });
}

let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  log.info("shutting down", { signal });
  try {
    await stopBoss();
    await stopStatus();
  } finally {
    await closeDb();
    process.exit(0);
  }
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch(async (error: unknown) => {
  log.error("worker failed to start", { error });
  await closeDb().catch(() => {});
  process.exit(1);
});
