import { describe, expect, it } from "vitest";

import { summary } from "@/test/fixtures";

import { pivotMix, share, watchedShare } from "./mix";
import { period } from "./period";

// Agreements by type, as a federal summary has them (out of order)
const mix = {
  groups: [
    { key: "G", label: "Grant" },
    { key: "C", label: "Contribution" },
    { key: "O", label: "Other transfer payment" },
  ],
  by_year: [
    { fiscal_year: 2026, group: "G", count: 350, value: 50 },
    { fiscal_year: 2025, group: "C", count: 2200, value: 300 },
    { fiscal_year: 2025, group: "G", count: 1800, value: 200 },
    { fiscal_year: 2026, group: "C", count: 586, value: 100 },
    { fiscal_year: 2026, group: "O", count: 14, value: 7 },
  ],
};

describe("the agreement mix", () => {
  it("makes a row of each year, oldest first", () => {
    expect(pivotMix(mix)).toEqual([
      {
        fiscal_year: 2025,
        total: 4000,
        counts: { C: 2200, G: 1800 },
        values: { C: 300, G: 200 },
      },
      {
        fiscal_year: 2026,
        total: 950,
        counts: { G: 350, C: 586, O: 14 },
        values: { G: 50, C: 100, O: 7 },
      },
    ]);
  });

  it("adds up a type's rows within a year", () => {
    const [year] = pivotMix({
      ...mix,
      by_year: [
        { fiscal_year: 2025, group: "G", count: 2, value: 10 },
        { fiscal_year: 2025, group: "G", count: 3, value: 5 },
      ],
    });
    expect(year).toMatchObject({
      total: 5,
      counts: { G: 5 },
      values: { G: 15 },
    });
  });

  it("gives a type's share of a year", () => {
    const [before, current] = pivotMix(mix);
    expect(share(current, "G")).toBeCloseTo(350 / 950);
    // None of a type that year
    expect(share(before, "O")).toBe(0);
    // No agreements that year
    expect(share(undefined, "G")).toBeNull();
    expect(share({ fiscal_year: 2027, total: 0, counts: {}, values: {} }, "G")).toBeNull();
  });

  it("follows grants, this year and last", () => {
    expect(watchedShare(mix, 2026)).toEqual({
      label: "Grant",
      now: 350 / 950,
      before: 1800 / 4000,
    });
    // Nothing the year before
    expect(watchedShare(mix, 2025)?.before).toBeNull();
    // Nothing this year, or no grants to follow
    expect(watchedShare(mix, 2027)).toBeNull();
    expect(watchedShare({ ...mix, groups: mix.groups.slice(1) }, 2026)).toBeNull();
  });
});

describe("a summary's period", () => {
  it("is this year, so far, while the year runs", () => {
    expect(period(summary())).toEqual({
      complete: false,
      partial: 2026,
      thisYear: "this year",
      soFar: "so far this year",
      span: "FY2026 to 2026-06-30",
      against: "the same point in FY2025",
    });
  });

  it("is the year by its name once its data runs to March 31", () => {
    // Published a quarter late, say: the year is over
    expect(
      period(
        summary({
          fiscal_year: 2025,
          through: "2026-03-31",
          previous_through: "2025-03-31",
        }),
      ),
    ).toEqual({
      complete: true,
      partial: undefined,
      thisYear: "in FY2025",
      soFar: "in FY2025",
      span: "FY2025",
      against: "FY2024",
    });
  });

  it("is still running on any other day of its last month", () => {
    expect(period(summary({ fiscal_year: 2025, through: "2026-03-30" }))).toMatchObject({
      complete: false,
      span: "FY2025 to 2026-03-30",
    });
  });
});
