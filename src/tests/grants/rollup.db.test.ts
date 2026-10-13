// The award rollup: totals per fiscal year and all years, partial refresh, checks.
import { beforeEach, describe, expect, it } from "vitest";
import { getPool } from "@/lib/db";
import { checkRollup, refreshRollup } from "@/lib/grants/rollup";
import { buildGrantsFixture, type GrantsFixture, resetDb } from "@/tests/db/helpers";

let fx: GrantsFixture;

async function totals(where: string, params: unknown[]) {
  const { rows } = await getPool().query(
    `SELECT SUM(n_awards)::int AS n, SUM(total_value) AS v FROM award_rollup WHERE ${where}`,
    params,
  );
  return rows[0] as { n: number | null; v: string | null };
}

async function addPayment(
  ministryId: number,
  programId: number,
  recipientId: number,
  reference: string,
  value: number,
  startDate: string,
) {
  await getPool().query(
    `INSERT INTO award (ministry_id, program_id, recipient_id, record_kind, reference, value, start_date)
     VALUES ($1, $2, $3, 'payment', $4, $5, $6)`,
    [ministryId, programId, recipientId, reference, value, startDate],
  );
}

beforeEach(async () => {
  await resetDb();
  fx = await buildGrantsFixture();
  await refreshRollup();
});

describe("refreshRollup", () => {
  it("counts current awards only in the all-years totals", async () => {
    // 150 + 1000 + 20; amendment 0 excluded
    expect(await totals("organization_id = $1 AND fiscal_year = 0", [fx.fed.id])).toEqual({
      n: 3,
      v: "1170.00",
    });
    expect(await totals("organization_id = $1 AND fiscal_year = 0", [fx.ab.id])).toEqual({
      n: 4,
      v: "1000035.00",
    });
  });

  it("uses the April fiscal year for per-year rows", async () => {
    const { rows } = await getPool().query(
      "SELECT DISTINCT fiscal_year FROM award_rollup WHERE fiscal_year <> 0",
    );
    expect(rows).toEqual([{ fiscal_year: 2024 }]); // Feb 2025 belongs to FY2024
  });

  it("writes one row per ministry, program, recipient and year", async () => {
    const { rows } = await getPool().query(
      "SELECT n_awards, total_value FROM award_rollup WHERE recipient_id = $1 AND ministry_id = $2 AND fiscal_year = 2024",
      [fx.shared.id, fx.culture.id],
    );
    expect(rows).toEqual([{ n_awards: 2, total_value: "30.00" }]); // 40 and -10 net
  });

  it("is exact when refreshing some ministries", async () => {
    await addPayment(fx.culture.id, fx.abProg.id, fx.shared.id, "AB-new", 500, "2023-05-01");
    await refreshRollup([fx.culture.id]);
    expect(await checkRollup()).toEqual([]);
    expect((await totals("ministry_id = $1 AND fiscal_year = 2023", [fx.culture.id])).v).toBe(
      "500.00",
    );
    expect((await totals("ministry_id = $1 AND fiscal_year = 0", [fx.health.id])).v).toBe(
      "1000000.00",
    );
  });

  it("reports drift until rebuilt", async () => {
    await addPayment(fx.health.id, fx.ffs.id, fx.undisclosed.id, "AB-drift", 1, "2024-05-01");
    expect((await checkRollup()).length).toBeGreaterThan(0);
    await refreshRollup();
    expect(await checkRollup()).toEqual([]);
  });
});
