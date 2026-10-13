import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import { databaseSsl, getEnv } from "@/lib/env";
import { createLogger } from "@/lib/server/logger";
import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";
import { DB_SCHEMA } from "./schema-name";

// `date` columns stay ISO strings ("2024-04-01"), so nothing shifts across time zones.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
// COUNT(*) and other bigints: counts and ids here stay far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));
// `numeric` (money) is left as the driver's string: sums run past what a double holds exactly.

const log = createLogger("db");

export const schema = { ...appSchema, ...authSchema };

export type Db = NodePgDatabase<typeof schema>;

type DbGlobal = { __grantsPool?: pg.Pool; __grantsDb?: Db };
const store = globalThis as DbGlobal;

/**
 * Settings every connection to the app's database uses: unqualified names (the raw SQL's tables,
 * and `gin_trgm_ops` from the shared `public`) resolve in the app's schema, then `public`.
 */
export function connectionOptions() {
  return {
    connectionString: getEnv().DATABASE_URL,
    options: `-c search_path=${DB_SCHEMA},public`,
    ssl: databaseSsl(),
  };
}

/** Shared pool, cached on globalThis so dev HMR does not leak connections. */
export function getPool(): pg.Pool {
  if (!store.__grantsPool) {
    const pool = new pg.Pool({ ...connectionOptions(), max: 10 });
    // An idle connection dropped by the server (a restart, a terminated backend) emits an error
    // on the pool; unhandled, it would end the process. The pool replaces the connection.
    pool.on("error", (error) => log.warn("idle database connection lost", { error }));
    // The pool only listens while a connection is idle. One checked out (a transaction, an
    // import, an export) that the server drops emits "error" too; unheard, that ends the
    // process. Its query fails on its own, and the caller handles that.
    pool.on("connect", (client) => {
      client.on("error", (error) => log.warn("database connection lost", { error }));
    });
    store.__grantsPool = pool;
  }
  return store.__grantsPool;
}

/**
 * Runs `work` on one connection of its own, in a transaction: committed when it returns, rolled
 * back when it throws. A connection whose rollback fails too (the server restarted, the network
 * dropped) is closed rather than handed back to the pool for the next request to trip over.
 */
export async function inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  let broken = false;
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {
      broken = true;
    });
    throw error;
  } finally {
    client.release(broken);
  }
}

/**
 * As `inTransaction`, with a Drizzle database on the transaction's connection. Used instead of
 * Drizzle's own `transaction()`, which sends BEGIN outside its try/finally (a failed BEGIN never
 * gives its connection back) and hands a connection whose rollback failed back to the pool.
 */
export function inDbTransaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
  return inTransaction((client) => {
    const tx = drizzle(client, { schema });
    // Already in a transaction: a nested one just joins it (nothing here nests, or rolls back
    // part of one)
    tx.transaction = ((nested: (inner: Db) => Promise<unknown>) => nested(tx)) as Db["transaction"];
    return work(tx);
  });
}

export function getDb(): Db {
  if (!store.__grantsDb) {
    const db = drizzle(getPool(), { schema });
    // Every transaction, ours and Better Auth's adapter's (sign-in), goes through
    // inDbTransaction rather than Drizzle's own (see above)
    db.transaction = ((work: (tx: Db) => Promise<unknown>) =>
      inDbTransaction(work)) as Db["transaction"];
    store.__grantsDb = db;
  }
  return store.__grantsDb;
}

export async function closeDb() {
  await store.__grantsPool?.end();
  store.__grantsPool = undefined;
  store.__grantsDb = undefined;
}
