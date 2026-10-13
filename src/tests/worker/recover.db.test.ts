/** Starting again after the worker stopped mid-run. */
import type { PgBoss } from "pg-boss";
import { beforeEach, describe, expect, it } from "vitest";
import { getPool } from "@/lib/db";
import { checkRollup } from "@/lib/grants/rollup";
import { buildGrantsFixture, resetDb } from "@/tests/db/helpers";
import { recoverInterruptedWork } from "@/worker/recover";

/** No pg-boss jobs to clean up: only the runs matter here. */
const boss = { findJobs: async () => [], fail: async () => {} } as unknown as PgBoss;

beforeEach(async () => {
  await resetDb();
  await buildGrantsFixture();
});

async function addRun(status: string) {
  const { rows } = await getPool().query<{ id: number }>(
    `INSERT INTO import_run (source, trigger, status, batch_id) VALUES ('alberta_live', 'manual', $1, gen_random_uuid()) RETURNING id`,
    [status],
  );
  return rows[0]?.id;
}

const runError = async (id: number | undefined) =>
  (await getPool().query("SELECT status, error FROM import_run WHERE id = $1", [id])).rows[0];

describe("recoverInterruptedWork", () => {
  it("rebuilds the totals when a run stopped after its import committed", async () => {
    const id = await addRun("rollup");
    // The rows are in, but the rollup rebuild never finished
    await getPool().query("TRUNCATE award_rollup");
    expect(await checkRollup()).not.toEqual([]);
    await recoverInterruptedWork(boss);
    expect(await checkRollup()).toEqual([]);
    expect(await runError(id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("Its rows were imported"),
    });
  });

  it("prunes names no award uses when a run stopped while pruning", async () => {
    const id = await addRun("pruning");
    await getPool().query(
      "INSERT INTO recipient (name, display_name) VALUES ('ORPHANED NAME', 'Orphaned Name')",
    );
    await recoverInterruptedWork(boss);
    const left = await getPool().query("SELECT 1 FROM recipient WHERE name = 'ORPHANED NAME'");
    expect(left.rowCount).toBe(0);
    expect(await runError(id)).toMatchObject({
      status: "failed",
      error: expect.stringContaining("names were pruned"),
    });
  });

  it("says nothing was kept for a run stopped while importing", async () => {
    const id = await addRun("importing");
    await recoverInterruptedWork(boss);
    expect(await runError(id)).toMatchObject({
      status: "failed",
      error: "The worker stopped during this run; nothing it imported was kept.",
    });
  });
});
