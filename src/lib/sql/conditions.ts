/**
 * Filter conditions shared by the web API, the MCP tools and the admin search.
 *
 * Case-insensitive text matching is `UPPER(col::text) LIKE UPPER($1)`: the trigram indexes
 * (drizzle/0001_trigram_indexes.sql) are on exactly that expression, and ILIKE would not use
 * them. A negated condition keeps rows where the column is NULL, as "not equal to x" reads.
 */
import { type SQL, sql } from "drizzle-orm";
import { fiscalYearBounds } from "@/lib/grants/fiscal";

/** A request asked for something invalid: the message is safe to show to the caller. */
export class QueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryError";
  }
}

export type FieldType = "int" | "str" | "decimal" | "date" | "bool" | "fiscal_year";

export const FILTER_OPERATORS = [
  "eq",
  "ne",
  "contains",
  "startswith",
  "endswith",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "between",
  "isnull",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/** Escape LIKE wildcards in a user's text, as Django does. */
export function escapeLike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/** `UPPER(<expr>::text)`, the form the trigram indexes cover. */
export function upperText(expr: SQL): SQL {
  return sql`UPPER((${expr})::text)`;
}

export function containsText(expr: SQL, value: string): SQL {
  return sql`${upperText(expr)} LIKE UPPER(${`%${escapeLike(value)}%`})`;
}

export function startsWithText(expr: SQL, value: string): SQL {
  return sql`${upperText(expr)} LIKE UPPER(${`${escapeLike(value)}%`})`;
}

export function endsWithText(expr: SQL, value: string): SQL {
  return sql`${upperText(expr)} LIKE UPPER(${`%${escapeLike(value)}`})`;
}

export function equalsTextIgnoringCase(expr: SQL, value: string): SQL {
  return sql`${upperText(expr)} = UPPER(${value})`;
}

/** NOT, keeping the rows where the condition is unknown (a NULL column). */
export function not(condition: SQL): SQL {
  return sql`(${condition}) IS NOT TRUE`;
}

export function and(conditions: SQL[]): SQL | undefined {
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return sql`(${sql.join(
    conditions.map((c) => sql`(${c})`),
    sql` AND `,
  )})`;
}

export function or(conditions: SQL[]): SQL | undefined {
  if (conditions.length === 0) return undefined;
  if (conditions.length === 1) return conditions[0];
  return sql`(${sql.join(
    conditions.map((c) => sql`(${c})`),
    sql` OR `,
  )})`;
}

function toInt(value: unknown, what = "fiscal_year"): number {
  const number = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isInteger(number))
    throw new QueryError(`${what} needs a whole number, not '${value}'`);
  return number;
}

function stringify(value: unknown): unknown {
  // Booleans, numbers and strings go to Postgres as text and are cast to the column's type.
  if (value === null || value === undefined) return null;
  if (typeof value === "object")
    throw new QueryError(`Invalid filter value: ${JSON.stringify(value)}`);
  return value;
}

/** A fiscal-year rule, as a start-date range (so the start-date index applies). */
export function fiscalYearCondition(startDate: SQL, op: string, value: unknown): SQL {
  if (op === "eq" || op === "between") {
    let lo: number;
    let hi: number;
    if (op === "between") {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new QueryError("'between' needs a [low, high] pair");
      }
      lo = toInt(value[0]);
      hi = toInt(value[1]);
    } else {
      lo = hi = toInt(value);
    }
    const [start] = fiscalYearBounds(lo);
    const [, end] = fiscalYearBounds(hi);
    return sql`(${startDate} >= ${start} AND ${startDate} <= ${end})`;
  }
  if (op === "in") {
    if (!Array.isArray(value)) throw new QueryError("'in' needs a list of values");
    const years = [...new Set(value.map((v) => toInt(v)))].sort((a, b) => a - b);
    if (years.length === 0) return sql`FALSE`;
    return (
      or(
        years.map((year) => {
          const [start, end] = fiscalYearBounds(year);
          return sql`(${startDate} >= ${start} AND ${startDate} <= ${end})`;
        }),
      ) ?? sql`FALSE`
    );
  }
  if (op === "ne") {
    const [start, end] = fiscalYearBounds(toInt(value));
    return not(sql`${startDate} >= ${start} AND ${startDate} <= ${end}`);
  }
  const year = toInt(value);
  const [start, end] = fiscalYearBounds(year);
  if (op === "gt") return sql`${startDate} > ${end}`;
  if (op === "gte") return sql`${startDate} >= ${start}`;
  if (op === "lt") return sql`${startDate} < ${start}`;
  if (op === "lte") return sql`${startDate} <= ${end}`;
  throw new QueryError(`Operator '${op}' is not supported for fiscal_year`);
}

/**
 * One validated rule on one field (the MCP `filters` grammar). `expr` is the field's SQL;
 * `startDate` is the row's start date, which fiscal-year rules filter on.
 */
export function buildCondition(
  expr: SQL,
  type: FieldType,
  op: string,
  value: unknown,
  context: { startDate?: SQL } = {},
): SQL {
  if (!(FILTER_OPERATORS as readonly string[]).includes(op)) {
    throw new QueryError(
      `Unknown filter operator '${op}'. Allowed: ${[...FILTER_OPERATORS].sort().join(", ")}`,
    );
  }
  if (type === "fiscal_year") {
    if (!context.startDate) throw new QueryError("fiscal_year can't be filtered here");
    return fiscalYearCondition(context.startDate, op, value);
  }
  switch (op as FilterOperator) {
    case "eq":
      return value === null ? sql`${expr} IS NULL` : sql`${expr} = ${stringify(value)}`;
    case "ne":
      return value === null ? sql`${expr} IS NOT NULL` : not(sql`${expr} = ${stringify(value)}`);
    case "contains":
      return containsText(expr, String(stringify(value) ?? ""));
    case "startswith":
      return startsWithText(expr, String(stringify(value) ?? ""));
    case "endswith":
      return endsWithText(expr, String(stringify(value) ?? ""));
    case "gt":
      return sql`${expr} > ${stringify(value)}`;
    case "gte":
      return sql`${expr} >= ${stringify(value)}`;
    case "lt":
      return sql`${expr} < ${stringify(value)}`;
    case "lte":
      return sql`${expr} <= ${stringify(value)}`;
    case "in": {
      if (!Array.isArray(value)) throw new QueryError("'in' needs a list of values");
      if (value.length === 0) return sql`FALSE`;
      return sql`${expr} IN (${sql.join(
        value.map((v) => sql`${stringify(v)}`),
        sql`, `,
      )})`;
    }
    case "between": {
      if (!Array.isArray(value) || value.length !== 2) {
        throw new QueryError("'between' needs a [low, high] pair");
      }
      return sql`${expr} BETWEEN ${stringify(value[0])} AND ${stringify(value[1])}`;
    }
    case "isnull":
      return isTruthy(value) ? sql`${expr} IS NULL` : sql`${expr} IS NOT NULL`;
  }
}

/** Python's bool() for a JSON value. */
export function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value);
}
