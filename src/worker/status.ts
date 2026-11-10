/**
 * The worker's live status: one row in `worker_status`, rewritten on every step, on progress (at
 * most every two seconds) and on a 15-second heartbeat. The web app reads it for the Worker page
 * and the header indicator, and treats the worker as offline after 45 seconds of silence.
 */
import { hostname } from "node:os";
import { getDb } from "@/lib/db";
import { workerStatus } from "@/lib/db/schema";
import type { ImportSource, WorkerState } from "@/lib/domain";
import { createLogger } from "@/lib/server/logger";

const log = createLogger("worker-status");

const HEARTBEAT_MS = 15_000;
/** Progress updates (one per batch of rows) are written at most this often. */
const PROGRESS_THROTTLE_MS = 2_000;

export interface Activity {
  state: WorkerState;
  source?: ImportSource | null;
  runId?: number | null;
  message?: string | null;
  progressCurrent?: number | null;
  progressTotal?: number | null;
  bytesDone?: number | null;
  bytesTotal?: number | null;
}

const IDLE: Activity = { state: "idle" };

let instance = "";
let startedAt = new Date();
let current: Activity = IDLE;
let timer: ReturnType<typeof setInterval> | undefined;
let lastProgressWrite = 0;
let queue: Promise<void> = Promise.resolve();

/**
 * Writes the current activity. Writes are chained so they reach the database in the order they
 * were made; the heartbeat and throttled progress fire without awaiting, and an older upsert
 * finishing last would otherwise put a stale step back.
 */
function write(): Promise<void> {
  queue = queue.then(writeNow, writeNow);
  return queue;
}

async function writeNow() {
  // Only the worker process reports; a CLI import never called startStatus and must not
  // overwrite the running worker's row.
  if (!instance) return;
  const now = new Date();
  const values = {
    instance,
    startedAt,
    heartbeatAt: now,
    state: current.state,
    source: current.source ?? null,
    runId: current.runId ?? null,
    message: current.message ?? null,
    progressCurrent: current.progressCurrent ?? null,
    progressTotal: current.progressTotal ?? null,
    bytesDone: current.bytesDone ?? null,
    bytesTotal: current.bytesTotal ?? null,
    updatedAt: now,
  };
  try {
    await getDb()
      .insert(workerStatus)
      .values({ id: "worker", ...values })
      .onConflictDoUpdate({ target: workerStatus.id, set: values });
  } catch (error) {
    // Status is informational; never let it break an import.
    log.warn("could not write worker status", { error });
  }
}

export async function startStatus() {
  instance = `${hostname()}:${process.pid}`;
  startedAt = new Date();
  current = IDLE;
  await write();
  timer = setInterval(() => void write(), HEARTBEAT_MS);
  timer.unref();
}

export async function stopStatus() {
  if (timer) clearInterval(timer);
  current = { state: "stopped", message: "Stopped" };
  await write();
}

/** Replaces the current activity (a new step); written immediately. */
export async function setActivity(activity: Activity) {
  current = activity;
  lastProgressWrite = Date.now();
  await write();
}

/** Updates fields of the current activity, e.g. a new phase of the same run. */
export async function updateActivity(changes: Partial<Activity>) {
  await setActivity({ ...current, ...changes });
}

/** Records progress; throttled because it fires for every batch of rows or chunk of bytes. */
export function reportProgress(changes: Partial<Activity>) {
  current = { ...current, ...changes };
  if (Date.now() - lastProgressWrite < PROGRESS_THROTTLE_MS) return;
  lastProgressWrite = Date.now();
  void write();
}

export async function setIdle() {
  await setActivity(IDLE);
}
