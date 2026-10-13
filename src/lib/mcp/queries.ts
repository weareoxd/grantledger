/**
 * Read-only query helpers shared by the MCP tools: the structured-filter parser validated against
 * the schema allowlist (src/lib/mcp/schema.ts), ordering, pagination clamping and the row cap.
 *
 * Every statement is built with Drizzle's `sql` template from the allowlisted model FROM clauses
 * and field SQL; user values only ever travel as bound parameters.
 */
import { type SQL, sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { getEnv } from "@/lib/env";
import { fiscalYearBounds } from "@/lib/grants/fiscal";
import type { FieldDef, FieldMap, ModelDef } from "@/lib/mcp/schema";
import { rows } from "@/lib/rest/db";
import { and, buildCondition, or, QueryError } from "@/lib/sql/conditions";

export type Row = Record<string, unknown>;

/** What the tools read. Injected so tests can watch the statements a call runs. */
export interface McpDeps {
  /** Runs one read-only statement and returns its rows. */
  query: (statement: SQL) => Promise<Row[]>;
}

export const defaultDeps: McpDeps = {
  // On the tool call's transaction, with its statement timeout (runTool in ./result.ts)
  query: (statement) => rows<Row>(statement),
};

const dialect = new PgDialect();

/** The statement's SQL text and parameters, as a cache identity. */
export function statementIdentity(statement: SQL): string {
  const query = dialect.sqlToQuery(statement);
  return JSON.stringify([query.sql, query.params]);
}

/** Python's sorted() over names, joined for an error message. */
export function sortedNames(names: Iterable<string>): string {
  return [...names].sort().join(", ");
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/**
 * A field's SQL for a SELECT list. `numeric` columns are cast to float8 so they arrive as JSON
 * numbers, as the Python server's Decimal -> float conversion sent them.
 */
export function columnSql(def: FieldDef): SQL {
  return def.type === "decimal" ? sql`(${def.sql})::float8` : def.sql;
}

/** `<field sql> AS "<name>", ...` for the given allowlisted names. */
export function selectList(fields: FieldMap, names: string[]): SQL {
  return sql.join(
    names.map((name) => sql`${columnSql(fields[name] as FieldDef)} AS ${sql.identifier(name)}`),
    sql`, `,
  );
}

/** `WHERE a AND b`, or nothing. */
export function whereClause(conditions: Array<SQL | undefined>): SQL {
  const condition = and(conditions.filter((c): c is SQL => c !== undefined));
  return condition ? sql` WHERE ${condition}` : sql``;
}

// ---------------------------------------------------------------------------
// Filtering
// ---------------------------------------------------------------------------

export type Filter = Record<string, unknown>;

/**
 * The condition for `[{"field", "op", "value"}]` filters, validated against the model's field
 * map. Unknown fields are rejected so a caller can never reach a non-allowlisted column.
 * `combine` is "and" (default) or "or" across the filters.
 */
export function filterCondition(
  filters: Filter[] | null | undefined,
  model: Pick<ModelDef, "fields" | "startDate">,
  combine = "and",
): SQL | undefined {
  if (!filters || filters.length === 0) return undefined;
  if (combine !== "and" && combine !== "or") throw new QueryError("combine must be 'and' or 'or'");
  const conditions = filters.map((filter) => {
    if (!filter || typeof filter !== "object" || Array.isArray(filter)) {
      throw new QueryError("Each filter must be an object with field, op and value");
    }
    const field = filter.field;
    const op = "op" in filter ? String(filter.op) : "eq";
    const value = filter.value ?? null;
    if (typeof field !== "string" || !Object.hasOwn(model.fields, field)) {
      throw new QueryError(
        `Field '${String(field)}' is not filterable on this model. Allowed fields: ${sortedNames(Object.keys(model.fields))}`,
      );
    }
    const def = model.fields[field] as FieldDef;
    return buildCondition(def.sql, def.type, op, value, { startDate: model.startDate });
  });
  return combine === "or" ? or(conditions) : and(conditions);
}

/** `start_date` restricted to an inclusive fiscal-year range. */
export function fiscalRange(
  startDate: SQL,
  fiscalYearFrom: number | null | undefined,
  fiscalYearTo: number | null | undefined,
): SQL | undefined {
  const conditions: SQL[] = [];
  if (fiscalYearFrom !== null && fiscalYearFrom !== undefined) {
    conditions.push(sql`${startDate} >= ${fiscalYearBounds(fiscalYearFrom)[0]}`);
  }
  if (fiscalYearTo !== null && fiscalYearTo !== undefined) {
    conditions.push(sql`${startDate} <= ${fiscalYearBounds(fiscalYearTo)[1]}`);
  }
  return and(conditions);
}

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

function parseTerm(term: string): { name: string; desc: boolean } {
  const desc = term.startsWith("-");
  return { name: desc ? term.slice(1) : term, desc };
}

/** Validate and translate `order_by` names (optionally `-`-prefixed) to ORDER BY terms. */
export function resolveOrdering(
  orderBy: string[] | null | undefined,
  model: Pick<ModelDef, "fields" | "startDate">,
): SQL[] {
  return (orderBy ?? []).map((term) => {
    const { name, desc } = parseTerm(term);
    if (!Object.hasOwn(model.fields, name)) {
      throw new QueryError(
        `Cannot order by '${name}'. Allowed fields: ${sortedNames(Object.keys(model.fields))}`,
      );
    }
    const def = model.fields[name] as FieldDef;
    // A fiscal year sorts as its start date (the index applies).
    const expr = def.type === "fiscal_year" && model.startDate ? model.startDate : def.sql;
    return desc ? sql`${expr} DESC` : sql`${expr} ASC`;
  });
}

/** Grouped results order only by a selected group key or an aggregation alias. */
export function resolveGroupedOrdering(
  orderBy: string[] | null | undefined,
  allowed: string[],
): SQL[] {
  return (orderBy ?? []).map((term) => {
    const { name, desc } = parseTerm(term);
    if (!allowed.includes(name)) {
      throw new QueryError(
        `Cannot order grouped results by '${name}'. Use a group_by field or an aggregation alias: ${sortedNames(new Set(allowed))}`,
      );
    }
    return desc ? sql`${sql.identifier(name)} DESC` : sql`${sql.identifier(name)} ASC`;
  });
}

// ---------------------------------------------------------------------------
// Row cap
// ---------------------------------------------------------------------------

/**
 * The configured row cap as a positive integer, or null for unlimited. Blank, "none", "null",
 * "unlimited", anything that is not a whole number, and non-positive numbers all mean no cap.
 */
export function resolvedMaxRows(raw: string | undefined = getEnv().MCP_MAX_ROWS): number | null {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim().toLowerCase();
  if (["", "none", "null", "unlimited"].includes(text)) return null;
  if (!/^[+-]?\d+$/.test(text)) return null;
  const value = Number.parseInt(text, 10);
  return value > 0 ? value : null;
}

/** Clamp a requested row limit to [1, MCP_MAX_ROWS] (no upper cap if unlimited). */
export function clampLimit(limit: unknown, fallback = 50): number {
  const maxRows = resolvedMaxRows();
  let value = limit === null || limit === undefined ? fallback : Math.trunc(Number(limit));
  if (!Number.isFinite(value)) value = fallback;
  value = Math.max(1, value);
  return maxRows === null ? value : Math.min(value, maxRows);
}

export function clampOffset(offset: unknown): number {
  const value = Math.trunc(Number(offset));
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
