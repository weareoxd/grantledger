/**
 * The web API's list engine: resolve the scope, build the query for a list kind, compute
 * (cached) count and footer totals, and serialize one page.
 *
 * Aggregated lists (organizations, ministries, programs, recipients) read `award_rollup`,
 * grouped by the list's entity. Award lists read `award` directly. Both honour the same params:
 * fiscal year, column filters (WHERE for entity columns, HAVING for aggregates), sort with an id
 * tiebreak, and the placeholder/superseded toggles.
 */
import { type SQL, sql } from "drizzle-orm";
import { ALL_YEARS } from "@/lib/db/schema";
import type { RecordKind } from "@/lib/domain";
import { organizationMeta } from "@/lib/grants/constants";
import { fiscalYearBounds, fiscalYearOf, todayLocal } from "@/lib/grants/fiscal";
import { normalizeName } from "@/lib/grants/normalize";
import { AWARD_FROM } from "@/lib/mcp/schema";
import { cached } from "@/lib/server/cache";
import {
  and,
  buildCondition,
  containsText,
  endsWithText,
  equalsTextIgnoringCase,
  type FieldType,
  not,
  or,
  startsWithText,
} from "@/lib/sql/conditions";
import { AGGREGATES, type Column, type GroupKind, type ListSpec, specColumn } from "./columns";
import { one, rows } from "./db";
import { notFound } from "./errors";
import { type FilterValue, identity, type ListParams, offset } from "./params";

export const LIST_DESCRIPTION_CHARS = 300;
export const NO_PROGRAM = "(No program)";

export const MEASURES: Record<RecordKind, string> = {
  agreement: "Agreements (committed value)",
  payment: "Payments (cash paid)",
};

// ---------------------------------------------------------------------------
// Scope
// ---------------------------------------------------------------------------

export interface ScopeIds {
  organization_id?: number;
  ministry_id?: number;
  program_id?: number;
  recipient_id?: number;
}

export interface Scope {
  organization: { id: number; name: string; key: string } | null;
  ministry: { id: number; name: string } | null;
  program: { id: number; name: string } | null;
  recipient: { id: number; name: string; display_name: string; is_placeholder: boolean } | null;
}

/** The organization's record kind (null on the home list). */
export function scopeKind(scope: Scope): RecordKind | null {
  return scope.organization
    ? (organizationMeta(scope.organization.key)?.record_kind ?? null)
    : null;
}

export function scopeIds(scope: Scope) {
  return JSON.stringify([
    scope.organization?.id ?? null,
    scope.ministry?.id ?? null,
    scope.program?.id ?? null,
    scope.recipient?.id ?? null,
  ]);
}

/** The scope's names, for the page's breadcrumbs: the recipient's as published. */
export function scopePayload(scope: Scope) {
  return {
    organization: scope.organization?.name ?? null,
    ministry: scope.ministry?.name ?? null,
    program: scope.program?.name ?? null,
    recipient: scope.recipient?.display_name ?? null,
  };
}

/** The rollup rows of a scope, as a WHERE condition on `ru`. */
function rollupScope(scope: Scope): SQL[] {
  const conditions: SQL[] = [];
  if (scope.organization) conditions.push(sql`ru.organization_id = ${scope.organization.id}`);
  if (scope.ministry) conditions.push(sql`ru.ministry_id = ${scope.ministry.id}`);
  if (scope.program) conditions.push(sql`ru.program_id = ${scope.program.id}`);
  if (scope.recipient) conditions.push(sql`ru.recipient_id = ${scope.recipient.id}`);
  return conditions;
}

function where(conditions: (SQL | undefined)[]): SQL {
  const all = conditions.filter((c): c is SQL => c !== undefined);
  return all.length ? sql` WHERE ${and(all)}` : sql``;
}

/** 404 unless the ids exist and nest (a ministry in the organization, and so on). */
export async function resolveScope(ids: ScopeIds): Promise<Scope> {
  const scope: Scope = { organization: null, ministry: null, program: null, recipient: null };
  if (ids.organization_id !== undefined) {
    scope.organization =
      (await one<Scope["organization"]>(
        sql`SELECT id, name, key FROM organization WHERE id = ${ids.organization_id}`,
      )) ?? null;
    if (!scope.organization) throw notFound("Organization not found.");
  }
  if (ids.ministry_id !== undefined) {
    scope.ministry =
      (await one<Scope["ministry"]>(
        sql`SELECT id, name FROM ministry WHERE id = ${ids.ministry_id} AND organization_id = ${ids.organization_id ?? null}`,
      )) ?? null;
    if (!scope.ministry) throw notFound("Ministry not found.");
  }
  if (ids.program_id !== undefined) {
    scope.program =
      (await one<Scope["program"]>(
        sql`SELECT id, name FROM program WHERE id = ${ids.program_id} AND ministry_id = ${ids.ministry_id ?? null}`,
      )) ?? null;
    if (!scope.program) throw notFound("Program not found.");
  }
  if (ids.recipient_id !== undefined) {
    scope.recipient =
      (await one<Scope["recipient"]>(
        sql`SELECT id, name, display_name, is_placeholder FROM recipient WHERE id = ${ids.recipient_id}`,
      )) ?? null;
    // The recipient must have current awards under this scope (any fiscal year).
    const funded =
      scope.recipient !== null &&
      (await one(
        sql`SELECT 1 FROM award_rollup ru${where([...rollupScope(scope), sql`ru.fiscal_year = ${ALL_YEARS}`])} LIMIT 1`,
      )) !== undefined;
    if (!funded) throw notFound("Recipient not found.");
  }
  return scope;
}

export function currentFiscalYear(today = todayLocal()) {
  return fiscalYearOf(today);
}

/** Fiscal years with data, newest first, clipped to a plausible range. */
export async function fiscalYears(organizationId: number): Promise<number[]> {
  const top = currentFiscalYear() + 1;
  const result = await rows<{ fiscal_year: number }>(
    sql`SELECT DISTINCT fiscal_year FROM award_rollup
         WHERE organization_id = ${organizationId} AND fiscal_year >= 1990 AND fiscal_year <= ${top}
         ORDER BY fiscal_year DESC`,
  );
  return result.map((row) => row.fiscal_year);
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

const BUILD_TYPES: Record<string, FieldType> = {
  int: "int",
  money: "decimal",
  date: "date",
  fiscal_year: "fiscal_year",
  code: "str",
};

/** One rule on one column. Aggregate columns filter on their aggregate. */
function columnCondition(col: Column, op: string, value: FilterValue): SQL {
  const path = col.aggregate ? (AGGREGATES[col.key] as SQL) : (col.path as SQL);
  if (col.type === "text") {
    let text = String(value);
    if (col.normalize) text = normalizeName(text) || text;
    switch (op) {
      case "contains":
        return containsText(path, text);
      case "not_contains":
        return not(containsText(path, text));
      case "startswith":
        return startsWithText(path, text);
      case "endswith":
        return endsWithText(path, text);
      case "eq":
        return equalsTextIgnoringCase(path, text);
      case "ne":
        return not(equalsTextIgnoringCase(path, text));
    }
  }
  if (col.type === "bool") return sql`${path} = ${value}`;
  return buildCondition(path, BUILD_TYPES[col.type] as FieldType, op, value, {
    startDate: sql.raw("a.start_date"),
  });
}

/** [where, having] for a list's filters: rules combine per column by match, columns are ANDed. */
function filterConditions(spec: ListSpec, params: ListParams): [SQL[], SQL[]] {
  const whereParts: SQL[] = [];
  const havingParts: SQL[] = [];
  for (const group of params.filters) {
    const col = specColumn(spec, group.key) as Column;
    const conditions = group.rules.map(([op, value]) => columnCondition(col, op, value));
    const combined = (group.match === "any" ? or(conditions) : and(conditions)) as SQL;
    (col.aggregate ? havingParts : whereParts).push(combined);
  }
  return [whereParts, havingParts];
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

interface GroupConfig {
  /** The columns selected and grouped by. */
  select: SQL;
  groupBy: SQL;
  /** The join that brings in the group's entity. */
  join: SQL;
  id: SQL;
}

const GROUPS: Record<GroupKind, GroupConfig> = {
  organization: {
    select: sql.raw(
      "ru.organization_id AS organization_id, o.name AS organization__name, o.key AS organization__key",
    ),
    groupBy: sql.raw("ru.organization_id, o.name, o.key"),
    join: sql.raw(" JOIN organization o ON o.id = ru.organization_id"),
    id: sql.raw("ru.organization_id"),
  },
  ministry: {
    select: sql.raw("ru.ministry_id AS ministry_id, m.name AS ministry__name"),
    groupBy: sql.raw("ru.ministry_id, m.name"),
    join: sql.raw(" JOIN ministry m ON m.id = ru.ministry_id"),
    id: sql.raw("ru.ministry_id"),
  },
  program: {
    select: sql.raw("ru.program_id AS program_id, p.name AS program__name"),
    groupBy: sql.raw("ru.program_id, p.name"),
    join: sql.raw(" LEFT JOIN program p ON p.id = ru.program_id"),
    id: sql.raw("ru.program_id"),
  },
  recipient: {
    select: sql.raw(
      "ru.recipient_id AS recipient_id, r.name AS recipient__name, r.display_name AS recipient__display_name, r.is_placeholder AS recipient__is_placeholder",
    ),
    groupBy: sql.raw("ru.recipient_id, r.name, r.display_name, r.is_placeholder"),
    join: sql.raw(" JOIN recipient r ON r.id = ru.recipient_id"),
    id: sql.raw("ru.recipient_id"),
  },
};

/** The FROM ... WHERE ... GROUP BY ... HAVING of an aggregated list. */
function aggregatedBody(spec: ListSpec, scope: Scope, params: ListParams): SQL {
  const group = GROUPS[spec.group as GroupKind];
  const [whereParts, havingParts] = filterConditions(spec, params);
  const joins = [group.join];
  const conditions = [
    ...rollupScope(scope),
    sql`ru.fiscal_year = ${params.fiscal_year || ALL_YEARS}`,
  ];
  if (params.hide_placeholders) {
    if (spec.group !== "recipient")
      joins.push(sql.raw(" JOIN recipient r ON r.id = ru.recipient_id"));
    conditions.push(sql.raw("NOT r.is_placeholder"));
  }
  conditions.push(...whereParts);
  const having = havingParts.length ? sql` HAVING ${and(havingParts)}` : sql``;
  return sql`FROM award_rollup ru${sql.join(joins)}${where(conditions)} GROUP BY ${group.groupBy}${having}`;
}

function aggregateSelect(spec: ListSpec): SQL {
  const group = GROUPS[spec.group as GroupKind];
  const aggregates = spec.columns
    .filter((col) => col.aggregate)
    .map((col) => sql`${AGGREGATES[col.key] as SQL} AS ${sql.raw(col.key)}`);
  return sql.join([group.select, ...aggregates], sql`, `);
}

/** The WHERE conditions of an award list. */
function awardConditions(spec: ListSpec, scope: Scope, params: ListParams): SQL[] {
  const [whereParts] = filterConditions(spec, params);
  const conditions: SQL[] = [sql`m.organization_id = ${(scope.organization as { id: number }).id}`];
  if (scope.ministry) conditions.push(sql`a.ministry_id = ${scope.ministry.id}`);
  if (scope.program) conditions.push(sql`a.program_id = ${scope.program.id}`);
  if (scope.recipient) conditions.push(sql`a.recipient_id = ${scope.recipient.id}`);
  if (!params.include_superseded) conditions.push(sql.raw("a.is_current"));
  if (params.fiscal_year) {
    const [start, end] = fiscalYearBounds(params.fiscal_year);
    conditions.push(sql`a.start_date >= ${start}`, sql`a.start_date <= ${end}`);
  }
  if (params.hide_placeholders) conditions.push(sql.raw("NOT r.is_placeholder"));
  return [...conditions, ...whereParts];
}

const AWARD_SELECT = sql.raw(
  [
    "a.id",
    "a.reference",
    "a.agreement_number",
    "a.record_kind",
    "a.amendment_number",
    "a.amendment_date",
    "a.is_current",
    "a.agreement_type",
    "a.recipient_type",
    "a.recipient_province",
    "a.recipient_city",
    "a.value",
    "a.start_date",
    "a.start_date_estimated",
    "a.end_date",
    "a.title",
    "a.description",
    "a.naics",
    "a.business_unit",
    "a.lottery_fund",
    "a.source_file",
    "a.import_date",
    "a.ministry_id",
    "m.name AS ministry__name",
    "a.program_id",
    "p.name AS program__name",
    "a.recipient_id",
    "r.display_name AS recipient__display_name",
    "r.is_placeholder AS recipient__is_placeholder",
  ].join(", "),
);

/** ORDER BY terms for a list, with the id tiebreak; `reverse` flips every term. */
function ordering(spec: ListSpec, params: ListParams, reverse = false): SQL {
  const key = params.sort || spec.defaultSort;
  let desc = key.startsWith("-");
  if (reverse) desc = !desc;
  const col = specColumn(spec, key.replace(/^-/, "")) as Column;
  let path: SQL;
  let tiebreak: SQL;
  if (spec.group) {
    path = col.aggregate ? sql.raw(col.key) : (col.path as SQL);
    tiebreak = GROUPS[spec.group].id;
  } else {
    path = col.sortPath ?? (col.path as SQL);
    tiebreak = sql.raw("a.id");
  }
  const dir = sql.raw(desc ? " DESC" : " ASC");
  return sql`${path}${dir}, ${tiebreak}${dir}`;
}

function orderedQuery(spec: ListSpec, scope: Scope, params: ListParams, reverse = false): SQL {
  if (spec.group) {
    return sql`SELECT ${aggregateSelect(spec)} ${aggregatedBody(spec, scope, params)} ORDER BY ${ordering(spec, params, reverse)}`;
  }
  return sql`SELECT ${AWARD_SELECT} FROM ${AWARD_FROM}${where(awardConditions(spec, scope, params))} ORDER BY ${ordering(spec, params, reverse)}`;
}

// ---------------------------------------------------------------------------
// Totals and pages (cached under the data version)
// ---------------------------------------------------------------------------

export interface Totals {
  count: number;
  footer: Record<string, number>;
}

/** Python's to_jsonable: a numeric (money) string as a number. */
export function amount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return typeof value === "number" ? value : Number(value);
}

/** `{count, footer}` for the filtered set; shared across pages and sorts. */
export function totals(spec: ListSpec, scope: Scope, params: ListParams): Promise<Totals> {
  const key = `${spec.kind}|${scopeIds(scope)}|${identity(params, ["page", "page_size", "sort"])}`;
  return cached("api_totals", key, () => computeTotals(spec, scope, params));
}

async function computeTotals(spec: ListSpec, scope: Scope, params: ListParams): Promise<Totals> {
  if (spec.group) {
    // One pass over the grouped rows for both the group count and the footer sums.
    const sums = sql.join(
      spec.footer.map((key) => sql`SUM(g.${sql.raw(key)}) AS ${sql.raw(`total_${key}`)}`),
      sql`, `,
    );
    const result = (await one<Record<string, unknown>>(
      sql`SELECT COUNT(*) AS group_count, ${sums} FROM (SELECT ${aggregateSelect(spec)} ${aggregatedBody(spec, scope, params)}) g`,
    )) as Record<string, unknown>;
    const count = Number(result.group_count ?? 0);
    const footer = Object.fromEntries(
      spec.footer.map((key) => [key, count ? (amount(result[`total_${key}`]) ?? 0) : 0]),
    );
    return { count, footer };
  }

  let count: number;
  let value: unknown;
  if (!params.filters.length && !params.include_superseded) {
    // Unfiltered current awards: the rollup already holds the count and sum.
    const conditions = [
      ...rollupScope(scope),
      sql`ru.fiscal_year = ${params.fiscal_year || ALL_YEARS}`,
    ];
    let join = sql``;
    if (params.hide_placeholders) {
      join = sql.raw(" JOIN recipient r ON r.id = ru.recipient_id");
      conditions.push(sql.raw("NOT r.is_placeholder"));
    }
    const result = await one<{ n: unknown; v: unknown }>(
      sql`SELECT SUM(ru.n_awards) AS n, SUM(ru.total_value) AS v FROM award_rollup ru${join}${where(conditions)}`,
    );
    count = Number(result?.n ?? 0);
    value = result?.v;
  } else {
    const result = await one<{ n: unknown; v: unknown }>(
      sql`SELECT COUNT(a.id) AS n, SUM(a.value) AS v FROM ${AWARD_FROM}${where(awardConditions(spec, scope, params))}`,
    );
    count = Number(result?.n ?? 0);
    value = result?.v;
  }
  // Superseded amendments restate the same agreement's value, so their sum means nothing.
  const footer: Record<string, number> = params.include_superseded
    ? {}
    : { value: value !== null && value !== undefined ? (amount(value) as number) : 0 };
  return { count, footer };
}

export interface ListEnvelope {
  count: number;
  data: Record<string, unknown>[];
  organization: string | null;
  ministry: string | null;
  program: string | null;
  recipient: string | null;
  footer_totals: Record<string, number>;
}

/** The full JSON payload for one page of a list. */
export function page(spec: ListSpec, scope: Scope, params: ListParams): Promise<ListEnvelope> {
  const key = `${spec.kind}|${scopeIds(scope)}|${identity(params)}`;
  return cached("api_page", key, () => computePage(spec, scope, params));
}

async function computePage(
  spec: ListSpec,
  scope: Scope,
  params: ListParams,
): Promise<ListEnvelope> {
  const summary = await totals(spec, scope, params);
  const { count } = summary;
  // As DRF's paginator: page 1 of an empty list is fine, any page past it isn't
  if (params.page > Math.max(1, Math.ceil(count / params.page_size))) {
    throw notFound("Invalid page.");
  }
  const raw = await pageRows(spec, scope, params, count);
  const data = await Promise.all(raw.map((row) => serialize(spec, row)));
  return { count, data, ...scopePayload(scope), footer_totals: summary.footer };
}

/**
 * Rows for one page. Pages past the middle are read in reverse order from the end (with the id
 * tiebreak the order is total), so the last page of two million rows costs a short scan instead
 * of a deep OFFSET.
 */
async function pageRows(spec: ListSpec, scope: Scope, params: ListParams, count: number) {
  const start = offset(params);
  const stop = Math.min(start + params.page_size, count);
  if (stop <= start) return [];
  if (start > Math.floor(count / 2)) {
    const reversed = await rows(
      sql`${orderedQuery(spec, scope, params, true)} LIMIT ${stop - start} OFFSET ${count - stop}`,
    );
    return reversed.reverse();
  }
  return rows(sql`${orderedQuery(spec, scope, params)} LIMIT ${stop - start} OFFSET ${start}`);
}

/** The full, ordered query for an export (streamed from a cursor by export.ts). */
export function exportQuery(spec: ListSpec, scope: Scope, params: ListParams): SQL {
  return orderedQuery(spec, scope, params);
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export async function serialize(
  spec: ListSpec,
  row: Record<string, unknown>,
  { fullText = false } = {},
): Promise<Record<string, unknown>> {
  if (spec.group) return aggregateRow(spec, row);
  return awardRow(row, { fullText });
}

async function aggregateRow(spec: ListSpec, row: Record<string, unknown>) {
  let out: Record<string, unknown>;
  switch (spec.group) {
    case "organization": {
      const meta = organizationMeta(row.organization__key as string);
      const recordKind = meta?.record_kind ?? null;
      out = {
        id: row.organization_id,
        key: row.organization__key,
        name: row.organization__name,
        record_kind: recordKind,
        measure: recordKind ? MEASURES[recordKind] : null,
        ministry_noun: meta?.ministry_noun ?? "Ministry",
        source: meta?.source ?? null,
        source_url: meta?.source_url ?? null,
        licence: meta?.licence ?? null,
        licence_url: meta?.licence_url ?? null,
        attribution: meta?.attribution ?? null,
        fiscal_years: await fiscalYears(row.organization_id as number),
      };
      break;
    }
    case "ministry":
      out = { id: row.ministry_id, name: row.ministry__name };
      break;
    case "program":
      out = { id: row.program_id, name: row.program__name ?? NO_PROGRAM };
      break;
    default:
      out = {
        id: row.recipient_id,
        name: row.recipient__display_name,
        key: row.recipient__name,
        is_placeholder: row.recipient__is_placeholder,
      };
  }
  for (const col of spec.columns) {
    if (col.aggregate)
      out[col.key] = col.type === "money" ? amount(row[col.key]) : Number(row[col.key] ?? 0);
  }
  return out;
}

function trimDescription(description: unknown, fullText: boolean) {
  if (typeof description !== "string" || fullText) return description ?? null;
  const chars = Array.from(description);
  if (chars.length <= LIST_DESCRIPTION_CHARS) return description;
  return `${chars.slice(0, LIST_DESCRIPTION_CHARS).join("").trimEnd()}…`;
}

export function awardRow(row: Record<string, unknown>, { fullText = false } = {}) {
  const startDate = row.start_date as string | null;
  return {
    id: row.id,
    reference: row.reference,
    agreement_number: row.agreement_number,
    record_kind: row.record_kind,
    recipient: row.recipient__display_name,
    recipient_id: row.recipient_id,
    recipient_is_placeholder: row.recipient__is_placeholder,
    ministry: row.ministry__name,
    ministry_id: row.ministry_id,
    program: row.program__name,
    program_id: row.program_id,
    value: amount(row.value),
    start_date: startDate,
    start_date_estimated: row.start_date_estimated,
    fiscal_year: startDate ? fiscalYearOf(startDate) : null,
    end_date: row.end_date,
    agreement_type: row.agreement_type,
    title: row.title,
    description: trimDescription(row.description, fullText),
    recipient_type: row.recipient_type,
    recipient_province: row.recipient_province,
    recipient_city: row.recipient_city,
    naics: row.naics,
    amendment_number: row.amendment_number,
    amendment_date: row.amendment_date,
    is_current: row.is_current,
    lottery_fund: row.lottery_fund,
    business_unit: row.business_unit,
    source_file: row.source_file,
    import_date: row.import_date,
  };
}
