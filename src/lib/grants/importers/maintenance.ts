/**
 * Bookkeeping after imports and edits: which amendment of each agreement is current, pruning
 * names nothing points to any more, and the fiscal-year table.
 */
import type pg from "pg";
import { getPool, inTransaction } from "@/lib/db";
import { fiscalYearBounds, fiscalYearOf } from "@/lib/grants/fiscal";
import { bumpDataVersion } from "@/lib/grants/version";

type Queryable = Pick<pg.ClientBase, "query">;

/**
 * Mark the latest amendment of each agreement as current, all others not.
 *
 * Versions of one agreement share `agreement_key` (falling back to the reference when it is
 * missing); the highest amendment number wins, then the latest amendment date, then the row
 * imported last.
 */
export async function refreshCurrentFlags(client: Queryable, organizationId: number) {
  // An import's rows are new in this transaction: without statistics for them the planner
  // reads the join below row by row. ANALYZE counts the transaction's own inserts.
  await client.query("ANALYZE award");
  await client.query(
    `UPDATE award a
        SET is_current = (a.id = latest.id)
       FROM (
             SELECT DISTINCT ON (aw.ministry_id, COALESCE(aw.agreement_key, 'ref:' || aw.reference))
                    aw.id, aw.ministry_id, COALESCE(aw.agreement_key, 'ref:' || aw.reference) AS akey
               FROM award aw
               JOIN ministry m ON m.id = aw.ministry_id
              WHERE m.organization_id = $1 AND aw.record_kind = 'agreement'
              ORDER BY aw.ministry_id, COALESCE(aw.agreement_key, 'ref:' || aw.reference),
                       aw.amendment_number DESC, aw.amendment_date DESC NULLS LAST, aw.id DESC
            ) latest
      WHERE a.ministry_id = latest.ministry_id
        AND COALESCE(a.agreement_key, 'ref:' || a.reference) = latest.akey
        AND a.record_kind = 'agreement'
        AND a.is_current IS DISTINCT FROM (a.id = latest.id)`,
    [organizationId],
  );
}

export interface PruneCounts {
  recipients: number;
  programs: number;
  ministries: number;
}

/**
 * Delete recipients, programs and ministries no award points to; returns the counts.
 *
 * Re-imports change which names are kept, so earlier spellings can be left with no awards.
 * Pruning keeps them out of search results, which matters for privacy: an orphan may be a name
 * (or a fragment of one, from a misaligned row) that a later, stricter rule now withholds.
 */
export async function pruneOrphans(): Promise<PruneCounts> {
  const noAward = (col: string) => `NOT EXISTS (SELECT 1 FROM award a WHERE a.${col} = t.id)`;
  const counts: PruneCounts = { recipients: 0, programs: 0, ministries: 0 };
  await inTransaction(async (client) => {
    await client.query(
      `DELETE FROM recipient_alias WHERE recipient_id IN
         (SELECT t.id FROM recipient t WHERE ${noAward("recipient_id")})`,
    );
    counts.recipients =
      (
        await client.query(
          `DELETE FROM recipient WHERE id IN (SELECT t.id FROM recipient t WHERE ${noAward("recipient_id")})`,
        )
      ).rowCount ?? 0;
    counts.programs =
      (
        await client.query(
          `DELETE FROM program WHERE id IN (SELECT t.id FROM program t WHERE ${noAward("program_id")})`,
        )
      ).rowCount ?? 0;
    counts.ministries =
      (
        await client.query(
          `DELETE FROM ministry WHERE id IN (SELECT t.id FROM ministry t WHERE ${noAward("ministry_id")}
             AND NOT EXISTS (SELECT 1 FROM program p WHERE p.ministry_id = t.id))`,
        )
      ).rowCount ?? 0;
  });
  if (counts.recipients || counts.programs || counts.ministries) await bumpDataVersion();
  return counts;
}

/**
 * Make the fiscal_year rows match the span of the award data exactly.
 *
 * Creates the missing years and deletes years outside the span, so rows left by an earlier, bad
 * import (e.g. misaligned columns read as dates) don't linger. Returns the span (null with no
 * awards) and how many rows were created and deleted.
 */
export async function ensureFiscalYears(client: Queryable = getPool()) {
  const bounds = await client.query<{ lo: string | null; hi: string | null }>(
    "SELECT MIN(start_date) AS lo, MAX(start_date) AS hi FROM award",
  );
  const { lo, hi } = bounds.rows[0] ?? { lo: null, hi: null };
  if (!lo || !hi) return { first: null, last: null, created: 0, deleted: 0 };
  const first = fiscalYearOf(lo);
  const last = fiscalYearOf(hi);
  const years: number[] = [];
  for (let year = first; year <= last; year++) years.push(year);
  const created = await client.query(
    `INSERT INTO fiscal_year (year, start_date, end_date)
     SELECT * FROM unnest($1::int[], $2::date[], $3::date[]) ON CONFLICT (year) DO NOTHING`,
    [
      years,
      years.map((year) => fiscalYearBounds(year)[0]),
      years.map((year) => fiscalYearBounds(year)[1]),
    ],
  );
  const deleted = await client.query("DELETE FROM fiscal_year WHERE year < $1 OR year > $2", [
    first,
    last,
  ]);
  return { first, last, created: created.rowCount ?? 0, deleted: deleted.rowCount ?? 0 };
}
