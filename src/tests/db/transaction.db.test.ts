/** The shared transaction helper behind the importer, the rollup and pruning. */
import { sql } from "drizzle-orm";
import type pg from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getPool, inDbTransaction, inTransaction } from "@/lib/db";
import { resetDb } from "@/tests/db/helpers";

beforeEach(resetDb);
afterEach(() => {
  vi.restoreAllMocks();
});

const settings = async () =>
  (await getPool().query("SELECT key FROM app_setting WHERE key LIKE 'tx-test%' ORDER BY key"))
    .rows;

describe("inTransaction", () => {
  it("commits what the work did", async () => {
    await inTransaction((client) =>
      client.query(`INSERT INTO app_setting (key, value) VALUES ('tx-test-1', '1')`),
    );
    expect(await settings()).toEqual([{ key: "tx-test-1" }]);
  });

  it("rolls it back when the work throws", async () => {
    await expect(
      inTransaction(async (client) => {
        await client.query(`INSERT INTO app_setting (key, value) VALUES ('tx-test-2', '1')`);
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(await settings()).toEqual([]);
  });

  it("closes a connection that died rather than handing it back", async () => {
    let dead: unknown;
    await expect(
      inTransaction(async (client) => {
        dead = client;
        // The server ends this session, as a restart or failover would
        await getPool().query("SELECT pg_terminate_backend($1)", [
          (await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
        ]);
        await client.query("SELECT 1");
      }),
    ).rejects.toThrow();
    // Every connection the pool hands out now works
    const pool = getPool();
    const clients = await Promise.all(
      Array.from({ length: pool.totalCount }, () => pool.connect()),
    );
    expect(clients).not.toContain(dead);
    for (const client of clients) client.release();
    expect((await pool.query("SELECT 1 AS ok")).rows).toEqual([{ ok: 1 }]);
  });

  it("gives back a connection whose BEGIN fails, closing it", async () => {
    const release = vi.fn();
    const broken = {
      query: vi.fn(async () => {
        throw new Error("Connection terminated unexpectedly");
      }),
      release,
    } as unknown as pg.PoolClient;
    vi.spyOn(getPool(), "connect").mockImplementation((async () => broken) as never);
    await expect(inDbTransaction(async () => "never")).rejects.toThrow("Connection terminated");
    expect(release).toHaveBeenCalledWith(true);
    // The same for Drizzle's transaction(), which Better Auth's adapter calls
    release.mockClear();
    await expect(getDb().transaction(async () => "never")).rejects.toThrow("Connection terminated");
    expect(release).toHaveBeenCalledWith(true);
  });

  it("commits through getDb().transaction as before", async () => {
    await getDb().transaction((tx) =>
      tx.execute(sql`INSERT INTO app_setting (key, value) VALUES ('tx-test-3', '1')`),
    );
    expect(await settings()).toEqual([{ key: "tx-test-3" }]);
  });
});
