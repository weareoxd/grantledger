/** Award edits from the admin section, against the database (signed in as an admin). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteAward } from "@/actions/admin";
import { getPool } from "@/lib/db";
import { buildGrantsFixture, resetDb } from "@/tests/db/helpers";

vi.mock("@/lib/auth/session", () => ({
  requireAdmin: async () => ({ id: "admin-1", email: "boss@example.org", role: "admin" }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

beforeEach(async () => {
  await resetDb();
  await buildGrantsFixture();
});

/** The key of the fixture's federal agreement that was amended once (100, then 150). */
async function amendedKey() {
  const { rows } = await getPool().query<{ key: string }>(
    `SELECT COALESCE(agreement_key, 'ref:' || reference) AS key FROM award
      WHERE record_kind = 'agreement' GROUP BY 1 HAVING count(*) > 1`,
  );
  return rows[0]?.key as string;
}

async function amendments(key: string) {
  const { rows } = await getPool().query<{ id: number; value: string; is_current: boolean }>(
    `SELECT id, value, is_current FROM award
      WHERE record_kind = 'agreement' AND COALESCE(agreement_key, 'ref:' || reference) = $1
      ORDER BY amendment_number`,
    [key],
  );
  return rows;
}

describe("deleting an award", () => {
  it("makes the latest amendment left current when the current one goes", async () => {
    const key = await amendedKey();
    const [first, latest] = await amendments(key);
    expect([first?.is_current, latest?.is_current]).toEqual([false, true]);
    expect(await deleteAward({ id: latest?.id })).toMatchObject({ ok: true });
    expect(await amendments(key)).toEqual([{ id: first?.id, value: "100.00", is_current: true }]);
  });

  it("leaves the current amendment alone when an earlier one goes", async () => {
    const key = await amendedKey();
    const [first, latest] = await amendments(key);
    expect(await deleteAward({ id: first?.id })).toMatchObject({ ok: true });
    expect(await amendments(key)).toEqual([{ id: latest?.id, value: "150.00", is_current: true }]);
  });
});
