/**
 * What the Worker page and the header indicator show: the worker's live status, the queue, the
 * runs in progress, and (for the page) the schedule and the history of imports.
 */
import { Cron } from "croner";
import { desc, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { importRun } from "@/lib/db/schema";
import type { ImportSource, RunStatus, RunTrigger, WorkerState } from "@/lib/domain";
import { IMPORT_SOURCES } from "@/lib/domain";
import { getEnv } from "@/lib/env";
import { sourceFiles } from "@/lib/grants/sources";
import { getBoss, type ImportJob, QUEUES, scheduledSources, sourceEnabled } from "@/lib/queue";
import { getFileStates, getSetting } from "@/lib/settings";

/** The worker counts as offline when its 15-second heartbeat has been silent this long. */
export const OFFLINE_AFTER_MS = 45_000;

export type WorkerInfo = {
  online: boolean;
  state: WorkerState;
  instance: string;
  startedAt: string;
  heartbeatAt: string;
  source: ImportSource | null;
  runId: number | null;
  message: string | null;
  progressCurrent: number | null;
  progressTotal: number | null;
  bytesDone: number | null;
  bytesTotal: number | null;
};

export type QueuedImport = {
  jobId: string;
  source: ImportSource;
  trigger: RunTrigger;
  force: boolean;
  startAfter: string;
  createdOn: string;
};

export type ActiveRun = {
  id: number;
  source: ImportSource;
  status: RunStatus;
  sourceFile: string | null;
  startedAt: string | null;
};

/** Everything the live indicator and the Worker page poll for; plain JSON (dates as ISO strings). */
export type WorkerSnapshot = {
  worker: WorkerInfo | null;
  queued: QueuedImport[];
  /** Files being downloaded or imported, or waiting their turn within a job that has started. */
  active: ActiveRun[];
  failedLast24h: number;
  lastFinished: { finishedAt: string; status: RunStatus; source: ImportSource } | null;
  paused: boolean;
  /** True while anything is queued or running (clients poll faster then). */
  busy: boolean;
  /** Changes whenever a run finishes, so clients know to refresh. */
  finishedKey: string;
};

const iso = (value: Date | string | null | undefined) =>
  value ? new Date(value).toISOString() : null;

async function queuedImports(): Promise<QueuedImport[]> {
  const boss = await getBoss();
  const jobs = await boss.findJobs<ImportJob>(QUEUES.imports, { queued: true });
  return jobs
    .map((job) => ({
      jobId: job.id,
      source: job.data.source,
      trigger: job.data.trigger,
      force: Boolean(job.data.force),
      startAfter: new Date(job.startAfter).toISOString(),
      createdOn: new Date(job.createdOn).toISOString(),
    }))
    .sort((a, b) => a.startAfter.localeCompare(b.startAfter));
}

export async function getWorkerSnapshot(): Promise<WorkerSnapshot> {
  const db = getDb();
  const [status, active, failed, last, queued, paused] = await Promise.all([
    db.execute<{
      state: WorkerState;
      instance: string;
      startedAt: Date;
      heartbeatAt: Date;
      source: ImportSource | null;
      runId: number | null;
      message: string | null;
      progressCurrent: number | null;
      progressTotal: number | null;
      bytesDone: number | null;
      bytesTotal: number | null;
    }>(sql`
      select state, instance, started_at as "startedAt", heartbeat_at as "heartbeatAt", source,
        run_id as "runId", message, progress_current as "progressCurrent",
        progress_total as "progressTotal", bytes_done as "bytesDone", bytes_total as "bytesTotal"
      from worker_status where id = 'worker'
    `),
    db.execute<{
      id: number;
      source: ImportSource;
      status: RunStatus;
      sourceFile: string | null;
      startedAt: Date | null;
    }>(sql`
      select id, source, status, source_file as "sourceFile", started_at as "startedAt"
      from import_run where status in ('queued', 'downloading', 'importing', 'pruning', 'rollup')
      order by id
    `),
    db.execute<{ count: number }>(sql`
      select count(*)::int as count from import_run
      where status = 'failed' and finished_at >= now() - interval '24 hours'
    `),
    db.execute<{ id: number; finishedAt: Date; status: RunStatus; source: ImportSource }>(sql`
      select id, finished_at as "finishedAt", status, source from import_run
      where finished_at is not null order by finished_at desc, id desc limit 1
    `),
    queuedImports().catch(() => [] as QueuedImport[]),
    getSetting("paused"),
  ]);

  const row = status.rows[0];
  const worker: WorkerInfo | null = row
    ? {
        ...row,
        online:
          row.state !== "stopped" &&
          Date.now() - new Date(row.heartbeatAt).getTime() < OFFLINE_AFTER_MS,
        startedAt: new Date(row.startedAt).toISOString(),
        heartbeatAt: new Date(row.heartbeatAt).toISOString(),
      }
    : null;
  const lastRow = last.rows[0];

  return {
    worker,
    queued,
    active: active.rows.map((run) => ({ ...run, startedAt: iso(run.startedAt) })),
    failedLast24h: failed.rows[0]?.count ?? 0,
    lastFinished: lastRow
      ? {
          finishedAt: new Date(lastRow.finishedAt).toISOString(),
          status: lastRow.status,
          source: lastRow.source,
        }
      : null,
    paused,
    busy:
      queued.length > 0 ||
      active.rows.length > 0 ||
      (worker?.online === true && worker.state !== "idle"),
    finishedKey: lastRow ? `${lastRow.id}:${iso(lastRow.finishedAt)}` : "none",
  };
}

export type SourceSchedule = {
  source: ImportSource;
  /** false for a source turned off by its setting (federal: FEDERAL_IMPORTS_ENABLED). */
  enabled: boolean;
  /** null for a source that only runs when asked (the yearly archives). */
  cron: string | null;
  next: string | null;
  timeZone: string;
  lastRun: { finishedAt: string | null; status: RunStatus } | null;
  /** The files it last imported, with their size and when. */
  files: {
    key: string;
    sourceFile: string | null;
    size: number | null;
    importedAt: string | null;
  }[];
};

/** Each source's schedule, last run and the files it last imported. */
export async function getSchedules(): Promise<SourceSchedule[]> {
  const env = getEnv();
  const crons = new Map(scheduledSources().map((s) => [s.source, s.cron]));
  const lastRuns = await getDb().execute<{
    source: ImportSource;
    finishedAt: Date | null;
    status: RunStatus;
  }>(sql`
    select distinct on (source) source, finished_at as "finishedAt", status
    from import_run order by source, id desc
  `);
  const last = new Map(lastRuns.rows.map((row) => [row.source, row]));
  const keys = IMPORT_SOURCES.flatMap((source) => sourceFiles(source).map((file) => file.key));
  const states = await getFileStates(keys);
  return IMPORT_SOURCES.map((source) => {
    const cron = crons.get(source) ?? null;
    let next: string | null = null;
    if (cron) {
      try {
        next = new Cron(cron, { timezone: env.TZ }).nextRun()?.toISOString() ?? null;
      } catch {
        next = null;
      }
    }
    const lastRun = last.get(source);
    return {
      source,
      enabled: sourceEnabled(source),
      cron,
      next,
      timeZone: env.TZ,
      lastRun: lastRun ? { finishedAt: iso(lastRun.finishedAt), status: lastRun.status } : null,
      files: sourceFiles(source)
        .map((file) => ({ key: file.key, state: states[file.key] }))
        .filter((entry) => entry.state)
        .map(({ key, state }) => ({
          key,
          sourceFile: state?.sourceFile ?? null,
          size: state?.size ?? null,
          importedAt: state?.importedAt ?? null,
        })),
    };
  });
}

export type ImportRunRow = {
  id: number;
  source: ImportSource;
  trigger: RunTrigger;
  status: RunStatus;
  batchId: string | null;
  sourceFile: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  bytesDownloaded: number | null;
  rowsRead: number | null;
  rowsImported: number | null;
  rowsSkipped: number | null;
  rowsWithheld: number | null;
  rowsNotDisclosed: number | null;
  rowsMalformed: number | null;
  rowsReplaced: number | null;
  rollupRows: number | null;
  error: string | null;
};

export async function listImportRuns(limit = 200): Promise<ImportRunRow[]> {
  const rows = await getDb().select().from(importRun).orderBy(desc(importRun.id)).limit(limit);
  return rows.map((row) => ({
    id: row.id,
    source: row.source,
    trigger: row.trigger,
    status: row.status,
    batchId: row.batchId,
    sourceFile: row.sourceFile,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    bytesDownloaded: row.bytesDownloaded,
    rowsRead: row.rowsRead,
    rowsImported: row.rowsImported,
    rowsSkipped: row.rowsSkipped,
    rowsWithheld: row.rowsWithheld,
    rowsNotDisclosed: row.rowsNotDisclosed,
    rowsMalformed: row.rowsMalformed,
    rowsReplaced: row.rowsReplaced,
    rollupRows: row.rollupRows,
    error: row.error,
  }));
}
