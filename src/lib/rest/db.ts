/**
 * Database access for the web API: every request's queries run in one transaction with a
 * statement timeout (`limited`), so one expensive request can't tie up the database. The
 * transaction travels with the request through AsyncLocalStorage, so helpers just call `rows()`.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { type Db, getDb, inDbTransaction } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { ApiError } from "./errors";

type Executor = Pick<Db, "execute">;

const current = new AsyncLocalStorage<Executor>();

const QUERY_CANCELED = "57014";

/** The rows of a query, on the request's transaction when there is one. */
export async function rows<T = Record<string, unknown>>(query: SQL): Promise<T[]> {
  const executor = current.getStore() ?? getDb();
  const result = await executor.execute(query);
  return result.rows as T[];
}

export async function one<T = Record<string, unknown>>(query: SQL): Promise<T | undefined> {
  return (await rows<T>(query))[0];
}

function sqlState(error: unknown): string | undefined {
  let cause: unknown = error;
  for (let depth = 0; depth < 4 && cause; depth++) {
    const code = (cause as { code?: unknown }).code;
    if (typeof code === "string") return code;
    cause = (cause as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Run `compute` in a transaction with a statement timeout and the lists' work_mem; its `rows()`
 * calls use that transaction. A query that runs too long fails with SQLSTATE 57014.
 */
export function withStatementTimeout<T>(compute: () => Promise<T>, timeoutMs: number): Promise<T> {
  return inDbTransaction(async (tx) => {
    await tx.execute(
      sql`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true), set_config('work_mem', ${getEnv().API_WORK_MEM}, true)`,
    );
    return current.run(tx, compute);
  });
}

/** Whether `error` is a statement cancelled by its timeout. */
export function isStatementTimeout(error: unknown): boolean {
  return sqlState(error) === QUERY_CANCELED;
}

/**
 * Run `compute` in a transaction with a statement timeout (`timeoutMs`, or
 * API_STATEMENT_TIMEOUT_MS) and the lists' work_mem. A timeout is a 503 the UI explains.
 */
export async function limited<T>(compute: () => Promise<T>, timeoutMs?: number): Promise<T> {
  try {
    return await withStatementTimeout(compute, timeoutMs ?? getEnv().API_STATEMENT_TIMEOUT_MS);
  } catch (error) {
    if (isStatementTimeout(error)) {
      throw new ApiError(503, {
        detail: "This query took too long. Narrow the filters or choose a fiscal year.",
      });
    }
    throw error;
  }
}
