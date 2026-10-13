/**
 * The import job: download each of a source's files, import the ones that changed, then prune
 * names nothing points to and rebuild the rollup once for the batch.
 *
 * Every file gets an import_run row that the Worker page shows: queued, downloading, importing,
 * pruning, rollup, then succeeded, skipped (unchanged, or imports paused) or failed. A file is a
 * transaction of its own, so a failure leaves earlier files imported and that one as it was.
 */
import { randomUUID } from "node:crypto";
import { open, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { importRun } from "@/lib/db/schema";
import type { RunStatus } from "@/lib/domain";
import { IMPORT_SOURCE_LABELS } from "@/lib/domain";
import { getEnv } from "@/lib/env";
import { importAlberta } from "@/lib/grants/importers/alberta";
import type { ImportStats } from "@/lib/grants/importers/base";
import { importFederal } from "@/lib/grants/importers/federal";
import { pruneOrphans } from "@/lib/grants/importers/maintenance";
import { checkRollup, refreshRollup } from "@/lib/grants/rollup";
import {
  albertaFileName,
  exportFiscalYear,
  type SourceFile,
  sourceFiles,
} from "@/lib/grants/sources";
import { type ImportJob, sourceDisabledReason } from "@/lib/queue";
import { createLogger } from "@/lib/server/logger";
import { type FileState, getFileState, getSetting, setFileState } from "@/lib/settings";
import { download } from "../download";
import { reportProgress, setActivity, setIdle } from "../status";

const log = createLogger("import");

type RunPatch = Partial<typeof importRun.$inferInsert>;

async function updateRun(id: number, patch: RunPatch) {
  await getDb().update(importRun).set(patch).where(eq(importRun.id, id));
}

function dataPath(relative: string) {
  return resolve(getEnv().DATA_DIR, relative);
}

/**
 * After a batch's files are imported: removes names no award uses any more, then rebuilds the
 * rollup behind the lists and checks it against the awards. Returns what to record on the runs.
 * Also used at startup for runs a stopped worker left part-way through this.
 */
export async function finishImported(source: ImportJob["source"], ids: number[]) {
  const db = getDb();
  await db.update(importRun).set({ status: "pruning" }).where(inArray(importRun.id, ids));
  await setActivity({ state: "pruning", source, message: "Removing names no award uses" });
  const pruned = await pruneOrphans();
  await db
    .update(importRun)
    .set({ status: "rollup", pruned: { ...pruned } })
    .where(inArray(importRun.id, ids));
  await setActivity({ state: "rollup", source, message: "Rebuilding the list totals" });
  const rollupRows = await refreshRollup();
  const problems = await checkRollup();
  return { rollupRows, problems };
}

/** The first two lines of a file (the header and the first row). */
async function firstLines(path: string) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(64 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, bytesRead).toString("latin1");
  } finally {
    await handle.close();
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

interface Imported {
  runId: number;
  file: SourceFile;
  state: FileState;
}

export async function importSource(
  job: ImportJob,
  options: { jobId?: string; signal?: AbortSignal } = {},
) {
  const env = getEnv();
  const db = getDb();
  const batchId = randomUUID();
  const label = IMPORT_SOURCE_LABELS[job.source];

  // A source that is turned off, or a scheduled run while imports are paused, leaves a note and
  // does nothing
  const skipReason =
    sourceDisabledReason(job.source) ??
    (job.trigger === "schedule" && (await getSetting("paused")) ? "Imports are paused" : null);
  if (skipReason) {
    await db.insert(importRun).values({
      source: job.source,
      trigger: job.trigger,
      status: "skipped",
      batchId,
      jobId: options.jobId,
      finishedAt: new Date(),
      error: skipReason,
    });
    return;
  }

  const files = sourceFiles(job.source);
  const runs = await db
    .insert(importRun)
    .values(
      files.map((file) => ({
        source: job.source,
        trigger: job.trigger,
        status: "queued" as RunStatus,
        batchId,
        jobId: options.jobId,
        sourceFile: file.sourceFile,
        url: file.url,
      })),
    )
    .returning({ id: importRun.id });

  const imported: Imported[] = [];
  let current: number | null = null;
  try {
    for (const [index, file] of files.entries()) {
      const runId = (runs[index] as { id: number }).id;
      current = runId;
      options.signal?.throwIfAborted();
      const previous = await getFileState(file.key);
      const shown = file.sourceFile ?? label;

      // 1. Download (conditionally: an unchanged file isn't fetched again)
      await updateRun(runId, { status: "downloading", startedAt: new Date() });
      await setActivity({
        state: "downloading",
        source: job.source,
        runId,
        message: `Downloading ${shown}`,
        bytesDone: 0,
        bytesTotal: previous?.size ?? null,
      });
      let path = dataPath(file.path);
      const result = await download(file.url, path, {
        previous,
        force: job.force,
        signal: options.signal,
        onProgress: (bytes, total) => {
          reportProgress({ bytesDone: bytes, bytesTotal: total });
        },
      });
      if (result.notModified) {
        await updateRun(runId, {
          status: "skipped",
          finishedAt: new Date(),
          sourceFile: previous?.sourceFile ?? file.sourceFile,
          error: "Unchanged since the last import (the server said so)",
        });
        continue;
      }

      // The live export is named by the fiscal year it holds
      let sourceFile = file.sourceFile;
      if (!sourceFile) {
        const fiscalYear = exportFiscalYear(await firstLines(path));
        if (!fiscalYear) throw new Error("The export's fiscal year wasn't found in the file");
        sourceFile = albertaFileName(fiscalYear);
        const named = dataPath(join("alberta", sourceFile));
        await rename(path, named);
        path = named;
      }
      const state: FileState = {
        etag: result.etag,
        lastModified: result.lastModified,
        size: result.bytes,
        sha256: result.sha256,
        sourceFile,
        importedAt: new Date().toISOString(),
      };
      await updateRun(runId, {
        sourceFile,
        bytesDownloaded: result.bytes,
        bytesTotal: result.bytes,
        etag: result.etag,
        lastModified: result.lastModified,
      });
      if (!job.force && previous?.sha256 === result.sha256 && previous.sourceFile === sourceFile) {
        await updateRun(runId, {
          status: "skipped",
          finishedAt: new Date(),
          error: "Unchanged since the last import (same contents)",
        });
        await setFileState(file.key, { ...state, importedAt: previous.importedAt });
        continue;
      }

      // 2. Import (one transaction; a re-import replaces the file's rows)
      await updateRun(runId, { status: "importing" });
      await setActivity({
        state: "importing",
        source: job.source,
        runId,
        message: `Importing ${sourceFile}`,
        progressCurrent: 0,
        progressTotal: null,
        bytesDone: 0,
        bytesTotal: result.bytes,
      });
      const importer = file.organization === "federal" ? importFederal : importAlberta;
      const stats: ImportStats = await importer(path, {
        sourceFile,
        includeIndividuals: env.IMPORT_INCLUDE_INDIVIDUALS,
        signal: options.signal,
        onProgress: (progress) =>
          reportProgress({
            progressCurrent: progress.rowsRead,
            bytesDone: progress.bytesRead,
            bytesTotal: progress.bytesTotal,
          }),
      });
      await updateRun(runId, {
        rowsRead: stats.read,
        rowsImported: stats.imported,
        rowsSkipped: stats.skipped,
        rowsWithheld: stats.withheld_individuals,
        rowsNotDisclosed: stats.not_disclosed,
        rowsEstimatedDates: stats.estimated_dates,
        rowsMalformed: stats.malformed,
        rowsReplaced: stats.replaced,
      });
      imported.push({ runId, file, state });
    }
    current = null;

    // 3. Once for the batch: names nothing points to any more, then the rollup
    if (imported.length) {
      const ids = imported.map((i) => i.runId);
      const { rollupRows, problems } = await finishImported(job.source, ids);
      await db
        .update(importRun)
        .set({
          status: "succeeded",
          finishedAt: new Date(),
          rollupRows,
          error: problems.length
            ? `Rollup check: ${problems.length} mismatches (${problems.slice(0, 3).join("; ")})`
            : null,
        })
        .where(inArray(importRun.id, ids));
      for (const { file, state } of imported) await setFileState(file.key, state);
    }
    log.info("import finished", {
      source: job.source,
      imported: imported.length,
      files: files.length,
    });
  } catch (error) {
    const message = options.signal?.aborted ? "Cancelled" : errorMessage(error);
    log.error("import failed", { source: job.source, error });
    if (current !== null) {
      await updateRun(current, { status: "failed", finishedAt: new Date(), error: message });
    }
    const done = imported.map((i) => i.runId);
    // A later file failed, but the ones before it are imported (each commits on its own): the
    // lists' totals must include them, as after a run that succeeds
    if (current !== null && done.length) {
      try {
        await finishImported(job.source, done);
        // Their files are in: the next run skips them while unchanged
        for (const { file, state } of imported) await setFileState(file.key, state);
      } catch (cleanupError) {
        log.error("cleanup after a partial import failed", { error: cleanupError });
      }
    }
    if (done.length) {
      // Their rows were imported (each file commits on its own); what came after them failed
      await db
        .update(importRun)
        .set({
          status: "failed",
          finishedAt: new Date(),
          error:
            current === null
              ? `Imported, but the cleanup after it failed: ${message}`
              : `Imported, but a later file in the same run failed: ${message}`,
        })
        .where(inArray(importRun.id, done));
    }
    // Files never reached
    await db
      .update(importRun)
      .set({
        status: "skipped",
        finishedAt: new Date(),
        error: "Skipped because an earlier step failed",
      })
      .where(
        and(
          inArray(
            importRun.id,
            runs.map((r) => r.id),
          ),
          eq(importRun.status, "queued"),
        ),
      );
    throw error;
  } finally {
    await setIdle();
  }
}
