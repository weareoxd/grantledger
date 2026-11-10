/**
 * Build and verify `award_rollup`, the pre-aggregated table behind the web UI's lists.
 *
 * `refreshRollup()` rebuilds everything (after an import); `refreshRollup([ids])` rebuilds only
 * the given ministries (after an admin edit). Every rollup row belongs to exactly one ministry,
 * so a per-ministry rebuild is exact.
 */
import { getPool, inTransaction } from "@/lib/db";
import { ALL_YEARS } from "@/lib/db/schema";
import { bumpDataVersion } from "@/lib/grants/version";

const FISCAL_YEAR_SQL =
  "CASE WHEN EXTRACT(MONTH FROM a.start_date) < 4 " +
  "THEN EXTRACT(YEAR FROM a.start_date)::int - 1 " +
  "ELSE EXTRACT(YEAR FROM a.start_date)::int END";

/** Rebuild the rollup (all of it, or only `ministryIds`); returns the row count written. */
export async function refreshRollup(ministryIds?: Iterable<number> | null): Promise<number> {
  const ids =
    ministryIds === undefined || ministryIds === null
      ? null
      : [...new Set(ministryIds)].sort((a, b) => a - b);
  const only = ids !== null ? " AND ministry_id = ANY($1::int[])" : "";
  const onlyA = ids !== null ? " AND a.ministry_id = ANY($1::int[])" : "";
  const args = ids !== null ? [ids] : [];

  let written = 0;
  await inTransaction(async (client) => {
    await client.query(`DELETE FROM award_rollup WHERE TRUE${only}`, args);
    const perYear = await client.query(
      `INSERT INTO award_rollup
           (organization_id, ministry_id, program_id, recipient_id, fiscal_year, n_awards, total_value)
       SELECT m.organization_id, a.ministry_id, a.program_id, a.recipient_id,
              ${FISCAL_YEAR_SQL}, COUNT(*), SUM(a.value)
         FROM award a
         JOIN ministry m ON m.id = a.ministry_id
        WHERE a.is_current${onlyA}
        GROUP BY 1, 2, 3, 4, 5`,
      args,
    );
    const allYears = await client.query(
      `INSERT INTO award_rollup
           (organization_id, ministry_id, program_id, recipient_id, fiscal_year, n_awards, total_value)
       SELECT organization_id, ministry_id, program_id, recipient_id, ${ALL_YEARS}, SUM(n_awards), SUM(total_value)
         FROM award_rollup
        WHERE fiscal_year <> ${ALL_YEARS}${only}
        GROUP BY 1, 2, 3, 4`,
      args,
    );
    written = (perYear.rowCount ?? 0) + (allYears.rowCount ?? 0);
  });
  if (ids === null) await getPool().query("ANALYZE award_rollup");
  await bumpDataVersion();
  return written;
}

/** Whether the rollup has any rows (to build it on first start). */
export async function rollupIsEmpty(): Promise<boolean> {
  const rows = await getPool().query("SELECT 1 FROM award_rollup LIMIT 1");
  return rows.rowCount === 0;
}

type Totals = Map<string, string>;

async function totals(query: string): Promise<Totals> {
  const rows = await getPool().query<{ key: string; n: number; v: string | null }>(query);
  return new Map(rows.rows.map((row) => [String(row.key), `(${row.n}, ${row.v ?? "None"})`]));
}

/**
 * Compare rollup sums with live award aggregates; returns a list of mismatch messages.
 *
 * Checks per organization and fiscal year, and per ministry (all years).
 */
export async function checkRollup(): Promise<string[]> {
  const problems: string[] = [];

  const live = await totals(
    `SELECT m.organization_id || ' FY' || ${FISCAL_YEAR_SQL} AS key, COUNT(*) AS n, SUM(a.value) AS v
       FROM award a JOIN ministry m ON m.id = a.ministry_id
      WHERE a.is_current GROUP BY m.organization_id, ${FISCAL_YEAR_SQL}`,
  );
  const rolled = await totals(
    `SELECT organization_id || ' FY' || fiscal_year AS key, SUM(n_awards) AS n, SUM(total_value) AS v
       FROM award_rollup WHERE fiscal_year <> ${ALL_YEARS} GROUP BY organization_id, fiscal_year`,
  );
  for (const key of [...new Set([...live.keys(), ...rolled.keys()])].sort()) {
    if (live.get(key) !== rolled.get(key)) {
      problems.push(
        `org ${key}: live ${live.get(key) ?? "None"} vs rollup ${rolled.get(key) ?? "None"}`,
      );
    }
  }

  const liveMinistry = await totals(
    `SELECT ministry_id AS key, COUNT(*) AS n, SUM(value) AS v
       FROM award WHERE is_current GROUP BY ministry_id`,
  );
  const rolledMinistry = await totals(
    `SELECT ministry_id AS key, SUM(n_awards) AS n, SUM(total_value) AS v
       FROM award_rollup WHERE fiscal_year = ${ALL_YEARS} GROUP BY ministry_id`,
  );
  for (const key of [...new Set([...liveMinistry.keys(), ...rolledMinistry.keys()])].sort()) {
    if (liveMinistry.get(key) !== rolledMinistry.get(key)) {
      problems.push(
        `ministry ${key}: live ${liveMinistry.get(key) ?? "None"} vs rollup ${rolledMinistry.get(key) ?? "None"}`,
      );
    }
  }
  return problems;
}
