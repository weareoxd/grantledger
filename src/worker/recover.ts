import { inArray } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { getDb } from "@/lib/db";
import { importRun } from "@/lib/db/schema";
import { ACTIVE_RUN_STATUSES } from "@/lib/domain";
import { QUEUES } from "@/lib/queue";
import { createLogger } from "@/lib/server/logger";
import { finishImported } from "./jobs/import-source";
import { setIdle } from "./status";

const log = createLogger("recover");

/**
 * Cleans up after a worker that stopped mid-job (a crash, a deploy, `tsx watch` reloading).
 * There is only ever one worker, so anything still marked active belongs to the dead process.
 * An interrupted import rolled its transaction back, so the data is as it was before it. A run
 * that had got past importing (pruning, or rebuilding the rollup) had committed its rows, so that
 * cleanup is finished here: names nothing uses are pruned and the rollup rebuilt to match.
 */
export async function recoverInterruptedWork(boss: PgBoss) {
  const db = getDb();
  const interrupted = await db
    .select({ id: importRun.id, source: importRun.source, status: importRun.status })
    .from(importRun)
    .where(inArray(importRun.status, [...ACTIVE_RUN_STATUSES]));
  const committed = interrupted.filter(
    (run) => run.status === "pruning" || run.status === "rollup",
  );
  const rolledBack = interrupted.filter((run) => !committed.includes(run));
  if (rolledBack.length) {
    await db
      .update(importRun)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: "The worker stopped during this run; nothing it imported was kept.",
      })
      .where(
        inArray(
          importRun.id,
          rolledBack.map((run) => run.id),
        ),
      );
  }
  if (committed.length) {
    // Their rows are in: finish what the stopped worker was doing (prune, then the rollup)
    const ids = committed.map((run) => run.id);
    log.info("finishing runs interrupted after their import", { runs: ids });
    await finishImported((committed[0] as (typeof committed)[number]).source, ids);
    await db
      .update(importRun)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error:
          "The worker stopped while finishing this run. Its rows were imported; names were pruned and the list totals rebuilt when it restarted.",
      })
      .where(inArray(importRun.id, ids));
    await setIdle();
  }

  // Active jobs of the dead process would hold their source's queue slot until they expire.
  const active = (await boss.findJobs(QUEUES.imports)).filter((job) => job.state === "active");
  if (active.length > 0) {
    await boss.fail(
      QUEUES.imports,
      active.map((job) => job.id),
      { error: "worker restarted" },
    );
  }
  if (interrupted.length || active.length) {
    log.warn("cleaned up work interrupted by a restart", {
      runs: interrupted.length,
      jobs: active.length,
    });
  }
}
