/**
 * Overview summaries (src/lib/rest/summary.ts), against a fixture of their own.
 *
 * Government of Canada (agreements, all from grants.csv): Fisheries and Oceans Canada, with its
 * Ocean Science program, and Health Canada; Alder Society, Birch Foundation, Cedar Institute and
 * a withheld individual. Agreements this fiscal year (FY2026), last year and before, and an
 * amendment since superseded.
 *
 * Government of Alberta (payments, a file per fiscal year): Culture's payments to Alder and Birch,
 * and Health's undated yearly totals to the undisclosed recipient.
 *
 * Both governments' data runs to June 30th, 2026 (THROUGH); the tests' day is October 7th.
 */
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPool } from "@/lib/db";
import { NOT_DISCLOSED, WITHHELD_INDIVIDUAL } from "@/lib/grants/normalize";
import { refreshRollup } from "@/lib/grants/rollup";
import { bumpDataVersion } from "@/lib/grants/version";
import { resolveScope, type ScopeIds } from "@/lib/rest/lists";
import { buildSummary, dataThrough } from "@/lib/rest/summary";
import { clearCache } from "@/lib/server/cache";
import { resetDb } from "@/tests/db/helpers";
import { call } from "./client";

let signedIn = true;
vi.mock("@/lib/auth/session", () => ({
  userOrUnauthorized: async () =>
    signedIn
      ? { id: "u1", username: "tester", name: "tester", role: "user" }
      : Response.json({ detail: "Authentication credentials were not provided." }, { status: 401 }),
}));

const TODAY = "2026-10-07";
const THROUGH = "2026-06-30";
const IMPORTED = "2026-09-16";

type Id = { id: number };
let f: Record<
  | "federal"
  | "fisheries"
  | "health"
  | "science"
  | "alder"
  | "birch"
  | "cedar"
  | "withheld"
  | "amended"
  | "superseded"
  | "alberta"
  | "culture"
  | "abHealth"
  | "undisclosed",
  Id
>;

async function insert(table: string, values: Record<string, unknown>): Promise<Id> {
  const keys = Object.keys(values);
  const { rows } = await getPool().query(
    `INSERT INTO ${table} (${keys.join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")}) RETURNING id`,
    Object.values(values),
  );
  return rows[0] as Id;
}

function agreement(
  ministry: Id,
  recipient: Id,
  start: string,
  value: number,
  options: {
    kind?: string | null;
    program?: Id;
    end?: string;
    current?: boolean;
    amendment?: number;
  } = {},
) {
  return insert("award", {
    ministry_id: ministry.id,
    program_id: options.program?.id ?? null,
    recipient_id: recipient.id,
    record_kind: "agreement",
    reference: `${ministry.id}-${start}-${recipient.id}`,
    amendment_number: options.amendment ?? 0,
    is_current: options.current ?? true,
    agreement_type: options.kind === undefined ? "C" : options.kind,
    value,
    start_date: start,
    end_date: options.end ?? null,
    source_file: "grants.csv",
    import_date: IMPORTED,
  });
}

async function payment(
  ministry: Id,
  recipient: Id,
  start: string,
  value: number,
  options: { undated?: boolean; imported?: string } = {},
) {
  const month = Number(start.slice(5, 7));
  const year = month >= 4 ? Number(start.slice(0, 4)) : Number(start.slice(0, 4)) - 1;
  const { rows } = await getPool().query("SELECT COUNT(*)::int AS n FROM award");
  return insert("award", {
    ministry_id: ministry.id,
    recipient_id: recipient.id,
    record_kind: "payment",
    reference: `AB-${year}-${String(rows[0].n).padStart(7, "0")}`,
    value,
    start_date: start,
    start_date_estimated: options.undated ?? false,
    source_file: `tbf-grants-disclosure-${year}-${String((year + 1) % 100).padStart(2, "0")}.csv`,
    import_date: options.imported ?? IMPORTED,
  });
}

beforeEach(async () => {
  await resetDb();
  signedIn = true;
  const federal = await insert("organization", { key: "federal", name: "Government of Canada" });
  const fisheries = await insert("ministry", {
    organization_id: federal.id,
    name: "Fisheries and Oceans Canada",
  });
  const health = await insert("ministry", { organization_id: federal.id, name: "Health Canada" });
  const science = await insert("program", { ministry_id: fisheries.id, name: "Ocean Science" });
  const alder = await insert("recipient", { name: "ALDER SOCIETY", display_name: "Alder Society" });
  const birch = await insert("recipient", {
    name: "BIRCH FOUNDATION",
    display_name: "Birch Foundation",
  });
  const cedar = await insert("recipient", {
    name: "CEDAR INSTITUTE",
    display_name: "Cedar Institute",
  });
  const withheld = await insert("recipient", {
    name: WITHHELD_INDIVIDUAL,
    display_name: WITHHELD_INDIVIDUAL,
    is_placeholder: true,
  });
  // Alder: with Fisheries' program for years; this year more than last
  await agreement(fisheries, alder, "2020-06-01", 1000, { program: science });
  await agreement(fisheries, alder, "2025-05-01", 300, { program: science });
  const amended = await agreement(fisheries, alder, "2026-05-01", 900, {
    program: science,
    amendment: 1,
  });
  await agreement(fisheries, alder, "2026-06-15", 600, { program: science });
  // Birch: with Health last year, with Fisheries (new to it) from this year's first day
  await agreement(health, birch, "2025-06-01", 2000);
  await agreement(fisheries, birch, "2026-04-01", 500, { kind: "G" });
  // Cedar: new this year
  await agreement(health, cedar, "2026-06-20", 700);
  // A withheld individual's: new this year, the latest
  await agreement(health, withheld, "2026-06-25", 50);
  // Last year, after the same point: not compared
  await agreement(fisheries, alder, "2025-07-15", 5000, { program: science });
  // Before the ten years shown, and a typo for 2024
  await agreement(fisheries, alder, "2004-06-01", 9_000_000);
  await agreement(fisheries, alder, "2204-08-01", 9_000_000);
  // The amended agreement as first disclosed, for more and running all year: superseded
  const superseded = await agreement(fisheries, alder, "2026-05-01", 9000, {
    program: science,
    end: "2027-03-31",
    current: false,
  });

  const alberta = await insert("organization", { key: "alberta", name: "Government of Alberta" });
  const culture = await insert("ministry", { organization_id: alberta.id, name: "Culture" });
  const abHealth = await insert("ministry", { organization_id: alberta.id, name: "Health" });
  const undisclosed = await insert("recipient", {
    name: NOT_DISCLOSED,
    display_name: NOT_DISCLOSED,
    is_placeholder: true,
  });
  await payment(culture, alder, "2024-05-01", 100, { imported: "2025-06-02" });
  await payment(culture, alder, "2025-05-12", 300);
  await payment(culture, alder, "2026-05-10", 400);
  await payment(culture, birch, "2026-06-12", 250);
  // Yearly totals published without a date: on their fiscal year's first day
  await payment(abHealth, undisclosed, "2025-04-01", 800_000, { undated: true });
  await payment(abHealth, undisclosed, "2026-04-01", 1_000_000, { undated: true });
  await refreshRollup();
  clearCache();
  f = {
    federal,
    fisheries,
    health,
    science,
    alder,
    birch,
    cedar,
    withheld,
    amended,
    superseded,
    alberta,
    culture,
    abHealth,
    undisclosed,
  };
});

afterEach(() => {
  vi.useRealTimers();
});

// The summary as the API serves it, read loosely as the Python tests did
// biome-ignore lint/suspicious/noExplicitAny: test assertions over JSON
type Summary = Record<string, any>;

async function summary(
  organization: Id = f.federal,
  parts: { ministry?: Id; program?: Id; recipient?: Id } = {},
  today = TODAY,
  options: { through?: string } = {},
): Promise<Summary> {
  const ids: ScopeIds = { organization_id: organization.id };
  if (parts.ministry) ids.ministry_id = parts.ministry.id;
  if (parts.program) ids.program_id = parts.program.id;
  if (parts.recipient) ids.recipient_id = parts.recipient.id;
  // The scope without the funded-recipient check: build_summary takes any Scope
  const scope = await resolveScope({ ...ids, recipient_id: undefined });
  if (parts.recipient) {
    const { rows } = await getPool().query(
      "SELECT id, name, display_name, is_placeholder FROM recipient WHERE id = $1",
      [parts.recipient.id],
    );
    scope.recipient = rows[0];
  }
  return (await buildSummary(scope, today, options)) as Summary;
}

const awardsOf = (organization: Id) => sql`m.organization_id = ${organization.id} AND a.is_current`;

describe("the year to date", () => {
  it("compares this year to the same point last year", async () => {
    const s = await summary();
    expect([s.fiscal_year, s.through, s.previous_through]).toEqual([2026, THROUGH, "2025-06-30"]);
    const ytd = s.started.ytd;
    // 900 + 600 + 500 + 700 + 50; last year 300 + 2000 (not July's 5000)
    expect([ytd.value, ytd.count]).toEqual([2750, 5]);
    expect([ytd.previous_value, ytd.previous_count]).toEqual([2300, 2]);
    expect(ytd.largest).toEqual({
      id: f.amended.id,
      reference: `${f.fisheries.id}-2026-05-01-${f.alder.id}`,
      value: 900,
      year_value: 900,
      recipient_id: f.alder.id,
      recipient_name: "Alder Society",
      recipient_is_placeholder: false,
    });
  });

  it("counts by fiscal year in a window of ten", async () => {
    const byYear = Object.fromEntries(
      (await summary()).started.by_year.map((row: any) => [row.fiscal_year, row]),
    );
    // From the first year with awards (FY2020) to this one, gaps filled
    expect(Object.keys(byYear).map(Number)).toEqual([2020, 2021, 2022, 2023, 2024, 2025, 2026]);
    expect(byYear[2021].count).toBe(0);
    expect(byYear[2025].value).toBe(7300);
    expect([byYear[2026].count, byYear[2026].largest_value]).toEqual([5, 900]);
    expect(byYear[2004]).toBeUndefined();
  });

  it("narrows to a ministry, program or recipient", async () => {
    const cases: [Parameters<typeof summary>[1], number][] = [
      [{ ministry: f.fisheries }, 900 + 600 + 500],
      [{ ministry: f.fisheries, program: f.science }, 900 + 600],
      [{ recipient: f.alder }, 900 + 600],
      [{ recipient: f.birch }, 500],
    ];
    for (const [parts, value] of cases) {
      expect((await summary(f.federal, parts)).started.ytd.value).toBe(value);
    }
  });

  it("takes a leap day back to the 28th", async () => {
    const s = await summary(f.federal, {}, "2028-03-05", { through: "2028-02-29" });
    expect(s.previous_through).toBe("2027-02-28");
  });
});

describe("dataThrough", () => {
  it("runs to the last usual month", async () => {
    // Both governments' data, as it is, runs to June
    for (const organization of [f.federal, f.alberta]) {
      expect(await dataThrough(awardsOf(organization), TODAY)).toBe(THROUGH);
      expect((await summary(organization)).through).toBe(THROUGH);
    }
    // Four awards a month to June 2026; later, a straggler in August
    for (const year of [2025, 2026]) {
      for (let month = 1; month <= 12; month++) {
        if (year < 2026 || month <= 6) {
          for (let i = 0; i < 4; i++) {
            await agreement(f.health, f.birch, `${year}-${String(month).padStart(2, "0")}-10`, 1);
          }
        }
      }
    }
    await agreement(f.health, f.birch, "2026-08-03", 1);
    expect(await dataThrough(awardsOf(f.federal), TODAY)).toBe(THROUGH);
    // A usual month this month: to today
    for (let i = 0; i < 4; i++) await agreement(f.health, f.birch, "2026-10-01", 1);
    expect(await dataThrough(awardsOf(f.federal), TODAY)).toBe(TODAY);
  });

  it("runs to today without data", async () => {
    expect(await dataThrough(sql`FALSE`, TODAY)).toBe(TODAY);
  });

  it("leaves out undated awards", async () => {
    // Alberta's yearly totals sit on April 1st: counted, the new fiscal year's first month would
    // seem to have data before any is published
    expect(await dataThrough(awardsOf(f.alberta), "2026-04-20")).toBe("2025-05-31");
  });
});

describe("what's new", () => {
  it("lists the latest awards to have started", async () => {
    const latest = (await summary()).latest;
    expect(latest.map((award: any) => award.start_date)).toEqual([
      "2026-06-25",
      "2026-06-20",
      "2026-06-15",
      "2026-05-01",
      "2026-04-01",
    ]);
    const { rows } = await getPool().query("SELECT id FROM award WHERE recipient_id = $1", [
      f.cedar.id,
    ]);
    expect(latest[1]).toEqual({
      id: rows[0].id,
      reference: `${f.health.id}-2026-06-20-${f.cedar.id}`,
      start_date: "2026-06-20",
      value: 700,
      agreement_type: "C",
      recipient_id: f.cedar.id,
      recipient_name: "Cedar Institute",
      recipient_is_placeholder: false,
      ministry_id: f.health.id,
      ministry_name: "Health Canada",
    });
  });

  it("lists them to today, past where the data runs", async () => {
    // A straggler: the first of the data still to come. Not yet in the year to date
    await agreement(f.fisheries, f.cedar, "2026-08-01", 40);
    const s = await summary(f.federal, {}, TODAY, { through: THROUGH });
    expect(s.latest[0].start_date).toBe("2026-08-01");
    expect(s.started.ytd.value).toBe(2750);
  });

  it("finds the latest of a ministry that stopped funding", async () => {
    const closed = await insert("ministry", {
      organization_id: f.federal.id,
      name: "Closed Agency Canada",
    });
    const agreements: Id[] = [];
    for (let year = 0; year < 7; year++)
      agreements.push(await agreement(closed, f.cedar, `201${year}-05-01`, 10));
    await refreshRollup();
    const latest = (await summary(f.federal, { ministry: closed })).latest;
    expect(latest.map((a: any) => a.id)).toEqual(
      agreements
        .reverse()
        .slice(0, 5)
        .map((a) => a.id),
    );
  });

  it("says what the last import brought", async () => {
    // Every current agreement: the Government of Canada publishes one file
    expect((await summary()).last_import).toEqual({
      date: IMPORTED,
      count: 11,
      value: 18_011_050,
      files: 1,
    });
    // Alberta's files for 2025-26 and 2026-27, not the earlier one for 2024-25
    expect((await summary(f.alberta)).last_import).toEqual({
      date: IMPORTED,
      count: 5,
      value: 1_800_950,
      files: 2,
    });
    expect((await summary(f.alberta, { ministry: f.culture })).last_import.files).toBe(2);
    await getPool().query("UPDATE award SET import_date = NULL");
    clearCache();
    expect((await summary()).last_import).toBeNull();
  });

  it("names the recipients new this year", async () => {
    const fresh = (await summary()).started.new;
    expect(fresh.count).toBe(1);
    expect(fresh.top).toEqual([
      {
        id: f.cedar.id,
        name: "Cedar Institute",
        first_start_date: "2026-06-20",
        count: 1,
        value: 700,
      },
    ]);
    // Birch is new to Fisheries, though not to the organization
    const fisheries = (await summary(f.federal, { ministry: f.fisheries })).started.new;
    expect(fisheries.top.map((r: any) => r.name)).toEqual(["Birch Foundation"]);
  });

  it("names a recipient's first ministries", async () => {
    const s = await summary(f.federal, { recipient: f.birch });
    expect([s.scope, s.counterpart]).toEqual(["recipient", "ministry"]);
    expect(s.started.new.top.map((m: any) => m.name)).toEqual(["Fisheries and Oceans Canada"]);
  });
});

describe("movers", () => {
  it("ranks this year's recipients with last year's figures", async () => {
    const movers = (await summary()).started.movers;
    expect(
      movers.map((m: any) => [m.name, m.value, m.count, m.previous_value, m.previous_count]),
    ).toEqual([
      ["Alder Society", 1500, 2, 300, 1],
      ["Cedar Institute", 700, 1, 0, 0],
      ["Birch Foundation", 500, 1, 2000, 1],
    ]);
  });

  it("ranks a recipient's ministries", async () => {
    const movers = (await summary(f.federal, { recipient: f.alder })).started.movers;
    expect(movers.map((m: any) => [m.name, m.value])).toEqual([
      ["Fisheries and Oceans Canada", 1500],
    ]);
  });
});

describe("placeholders", () => {
  it("are left out of new and movers", async () => {
    const s = await summary();
    for (const basis of ["started", "annualized"]) {
      const figures = s[basis];
      const names = [
        ...figures.movers.map((m: any) => m.name),
        ...figures.new.top.map((n: any) => n.name),
      ];
      expect(names).not.toContain(WITHHELD_INDIVIDUAL);
      // Cedar only: the withheld individual's first award is this year's too
      expect(figures.new.count).toBe(1);
    }
  });

  it("have their awards among the latest", async () => {
    const latest = (await summary()).latest[0];
    expect([latest.recipient_id, latest.recipient_name, latest.recipient_is_placeholder]).toEqual([
      f.withheld.id,
      WITHHELD_INDIVIDUAL,
      true,
    ]);
    // And their value in the year to date
    expect((await summary(f.federal, { ministry: f.health })).started.ytd.value).toBe(750);
  });
});

describe("superseded amendments", () => {
  it("are never counted", async () => {
    const s = await summary();
    expect(s.started.ytd.largest.id).toBe(f.amended.id);
    expect(s.latest.filter((a: any) => a.start_date === "2026-05-01")).toHaveLength(1);
    // The same summary without it, on either basis
    await getPool().query("DELETE FROM award WHERE id = $1", [f.superseded.id]);
    clearCache();
    expect(await summary()).toEqual(s);
  });
});

describe("undated awards", () => {
  it("are left out of the year to date", async () => {
    const ytd = (await summary(f.alberta)).started.ytd;
    expect([ytd.value, ytd.count, ytd.previous_value, ytd.previous_count]).toEqual([
      650, 2, 300, 1,
    ]);
    expect([ytd.largest.recipient_name, ytd.largest.value]).toEqual(["Alder Society", 400]);
  });

  it("count in their fiscal years", async () => {
    const byYear = (await summary(f.alberta)).started.by_year;
    expect(byYear.map((r: any) => [r.fiscal_year, r.value, r.count, r.largest_value])).toEqual([
      [2024, 100, 1, 100],
      [2025, 800_300, 2, 800_000],
      [2026, 1_000_650, 3, 1_000_000],
    ]);
  });

  it("are reported as left out", async () => {
    const expected = { value: 1_000_000, count: 1, previous_value: 800_000, previous_count: 1 };
    expect((await summary(f.alberta)).undated).toEqual(expected);
    expect((await summary(f.alberta, { ministry: f.abHealth })).undated).toEqual(expected);
    expect((await summary(f.alberta, { ministry: f.culture })).undated).toBeNull();
    expect((await summary()).undated).toBeNull();
  });

  it("are left out of the latest and the movers", async () => {
    expect((await summary(f.alberta)).latest.map((a: any) => a.start_date)).toEqual([
      "2026-06-12",
      "2026-05-10",
      "2025-05-12",
      "2024-05-01",
    ]);
    // The undisclosed recipient's page: its ministry gave it nothing dated this year
    const s = await summary(f.alberta, { recipient: f.undisclosed });
    expect(s.started.ytd.value).toBe(0);
    expect([s.started.movers, s.started.new.count]).toEqual([[], 0]);
    expect(s.started.by_year.at(-1).value).toBe(1_000_000);
  });

  it("leave a named recipient's out of its figures this year", async () => {
    await payment(f.culture, f.alder, "2026-04-01", 5000, { undated: true });
    const s = await summary(f.alberta);
    const movers = Object.fromEntries(s.started.movers.map((m: any) => [m.name, m.value]));
    expect(movers["Alder Society"]).toBe(400);
    expect(s.undated.value).toBe(1_005_000);
  });

  it("leave an undated agreement out of either year to date", async () => {
    const undated = await agreement(f.health, f.cedar, "2026-04-01", 3650, { end: "2027-03-31" });
    await getPool().query("UPDATE award SET start_date_estimated = TRUE WHERE id = $1", [
      undated.id,
    ]);
    const s = await summary();
    expect(s.undated).toEqual({ value: 3650, count: 1, previous_value: 0, previous_count: 0 });
    for (const [basis, ytd, year] of [
      ["started", 2750, 2750 + 3650],
      ["annualized", 2750, 2750 + 910],
    ] as const) {
      const figures = s[basis];
      expect(figures.ytd.value).toBeCloseTo(ytd);
      expect(figures.by_year.at(-1).value).toBeCloseTo(year);
      expect(figures.ytd.largest.id).toBe(f.amended.id);
      expect(
        Object.fromEntries(figures.movers.map((m: any) => [m.name, m.value]))["Cedar Institute"],
      ).toBe(700);
    }
  });
});

describe("payments", () => {
  it("count on their day", async () => {
    const s = await summary(f.alberta);
    expect(s.annualized).toEqual(s.started);
    const largest = s.annualized.ytd.largest;
    expect(largest.year_value).toBe(largest.value);
    expect(s.started.movers.map((m: any) => m.name)).toEqual(["Alder Society", "Birch Foundation"]);
    expect(s.started.new.top.map((n: any) => n.name)).toEqual(["Birch Foundation"]);
  });

  it("have no made-up references", async () => {
    const s = await summary(f.alberta);
    expect(s.started.ytd.largest.reference).toBeNull();
    expect(new Set(s.latest.map((a: any) => a.reference))).toEqual(new Set([null]));
  });
});

describe("the mix", () => {
  it("groups agreements by type", async () => {
    const mix = (await summary()).mix;
    expect(mix.groups).toEqual([
      { key: "G", label: "Grant" },
      { key: "C", label: "Contribution" },
    ]);
    const thisYear = Object.fromEntries(
      mix.by_year
        .filter((r: any) => r.fiscal_year === 2026)
        .map((r: any) => [r.group, [r.count, r.value]]),
    );
    expect(thisYear).toEqual({ C: [4, 2250], G: [1, 500] });
  });

  it("drops blank and unknown types", async () => {
    await agreement(f.health, f.cedar, "2026-05-20", 70, { kind: null });
    await agreement(f.health, f.cedar, "2026-05-21", 80, { kind: "" });
    await agreement(f.health, f.cedar, "2026-05-22", 90, { kind: "X" });
    const groups = new Set((await summary()).mix.by_year.map((r: any) => r.group));
    expect(groups).toEqual(new Set(["C", "G"]));
    // A single type besides them is nothing to compare
    await getPool().query("UPDATE award SET agreement_type = 'C' WHERE agreement_type = 'G'");
    clearCache();
    expect((await summary()).mix).toBeNull();
  });

  it("is null for payments", async () => {
    expect((await summary(f.alberta)).mix).toBeNull();
  });
});

describe("annualized values", () => {
  // 730 days by default: $10 a day
  const addTerm = (
    start = "2024-10-01",
    end = "2026-09-30",
    value = 7300,
    recipient: Id = f.alder,
  ) => agreement(f.health, recipient, start, value, { end });

  it("spread an agreement over its term by day", async () => {
    await addTerm();
    const byYear = Object.fromEntries(
      (await summary()).annualized.by_year.map((r: any) => [r.fiscal_year, r]),
    );
    // Oct 1 to Mar 31 (182 days); all of FY2025; Apr 1 to June 30 (91); beside the agreements
    // that started in each
    expect(byYear[2024].value).toBeCloseTo(1820);
    expect(byYear[2025].value).toBeCloseTo(3650 + 7300);
    expect(byYear[2026].value).toBeCloseTo(910 + 2750);
    // Running in each year
    expect([2024, 2025, 2026].map((year) => byYear[year].count)).toEqual([1, 4, 6]);
  });

  it("compare this year to date with the same point last year", async () => {
    await addTerm();
    const ytd = (await summary()).annualized.ytd;
    expect(ytd.value).toBeCloseTo(910 + 2750);
    expect(ytd.previous_value).toBeCloseTo(910 + 2300);
    expect([ytd.count, ytd.previous_count]).toEqual([6, 3]);
    // The largest part this year, of an agreement worth more
    expect([ytd.largest.value, Math.round(ytd.largest.year_value)]).toEqual([7300, 910]);
  });

  it("keep agreements without a known term on their start", async () => {
    // Ending before it started, or 9999-12-31 for no end at all
    await addTerm("2025-05-01", "2025-04-01", 1000);
    await addTerm("2025-05-01", "9999-12-31", 1000);
    const byYear = Object.fromEntries(
      (await summary()).annualized.by_year.map((r: any) => [r.fiscal_year, r]),
    );
    expect(byYear[2025].value).toBeCloseTo(7300 + 2000);
  });

  it("rank recipients by their spread values", async () => {
    await addTerm();
    const spread = (await summary()).annualized;
    expect(
      spread.movers.map((m: any) => [
        m.name,
        Math.round(m.value),
        Math.round(m.previous_value),
        m.count,
      ]),
    ).toEqual([
      ["Alder Society", 2410, 1210, 3],
      ["Cedar Institute", 700, 0, 1],
      ["Birch Foundation", 500, 2000, 1],
    ]);
    // New this year either way
    expect(spread.new.count).toBe(1);
  });

  it("count recipients' running agreements from before", async () => {
    // Delta's only agreement started last year and runs on: $1 a day
    const delta = await insert("recipient", { name: "DELTA TRUST", display_name: "Delta Trust" });
    await addTerm("2025-07-01", "2026-06-30", 365, delta);
    const s = await summary();
    const movers = Object.fromEntries(s.annualized.movers.map((m: any) => [m.name, m]));
    expect(movers["Delta Trust"].value).toBeCloseTo(91);
    expect(s.started.movers.map((m: any) => m.name)).not.toContain("Delta Trust");
    expect(s.annualized.new.top.map((n: any) => n.name)).not.toContain("Delta Trust");
  });
});

describe("the summary API", () => {
  const url = (rest = "", organization: Id = f.federal) =>
    `/api/organization/${organization.id}/${rest}summary`;
  const get = async (path: string, today = TODAY) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(`${today}T18:00:00Z`));
    try {
      return await call("GET", path);
    } finally {
      vi.useRealTimers();
    }
  };

  it("serves each scope", async () => {
    const keys = [
      "scope",
      "counterpart",
      "today",
      "fiscal_year",
      "through",
      "previous_through",
      "started",
      "annualized",
      "undated",
      "latest",
      "last_import",
      "mix",
    ];
    for (const [path, scope] of [
      [url(), "organization"],
      [url(`ministry/${f.fisheries.id}/`), "ministry"],
      [url(`ministry/${f.fisheries.id}/program/${f.science.id}/`), "program"],
      [url(`recipient/${f.alder.id}/`), "recipient"],
      [url("", f.alberta), "organization"],
    ] as const) {
      const response = await get(path);
      expect(response.status, path).toBe(200);
      const body = await response.json();
      expect(body.scope).toBe(scope);
      expect(new Set(Object.keys(body))).toEqual(new Set(keys));
      for (const basis of ["started", "annualized"]) {
        expect(new Set(Object.keys(body[basis]))).toEqual(
          new Set(["ytd", "by_year", "new", "movers"]),
        );
      }
    }
  });

  it("isn't there for what isn't", async () => {
    for (const path of [
      "/api/organization/999999/summary",
      url("ministry/999999/"),
      // Another organization's ministry, another ministry's program
      url(`ministry/${f.culture.id}/`),
      url(`ministry/${f.health.id}/program/${f.science.id}/`),
      url(`ministry/${f.fisheries.id}/program/999999/`),
      url("recipient/999999/"),
      // A recipient only the Government of Canada funds
      url(`recipient/${f.cedar.id}/`, f.alberta),
    ]) {
      expect((await get(path)).status, path).toBe(404);
    }
  });

  it("is built again after an import, not before", async () => {
    const before = (await (await get(url())).json()).started.ytd.value;
    await agreement(f.health, f.cedar, "2026-05-05", 1000);
    expect((await (await get(url())).json()).started.ytd.value).toBe(before);
    // Imports bump the data version once they're done
    await bumpDataVersion();
    expect((await (await get(url())).json()).started.ytd.value).toBe(before + 1000);
  });

  it("is the same however the path is written", async () => {
    const first = await (await get(url())).json();
    const second = await (await get(`/api/organization/0${f.federal.id}/summary`)).json();
    expect(second).toEqual(first);
  });

  it("needs sign-in", async () => {
    expect((await get(url())).status).toBe(200);
    signedIn = false;
    expect((await get(url())).status).toBe(401);
  });
});
