"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { IMPORT_SOURCES } from "@/lib/domain";
import { enqueueImport, getBoss, type ImportJob, QUEUES, sourceDisabledReason } from "@/lib/queue";
import { createLogger } from "@/lib/server/logger";
import { setSetting } from "@/lib/settings";
import { type ActionResult, fail, ok } from "./result";

const log = createLogger("worker-actions");

const runInput = z.object({
  source: z.enum(IMPORT_SOURCES),
  force: z.boolean().optional().default(false),
});

/** Queue an import now (admins only). */
export async function runImportNow(
  input: z.input<typeof runInput>,
): Promise<ActionResult<{ jobId: string }>> {
  // Outside the try: a non-admin is redirected, which Next signals by throwing
  const user = await requireAdmin("/worker");
  try {
    const { source, force } = runInput.parse(input);
    const disabled = sourceDisabledReason(source);
    if (disabled) return { ok: false, error: disabled };
    const jobId = await enqueueImport({
      source,
      force,
      trigger: "manual",
      requestedBy: user.email,
    });
    if (!jobId) return { ok: false, error: "That source is already waiting in the queue." };
    log.info("import queued", { source, force, by: user.email });
    revalidatePath("/worker");
    return ok({ jobId });
  } catch (error) {
    return fail(error);
  }
}

/** Take a waiting import off the queue (admins only; one already running finishes). */
export async function cancelQueuedImport(jobId: string): Promise<ActionResult> {
  await requireAdmin("/worker");
  try {
    const id = z.string().uuid().parse(jobId);
    const boss = await getBoss();
    const job = await boss.getJobById<ImportJob>(QUEUES.imports, id);
    if (!job) return { ok: false, error: "That job isn't in the queue any more." };
    if (job.state !== "created" && job.state !== "retry") {
      return { ok: false, error: "That import has already started." };
    }
    await boss.cancel(QUEUES.imports, id);
    revalidatePath("/worker");
    return ok();
  } catch (error) {
    return fail(error);
  }
}

/** Pause or resume scheduled imports (admins only; "Run now" still works while paused). */
export async function setImportsPaused(paused: boolean): Promise<ActionResult> {
  await requireAdmin("/worker");
  try {
    await setSetting("paused", z.boolean().parse(paused));
    revalidatePath("/worker");
    return ok();
  } catch (error) {
    return fail(error);
  }
}
