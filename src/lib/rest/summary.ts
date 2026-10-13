/**
 * What an organization's, ministry's, program's or recipient's overview page shows of it: its
 * awards' value over time, what's new, who moved most this year and, for agreements, how the
 * value splits between grants, contributions and other transfer payments.
 *
 * "This year" is the fiscal year to date, compared with the same span of the year before. It runs
 * to where the organization's data does: data is published months late, and a year compared to
 * today would seem to fall.
 *
 * Values are given two ways: by the year awards started in ("started"), and spread over their
 * terms ("annualized", see below). Payments have no term, so for a payment organization the two
 * are the same.
 *
 * Some awards are published without a date (Alberta's yearly totals, such as physicians' fees),
 * and the importer dates them the fiscal year's first day. They count in the fiscal years'
 * figures, but not in the year to date (then or a year before), the largest or latest awards, or
 * who's new or moved: on its first day, the whole of a year's total would fall in any part of the
 * year. The summary reports what it left out (`undated`).
 */
import { type SQL, sql } from "drizzle-orm";
import { getEnv } from "@/lib/env";
import { AGREEMENT_TYPES } from "@/lib/grants/constants";
import { fiscalYearOf, fiscalYearSql, isoDate, todayLocal } from "@/lib/grants/fiscal";
import { cached } from "@/lib/server/cache";
import { limited, one, rows } from "./db";
import { amount, type Scope, scopeIds, scopeKind } from "./lists";

// The response's shape: bump with any change to it, so summaries cached before a deploy aren't
// served after it
const SHAPE = 1;

// Fiscal years shown: this one and the nine before it
const YEARS = 10;
const LATEST = 5;
const NEW = 5;
const MOVERS = 10;

// ---------------------------------------------------------------------------
// Annualized values: agreements' value spread over their terms. Each day from an agreement's
// start date to its end date gets an even part of its value, so a fiscal year (or any span) gets
// the part of its days in it. An agreement whose term isn't known (no end date, one before the
// start, or one centuries on: 9999-12-31 stands in for an open end) keeps its whole value on its
// start day. Exact: an agreement's parts add up to its value.
// ---------------------------------------------------------------------------

// Longer than this, a term is a typo or a stand-in. The longest real ones run 35 years
const LONGEST_TERM = 50 * 366;

const daysBetween = (start: SQL, end: SQL) => sql`(CAST(${end} AS date) - CAST(${start} AS date))`;

/** The last day of an award's term: its end date, or its start if the term isn't known. */
const TERM_END = sql`(CASE WHEN ${daysBetween(sql.raw("a.start_date"), sql.raw("a.end_date"))} BETWEEN 0 AND ${sql.raw(String(LONGEST_TERM))} THEN a.end_date ELSE a.start_date END)`;

/** The days of an award's term from `first` to `last`, inclusive. */
function daysIn(first: string, last: string): SQL {
  return sql`GREATEST(${daysBetween(sql`GREATEST(a.start_date, ${first}::date)`, sql`LEAST(${TERM_END}, ${last}::date)`)} + 1, 0)`;
}

/** The part of an award's value from `first` to `last`, inclusive. */
function valueIn(first: string, last: string): SQL {
  const term = sql`(${daysBetween(sql.raw("a.start_date"), TERM_END)} + 1)`;
  return sql`(CAST(a.value AS double precision) * ${daysIn(first, last)} / ${term})`;
}

/** Awards that may run from `first` to `last` (a superset: their daysIn the span says). */
function running(first: string, last: string): SQL {
  return sql`(a.start_date <= ${last}::date AND (a.start_date >= ${first}::date OR a.end_date >= ${first}::date))`;
}

/**
 * Aggregates for a span: its awards' value in it, the awards running in it, and the largest part
 * of one award's value; of all the awards, or only `whereSql`'s.
 */
function spanTotals(first: string, last: string, whereSql?: SQL): [SQL, SQL, SQL] {
  const candidates = whereSql ? sql`${running(first, last)} AND ${whereSql}` : running(first, last);
  return [
    sql`SUM(${valueIn(first, last)}) FILTER (WHERE ${candidates})`,
    sql`COUNT(a.id) FILTER (WHERE ${candidates} AND ${daysIn(first, last)} > 0)`,
    sql`MAX(${valueIn(first, last)}) FILTER (WHERE ${candidates})`,
  ];
}

// ---------------------------------------------------------------------------

const DATED = sql.raw("NOT a.start_date_estimated");

function aYearBefore(iso: string): string {
  const year = Number(iso.slice(0, 4)) - 1;
  const month = Number(iso.slice(5, 7));
  let day = Number(iso.slice(8, 10));
  // February 29th: the 28th
  if (month === 2 && day === 29) day = 28;
  return isoDate(year, month, day);
}

function lastDayOfMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** The current awards of a scope: its organization's, narrowed to its ministry, program or recipient. */
function scopeAwards(scope: Scope): SQL {
  const conditions: SQL[] = [
    sql`m.organization_id = ${(scope.organization as { id: number }).id}`,
    sql.raw("a.is_current"),
  ];
  if (scope.ministry) conditions.push(sql`a.ministry_id = ${scope.ministry.id}`);
  if (scope.program) conditions.push(sql`a.program_id = ${scope.program.id}`);
  if (scope.recipient) conditions.push(sql`a.recipient_id = ${scope.recipient.id}`);
  return sql.join(conditions, sql` AND `);
}

const FROM_AWARDS = sql.raw("award a JOIN ministry m ON m.id = a.ministry_id");

function scopeRollup(scope: Scope): SQL {
  const conditions: SQL[] = [
    sql`ru.organization_id = ${(scope.organization as { id: number }).id}`,
  ];
  if (scope.ministry) conditions.push(sql`ru.ministry_id = ${scope.ministry.id}`);
  if (scope.program) conditions.push(sql`ru.program_id = ${scope.program.id}`);
  if (scope.recipient) conditions.push(sql`ru.recipient_id = ${scope.recipient.id}`);
  return sql.join(conditions, sql` AND `);
}

/** What a scope's summary is of: its narrowest part. */
function level(scope: Scope) {
  if (scope.recipient) return "recipient";
  if (scope.program) return "program";
  if (scope.ministry) return "ministry";
  return "organization";
}

/**
 * The day an organization's data runs to: the end of its latest month with as many dated awards
 * as a usual one (at least half the median month of the last two years), or today if that's this
 * month. A few awards are dated later: the first of data still to come.
 */
export async function dataThrough(awards: SQL, today: string): Promise<string> {
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  const months = await rows<{ month: string; awards: number }>(
    sql`SELECT to_char(date_trunc('month', a.start_date), 'YYYY-MM-DD') AS month, COUNT(a.id)::int AS awards
          FROM ${FROM_AWARDS}
         WHERE ${awards} AND ${DATED} AND a.start_date >= ${isoDate(year - 2, month, 1)}::date AND a.start_date <= ${today}::date
         GROUP BY 1`,
  );
  if (!months.length) return today;
  const counts = months.map((row) => row.awards).sort((a, b) => a - b);
  const usual = counts[Math.floor(counts.length / 2)] as number;
  const latest = months
    .filter((row) => row.awards * 2 >= usual)
    .map((row) => row.month)
    .sort()
    .at(-1) as string;
  const latestYear = Number(latest.slice(0, 4));
  const latestMonth = Number(latest.slice(5, 7));
  if (latestYear === year && latestMonth === month) return today;
  return isoDate(latestYear, latestMonth, lastDayOfMonth(latestYear, latestMonth));
}

/** dataThrough of an organization's current awards: the same on each of its pages, so cached on its own for the day. */
function through(organizationId: number, today: string) {
  return cached("summary-through", `${organizationId}#${today}`, () =>
    dataThrough(sql`m.organization_id = ${organizationId} AND a.is_current`, today),
  );
}

interface Figures {
  value: number;
  count: number;
  previous_value: number;
  previous_count: number;
}

interface YearFigures {
  fiscal_year: number;
  value: number;
  count: number;
  largest_value: number;
}

function fromFirst(years: YearFigures[]) {
  const byYear = [...years];
  while (byYear.length && !byYear[0]?.count) byYear.shift();
  return byYear;
}

/** An award's reference as published: payments' are the importer's own. */
function reference(award: { reference: string }, payments: boolean) {
  return payments ? null : award.reference;
}

interface LargestRow {
  id: number;
  reference: string;
  value: string | null;
  part?: number | null;
  recipient_id: number;
  recipient_name: string;
  recipient_is_placeholder: boolean;
}

/** An award, and the part of its value this year. */
function largestOf(award: LargestRow | undefined, yearValue: unknown, payments: boolean) {
  if (!award) return null;
  return {
    id: award.id,
    reference: reference(award, payments),
    value: amount(award.value) ?? 0,
    year_value: amount(yearValue) ?? 0,
    recipient_id: award.recipient_id,
    recipient_name: award.recipient_name,
    recipient_is_placeholder: award.recipient_is_placeholder,
  };
}

/** Cents, added up exactly (sums of numeric columns arrive as strings). */
function cents(value: unknown): bigint {
  if (value === null || value === undefined) return 0n;
  const text = String(value);
  const negative = text.startsWith("-");
  const [whole = "0", frac = ""] = text.replace(/^-/, "").split(".");
  const result = BigInt(whole || "0") * 100n + BigInt((frac + "00").slice(0, 2));
  return negative ? -result : result;
}

function centsToNumber(value: bigint): number {
  return Number(value) / 100;
}

/** The summary of a scope: an organization, or one of its ministries, programs or recipients. */
export async function buildSummary(
  scope: Scope,
  today = todayLocal(),
  options: { through?: string } = {},
) {
  const awards = scopeAwards(scope);
  const scopeLevel = level(scope);
  // A recipient's ministries; anything else's recipients
  const counterpart = scopeLevel === "recipient" ? "ministry" : "recipient";
  const payments = scopeKind(scope) === "payment";

  // The year to date, to where the organization's data runs
  const throughDay =
    options.through ?? (await through((scope.organization as { id: number }).id, today));
  const fiscalYear = fiscalYearOf(throughDay);
  const yearStart = isoDate(fiscalYear, 4, 1);
  const previousStart = isoDate(fiscalYear - 1, 4, 1);
  const previousThrough = aYearBefore(throughDay);
  const thisYear = sql`(a.start_date >= ${yearStart}::date AND a.start_date <= ${throughDay}::date)`;
  const lastYear = sql`(a.start_date >= ${previousStart}::date AND a.start_date <= ${previousThrough}::date)`;

  // 1. By fiscal year, agreement type and whether dated, which gives the years, the mix, the
  // year to date (then and a year before) and what it leaves out
  const fy = fiscalYearSql(sql.raw("a.start_date"));
  const grouped = await rows<{
    fiscal_year: number;
    agreement_type: string | null;
    start_date_estimated: boolean;
    awards: number;
    total: string | null;
    largest: string | null;
    previous_awards: number;
    previous_total: string | null;
  }>(
    sql`SELECT ${fy} AS fiscal_year, a.agreement_type, a.start_date_estimated,
               COUNT(a.id)::int AS awards, SUM(a.value) AS total, MAX(a.value) AS largest,
               (COUNT(a.id) FILTER (WHERE ${lastYear}))::int AS previous_awards,
               SUM(a.value) FILTER (WHERE ${lastYear}) AS previous_total
          FROM ${FROM_AWARDS}
         WHERE ${awards} AND a.start_date >= ${isoDate(fiscalYear - YEARS + 1, 4, 1)}::date AND a.start_date <= ${throughDay}::date
         GROUP BY 1, 2, 3`,
  );
  const years = new Map<
    number,
    { fiscal_year: number; value: bigint; count: number; largest_value: number }
  >();
  for (let year = fiscalYear - YEARS + 1; year <= fiscalYear; year++) {
    years.set(year, { fiscal_year: year, value: 0n, count: 0, largest_value: 0 });
  }
  const ytd = { value: 0n, count: 0, previous_value: 0n, previous_count: 0 };
  const undated = { value: 0n, count: 0, previous_value: 0n, previous_count: 0 };
  for (const row of grouped) {
    const year = years.get(row.fiscal_year);
    if (!year) continue;
    year.value += cents(row.total);
    year.count += row.awards;
    year.largest_value = Math.max(year.largest_value, amount(row.largest) ?? 0);
    const part = row.start_date_estimated ? undated : ytd;
    if (row.fiscal_year === fiscalYear) {
      part.value += cents(row.total);
      part.count += row.awards;
    }
    part.previous_value += cents(row.previous_total);
    part.previous_count += row.previous_awards;
  }
  const floats = (f: typeof ytd): Figures => ({
    value: centsToNumber(f.value),
    count: f.count,
    previous_value: centsToNumber(f.previous_value),
    previous_count: f.previous_count,
  });

  const AWARD_WITH_RECIPIENT = sql.raw(
    "a.id, a.reference, a.value, a.recipient_id, r.display_name AS recipient_name, r.is_placeholder AS recipient_is_placeholder",
  );
  // NULLS LAST (moot: they're left out) keeps the database off the index of values, which it
  // would read to the end for a scope with nothing this year
  const largest = await one<LargestRow>(
    sql`SELECT ${AWARD_WITH_RECIPIENT}
          FROM ${FROM_AWARDS} JOIN recipient r ON r.id = a.recipient_id
         WHERE ${awards} AND ${thisYear} AND ${DATED} AND a.value IS NOT NULL
         ORDER BY a.value DESC NULLS LAST, a.id DESC LIMIT 1`,
  );
  const started: Record<string, unknown> = {
    ytd: { ...floats(ytd), largest: largestOf(largest, largest?.value, payments) },
    by_year: fromFirst([...years.values()].map((y) => ({ ...y, value: centsToNumber(y.value) }))),
  };

  // 2. The same, spread over agreements' terms
  let spread: Record<string, unknown> = {};
  if (!payments) {
    const spans = new Map<number, [string, string]>();
    for (const year of years.keys()) {
      const end = isoDate(year + 1, 3, 31);
      spans.set(year, [isoDate(year, 4, 1), end < throughDay ? end : throughDay]);
    }
    spread = await annualizedFigures(
      awards,
      spans,
      [yearStart, throughDay],
      [previousStart, previousThrough],
    );
    const largestSpread = await one<LargestRow>(
      sql`SELECT * FROM (
            SELECT ${AWARD_WITH_RECIPIENT}, ${valueIn(yearStart, throughDay)} AS part
              FROM ${FROM_AWARDS} JOIN recipient r ON r.id = a.recipient_id
             WHERE ${awards} AND ${DATED} AND ${running(yearStart, throughDay)}) t
          WHERE t.part > 0 ORDER BY t.part DESC, t.id DESC LIMIT 1`,
    );
    (spread.ytd as Record<string, unknown>).largest = largestOf(
      largestSpread,
      largestSpread?.part,
      payments,
    );
  }

  const counterparts = await counterpartFigures(
    awards,
    counterpart,
    thisYear,
    lastYear,
    [yearStart, throughDay],
    [previousStart, previousThrough],
    payments,
  );
  Object.assign(started, counterparts.started);
  if (payments) {
    // Payments have no term: all of one is on its day
    spread = structuredClone(started);
  } else {
    Object.assign(spread, counterparts.annualized);
  }
  return {
    scope: scopeLevel,
    counterpart,
    // The server's day, which `latest` runs to (the browser's may differ)
    today,
    fiscal_year: fiscalYear,
    through: throughDay,
    previous_through: previousThrough,
    started,
    annualized: spread,
    undated: undated.count || undated.previous_count ? floats(undated) : null,
    latest: await latestAwards(awards, scopeRollup(scope), today, payments),
    last_import: await lastImport(awards),
    mix: payments ? null : mix(grouped),
  };
}

/**
 * Awards' value spread over their terms in each fiscal year's span (`spans`, by year: this one's
 * to date), and dated awards' in the year to date (`ytd`) and the same span a year before
 * (`previous`).
 */
async function annualizedFigures(
  awards: SQL,
  spans: Map<number, [string, string]>,
  ytd: [string, string],
  previous: [string, string],
) {
  const selects: SQL[] = [];
  const named: [string, [string, string], SQL | undefined][] = [
    ...[...spans.entries()].map(
      ([year, span]) => [String(year), span, undefined] as [string, [string, string], undefined],
    ),
    ["ytd", ytd, DATED],
    ["previous", previous, DATED],
  ];
  for (const [name, [first, last], whereSql] of named) {
    const [total, count, largest] = spanTotals(first, last, whereSql);
    selects.push(
      sql`${total} AS ${sql.raw(`"total_${name}"`)}`,
      sql`${count}::int AS ${sql.raw(`"count_${name}"`)}`,
      sql`${largest} AS ${sql.raw(`"largest_${name}"`)}`,
    );
  }
  const first = [...spans.values()].map((s) => s[0]).sort()[0] as string;
  const last = [...spans.values()]
    .map((s) => s[1])
    .sort()
    .at(-1) as string;
  const figures = (await one<Record<string, unknown>>(
    sql`SELECT ${sql.join(selects, sql`, `)} FROM ${FROM_AWARDS} WHERE ${awards} AND ${running(first, last)}`,
  )) as Record<string, unknown>;
  const years = [...spans.keys()].map((year) => ({
    fiscal_year: year,
    value: amount(figures[`total_${year}`]) ?? 0,
    count: Number(figures[`count_${year}`] ?? 0),
    largest_value: amount(figures[`largest_${year}`]) ?? 0,
  }));
  return {
    ytd: {
      value: amount(figures.total_ytd) ?? 0,
      count: Number(figures.count_ytd ?? 0),
      previous_value: amount(figures.total_previous) ?? 0,
      previous_count: Number(figures.count_previous ?? 0),
      largest: null as unknown,
    },
    by_year: fromFirst(years),
  };
}

/** The latest dated awards to have started. */
async function latestAwards(awards: SQL, rollup: SQL, today: string, payments: boolean) {
  // Reading everyone's awards newest first soon finds a scope's latest while it's funding, but
  // only after years of others' once it's stopped (a ministry since reorganized): then sorting
  // its own is quicker. NULLS LAST (moot: dates are never null) has the database do that
  const funding = await one(
    sql`SELECT 1 FROM award_rollup ru WHERE ${rollup} AND ru.fiscal_year >= ${fiscalYearOf(today) - 1} LIMIT 1`,
  );
  const newest = funding ? sql.raw("a.start_date DESC") : sql.raw("a.start_date DESC NULLS LAST");
  const latest = await rows<{
    id: number;
    reference: string;
    start_date: string;
    value: string | null;
    agreement_type: string | null;
    recipient_id: number;
    recipient_name: string;
    recipient_is_placeholder: boolean;
    ministry_id: number;
    ministry_name: string;
  }>(
    sql`SELECT a.id, a.reference, a.start_date, a.value, a.agreement_type, a.recipient_id,
               r.display_name AS recipient_name, r.is_placeholder AS recipient_is_placeholder,
               a.ministry_id, m.name AS ministry_name
          FROM ${FROM_AWARDS} JOIN recipient r ON r.id = a.recipient_id
         WHERE ${awards} AND ${DATED} AND a.start_date <= ${today}::date
         ORDER BY ${newest}, a.id DESC LIMIT ${LATEST}`,
  );
  return latest.map((award) => ({
    id: award.id,
    reference: reference(award, payments),
    start_date: award.start_date,
    value: amount(award.value) ?? 0,
    agreement_type: award.agreement_type,
    recipient_id: award.recipient_id,
    recipient_name: award.recipient_name,
    recipient_is_placeholder: award.recipient_is_placeholder,
    ministry_id: award.ministry_id,
    ministry_name: award.ministry_name,
  }));
}

/**
 * The latest import: its day, and the awards of the files it brought. An import replaces whole
 * files, so each of a file's rows has its day.
 */
async function lastImport(awards: SQL) {
  const grouped = await rows<{
    import_date: string;
    source_file: string | null;
    awards: number;
    total: string | null;
  }>(
    sql`SELECT a.import_date, a.source_file, COUNT(a.id)::int AS awards, SUM(a.value) AS total
          FROM ${FROM_AWARDS} WHERE ${awards} AND a.import_date IS NOT NULL
         GROUP BY a.import_date, a.source_file`,
  );
  if (!grouped.length) return null;
  const day = grouped
    .map((row) => row.import_date)
    .sort()
    .at(-1) as string;
  const latest = grouped.filter((row) => row.import_date === day);
  return {
    date: day,
    count: latest.reduce((sum, row) => sum + row.awards, 0),
    value: centsToNumber(latest.reduce((sum, row) => sum + cents(row.total), 0n)),
    files: new Set(latest.map((row) => row.source_file).filter(Boolean)).size,
  };
}

/**
 * Recipients (or a recipient's ministries) with dated awards this year (started from `span`'s
 * first day to its last or, for agreements, running then): those whose first award it is, and
 * those with the most, by the year awards started and spread over their terms (against
 * `previous`). Placeholder recipients are neither.
 */
async function counterpartFigures(
  awards: SQL,
  counterpart: "ministry" | "recipient",
  thisYear: SQL,
  lastYear: SQL,
  span: [string, string],
  previous: [string, string],
  payments: boolean,
) {
  const field = sql.raw(`a.${counterpart}_id`);
  let conditions = awards;
  let join = sql``;
  if (counterpart === "recipient") {
    join = sql.raw(" JOIN recipient r ON r.id = a.recipient_id");
    conditions = sql`${awards} AND NOT r.is_placeholder`;
  }
  const aggregates: SQL[] = [
    sql`MIN(a.start_date) AS first`,
    sql`(COUNT(a.id) FILTER (WHERE ${thisYear} AND ${DATED}))::int AS awards`,
    sql`SUM(a.value) FILTER (WHERE ${thisYear} AND ${DATED}) AS total`,
    sql`(COUNT(a.id) FILTER (WHERE ${lastYear} AND ${DATED}))::int AS previous_awards`,
    sql`SUM(a.value) FILTER (WHERE ${lastYear} AND ${DATED}) AS previous_total`,
  ];
  let present = sql`(COUNT(a.id) FILTER (WHERE ${thisYear} AND ${DATED})) > 0`;
  if (!payments) {
    const [total, count] = spanTotals(span[0], span[1], DATED);
    const [previousTotal, previousCount] = spanTotals(previous[0], previous[1], DATED);
    aggregates.push(
      sql`${count}::int AS spread_awards`,
      sql`${total} AS spread_total`,
      sql`${previousCount}::int AS previous_spread_awards`,
      sql`${previousTotal} AS previous_spread_total`,
    );
    present = sql`(${present} OR ${count} > 0)`;
  }
  const grouped = await rows<Record<string, unknown> & { id: number; first: string }>(
    sql`SELECT ${field} AS id, ${sql.join(aggregates, sql`, `)}
          FROM ${FROM_AWARDS}${join} WHERE ${conditions}
         GROUP BY ${field} HAVING ${present}`,
  );
  const [yearStart] = span;

  const ranked = (key: string) =>
    [...grouped].sort((a, b) => {
      const diff = (amount(b[key]) ?? 0) - (amount(a[key]) ?? 0);
      return diff !== 0 ? diff : a.id - b.id;
    });

  const bases: [string, string][] = payments
    ? [["started", ""]]
    : [
        ["started", ""],
        ["annualized", "spread_"],
      ];
  const listed = new Map(
    bases.map(([basis, prefix]) => [
      basis,
      ranked(`${prefix}total`).filter((row) => Number(row[`${prefix}awards`] ?? 0)),
    ]),
  );
  const fresh = new Map(
    [...listed.entries()].map(([basis, ranks]) => [
      basis,
      ranks.filter((row) => row.first >= yearStart),
    ]),
  );
  const movers = new Map(
    [...listed.entries()].map(([basis, ranks]) => [basis, ranks.slice(0, MOVERS)]),
  );

  const shown = new Set<number>();
  for (const ranks of fresh.values()) for (const row of ranks.slice(0, NEW)) shown.add(row.id);
  for (const ranks of movers.values()) for (const row of ranks) shown.add(row.id);
  const ids = [...shown];
  const names = new Map<number, string>();
  if (ids.length) {
    const found =
      counterpart === "ministry"
        ? await rows<{ id: number; name: string }>(
            sql`SELECT id, name FROM ministry WHERE id IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
        : await rows<{ id: number; name: string }>(
            sql`SELECT id, display_name AS name FROM recipient WHERE id IN (${sql.join(
              ids.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          );
    for (const row of found) names.set(row.id, row.name);
  }

  const figures = (basis: string, prefix: string) => ({
    new: {
      count: (fresh.get(basis) ?? []).length,
      top: (fresh.get(basis) ?? []).slice(0, NEW).map((row) => ({
        id: row.id,
        name: names.get(row.id) ?? "",
        first_start_date: row.first,
        count: Number(row[`${prefix}awards`] ?? 0),
        value: amount(row[`${prefix}total`]) ?? 0,
      })),
    },
    movers: (movers.get(basis) ?? []).map((row) => ({
      id: row.id,
      name: names.get(row.id) ?? "",
      value: amount(row[`${prefix}total`]) ?? 0,
      count: Number(row[`${prefix}awards`] ?? 0),
      previous_value: amount(row[`previous_${prefix}total`]) ?? 0,
      previous_count: Number(row[`previous_${prefix}awards`] ?? 0),
    })),
  });

  return Object.fromEntries(
    bases.map(([basis, prefix]) => [basis, figures(basis, prefix)]),
  ) as Record<"started" | "annualized", ReturnType<typeof figures>>;
}

/**
 * Awards' value by fiscal year and agreement type; null with fewer than two types (nothing to
 * compare). Awards without a known type are left out.
 */
function mix(
  grouped: {
    fiscal_year: number;
    agreement_type: string | null;
    awards: number;
    total: string | null;
  }[],
) {
  const totals = new Map<
    string,
    { fiscal_year: number; group: string; count: number; value: bigint }
  >();
  for (const row of grouped) {
    if (!row.agreement_type || !(row.agreement_type in AGREEMENT_TYPES)) continue;
    const key = `${row.fiscal_year}|${row.agreement_type}`;
    const total = totals.get(key) ?? {
      fiscal_year: row.fiscal_year,
      group: row.agreement_type,
      count: 0,
      value: 0n,
    };
    total.count += row.awards;
    total.value += cents(row.total);
    totals.set(key, total);
  }
  const present = new Set([...totals.values()].map((t) => t.group));
  const groups = Object.keys(AGREEMENT_TYPES).filter((key) => present.has(key));
  if (groups.length < 2) return null;
  return {
    groups: groups.map((key) => ({ key, label: AGREEMENT_TYPES[key] })),
    by_year: [...totals.values()]
      .sort(
        (a, b) =>
          a.fiscal_year - b.fiscal_year || (a.group < b.group ? -1 : a.group > b.group ? 1 : 0),
      )
      .map((t) => ({
        fiscal_year: t.fiscal_year,
        group: t.group,
        count: t.count,
        value: centsToNumber(t.value),
      })),
  };
}

/** A scope's summary for today, cached for the day and the data version. */
export function summaryFor(scope: Scope, today = todayLocal()) {
  // Imports bump the cache's version; the year to date moves on with the day. The response's
  // shape is in the key, as a deploy can change it under cached ones
  return cached(`summary-v${SHAPE}`, `${scopeIds(scope)}#${today}`, () =>
    limited(() => buildSummary(scope, today), getEnv().API_SUMMARY_TIMEOUT_MS),
  );
}
