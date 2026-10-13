/**
 * The April-March fiscal year both governments use: FY2024 = Apr 1 2024 - Mar 31 2025. An award's
 * fiscal year comes from its start date (a month before April belongs to the previous year).
 *
 * Dates are ISO strings ("2024-04-01") throughout: the driver returns `date` columns that way
 * (src/lib/db/index.ts), so nothing shifts across time zones.
 */
import { type SQL, sql } from "drizzle-orm";

export const FISCAL_YEAR_START_MONTH = 4;

export function fiscalYearOf(isoDate: string): number {
  const year = Number(isoDate.slice(0, 4));
  const month = Number(isoDate.slice(5, 7));
  return month < FISCAL_YEAR_START_MONTH ? year - 1 : year;
}

/** [start, end] of a fiscal year as ISO dates: 2024 -> 2024-04-01 .. 2025-03-31. */
export function fiscalYearBounds(year: number): [string, string] {
  return [isoDate(year, 4, 1), isoDate(year + 1, 3, 31)];
}

export function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "FY2024-25", as exports and the UI label a fiscal year. */
export function fiscalYearLabel(year: number): string {
  return `FY${year}-${String((year + 1) % 100).padStart(2, "0")}`;
}

/** SQL deriving the fiscal year (an integer) from a date column or expression. */
export function fiscalYearSql(column: SQL | string): SQL {
  const col = typeof column === "string" ? sql.raw(column) : column;
  return sql`(CASE WHEN EXTRACT(MONTH FROM ${col}) < ${sql.raw(String(FISCAL_YEAR_START_MONTH))} THEN EXTRACT(YEAR FROM ${col})::int - 1 ELSE EXTRACT(YEAR FROM ${col})::int END)`;
}

/** Today's date in the app's time zone (TZ), as an ISO date. */
export function todayLocal(timeZone = process.env.TZ || "America/Edmonton"): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** Add days to an ISO date. */
export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}
