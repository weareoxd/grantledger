import { describe, expect, it } from "vitest";
import { CsvRecordReader } from "@/lib/grants/importers/csv";
import {
  clean,
  parseBool,
  parseDate,
  parseDecimal,
  parseIntLoose,
} from "@/lib/grants/importers/parse";

describe("parse helpers", () => {
  it("cleans whitespace and wrapping quotes", () => {
    expect(clean('  "Example"  ')).toBe("Example");
    expect(clean("  ")).toBeNull();
    expect(clean(null)).toBeNull();
  });

  it("parses money to cents, half-even", () => {
    expect(parseDecimal("2500.000")).toBe("2500.00");
    expect(parseDecimal("$1,036,000.005")).toBe("1036000.00");
    expect(parseDecimal("0.015")).toBe("0.02");
    expect(parseDecimal("-500")).toBe("-500.00");
    expect(parseDecimal(".5")).toBe("0.50");
    expect(parseDecimal("1e3")).toBe("1000.00");
    expect(parseDecimal("abc")).toBeNull();
    expect(parseDecimal("")).toBeNull();
  });

  it("parses the four date formats and drops zero dates", () => {
    expect(parseDate("2024-04-02")).toBe("2024-04-02");
    expect(parseDate("4/2/2026 12:00:00 AM")).toBe("2026-04-02");
    expect(parseDate("04/02/2026")).toBe("2026-04-02");
    expect(parseDate("2024-04-02 13:05:00")).toBe("2024-04-02");
    expect(parseDate("2024-02-30")).toBeNull();
    expect(parseDate("1899-12-30")).toBeNull();
    expect(parseDate("nonsense")).toBeNull();
  });

  it("parses booleans and loose integers", () => {
    expect(parseBool("TRUE")).toBe(true);
    expect(parseBool("False")).toBe(false);
    expect(parseBool("")).toBeNull();
    expect(parseIntLoose("1.0")).toBe(1);
    expect(parseIntLoose("x")).toBe(0);
  });
});

describe("CsvRecordReader", () => {
  const read = (...lines: string[]) => {
    const reader = new CsvRecordReader();
    const out: string[][] = [];
    for (const line of lines) {
      const record = reader.feed(line);
      if (record) out.push(record);
    }
    const rest = reader.finish();
    if (rest) out.push(rest);
    return out;
  };

  it("reads quoted fields, doubled quotes and CRLF", () => {
    expect(read('a,"b, c","d ""e"""\r\n')).toEqual([["a", "b, c", 'd "e"']]);
  });

  it("joins quoted fields across lines", () => {
    expect(read('a,"first\n', 'second",c\n')).toEqual([["a", "first\nsecond", "c"]]);
  });

  it("keeps characters after a closing quote, as non-strict Python does", () => {
    expect(read('"ab"cd,e\n')).toEqual([["abcd", "e"]]);
  });

  it("returns empty records for blank lines", () => {
    expect(read("\n", "a\n")).toEqual([[], ["a"]]);
  });
});
