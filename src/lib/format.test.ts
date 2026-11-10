import { describe, expect, it } from "vitest";

import {
  fiscalYearOf,
  formatAxisCurrency,
  formatChange,
  formatCount,
  formatCurrency,
  formatDate,
  formatDateOnly,
  formatMultiple,
  formatNumber,
  formatPercent,
  formatRoundedCurrency,
  parseDateOnly,
  percentChange,
} from "./format";

describe("formatRoundedCurrency", () => {
  it.each([
    [null, "–"],
    [0, "–"],
    ["0.00", "–"],
    [9999.5, "$9,999.50"],
    ["1234.56", "$1,234.56"],
    [12_345, "$12K"],
    [999_499, "$999K"],
    // Rounded up into the next unit, not "$1,000K"
    [999_600, "$1.00M"],
    [999_995_000, "$1.00B"],
    [-999_600, "-$1.00M"],
    [1_234_567, "$1.23M"],
    [4_560_000_000, "$4.56B"],
    [2e12, "$2.00T"],
    [-25_000, "-$25K"],
  ])("%s -> %s", (value, expected) => {
    expect(formatRoundedCurrency(value)).toBe(expected);
  });
});

describe("formatCurrency", () => {
  it("shows cents and accounting negatives", () => {
    expect(formatCurrency(1234.5)).toBe("$1,234.50");
    expect(formatCurrency("-12")).toBe("($12.00)");
    expect(formatCurrency(null)).toBe("–");
  });
});

describe("formatNumber", () => {
  it("groups digits", () => {
    expect(formatNumber(1_204_877)).toBe("1,204,877");
    expect(formatNumber(null)).toBe("0");
  });
});

describe("dates", () => {
  it("parses API dates without shifting the day", () => {
    const date = parseDateOnly("2024-04-01")!;
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2024, 3, 1]);
    expect(formatDateOnly(date)).toBe("2024-04-01");
  });

  it("rejects malformed dates", () => {
    expect(parseDateOnly("2024-13-40")).toBeNull();
    expect(parseDateOnly("")).toBeNull();
    expect(formatDate(null)).toBe("–");
    expect(formatDate("2024-05-01")).toBe("2024-05-01");
  });

  it("assigns April-March fiscal years", () => {
    expect(fiscalYearOf(new Date(2025, 2, 31))).toBe(2024);
    expect(fiscalYearOf(new Date(2025, 3, 1))).toBe(2025);
  });
});

describe("changes", () => {
  it("compares with what came before, if anything did", () => {
    expect(percentChange(112, 100)).toBeCloseTo(0.12);
    expect(percentChange(50, 100)).toBe(-0.5);
    expect(percentChange(5, 0)).toBeNull();
    expect(percentChange(5, -10)).toBeNull();
  });

  it.each([
    [0.123, "up 12%"],
    [-0.08, "down 8%"],
    [0.004, "unchanged"],
    [-0.004, "unchanged"],
    [8.4, "up 840%"],
    [33.28, "up 34×"],
    [15_107, "up >100×"],
  ])("%s -> %s", (change, expected) => {
    expect(formatChange(change)).toBe(expected);
  });

  it("puts rises of ten times or more as multiples", () => {
    expect(formatMultiple(8.4)).toBeNull();
    expect(formatMultiple(9)).toBe("10×");
    expect(formatMultiple(99)).toBe("100×");
    expect(formatMultiple(100)).toBe(">100×");
  });
});

describe("shares and counts", () => {
  it("rounds to whole percents", () => {
    expect(formatPercent(0.364)).toBe("36%");
    expect(formatPercent(15.1)).toBe("1,510%");
    expect(formatPercent(0)).toBe("0%");
  });

  it("counts things", () => {
    expect(formatCount(1, "agreement")).toBe("1 agreement");
    expect(formatCount(0, "payment")).toBe("0 payments");
    expect(formatCount(2000, "ministry", "ministries")).toBe("2,000 ministries");
  });

  it("keeps a chart's axis short", () => {
    expect([0, 75e6, 1.5e9, 105e9, 8500].map((amount) => formatAxisCurrency(amount))).toEqual([
      "$0",
      "$75M",
      "$1.5B",
      "$105B",
      "$8.5K",
    ]);
  });
});
