/**
 * Column specs for every list the web API serves. This module is the API's allowlist.
 *
 * A column says what a list returns, filters on and sorts by. Award columns take their SQL from
 * the MCP schema (AWARD_FIELDS), so the web API can't reach a field the MCP allowlist doesn't
 * already expose. Aggregated lists read `award_rollup`, so their name columns are relative to it
 * (aliases: ru, and o/m/p/r for its organization, ministry, program and recipient) and their
 * count/value columns are computed on the server; a request can only pick column keys, never
 * expressions.
 */
import { type SQL, sql } from "drizzle-orm";
import type { RecordKind } from "@/lib/domain";
import { AGREEMENT_TYPES, RECIPIENT_TYPES } from "@/lib/grants/constants";
import { AWARD_FIELDS } from "@/lib/mcp/schema";

export const AGREEMENT: RecordKind = "agreement";
export const PAYMENT: RecordKind = "payment";
const BOTH: readonly RecordKind[] = [AGREEMENT, PAYMENT];

export type ColumnType = "text" | "int" | "money" | "date" | "fiscal_year" | "code" | "bool";

export const TYPE_OPERATORS: Record<ColumnType, string[]> = {
  text: ["contains", "not_contains", "startswith", "endswith", "eq", "ne"],
  int: ["eq", "ne", "lt", "lte", "gt", "gte", "between"],
  money: ["eq", "ne", "lt", "lte", "gt", "gte", "between"],
  date: ["eq", "ne", "lt", "lte", "gt", "gte", "between"],
  fiscal_year: ["eq", "ne", "lt", "lte", "gt", "gte", "between"],
  code: ["eq", "ne", "in"],
  bool: ["eq"],
};

/** The web UI's match modes (the query grammar's), as the operators above. */
export const MATCH_MODES: Record<string, string> = {
  equals: "eq",
  notEquals: "ne",
  contains: "contains",
  notContains: "not_contains",
  startsWith: "startswith",
  endsWith: "endswith",
  lt: "lt",
  lte: "lte",
  gt: "gt",
  gte: "gte",
  between: "between",
  in: "in",
};

export type GroupKind = "organization" | "ministry" | "program" | "recipient";

export interface Column {
  key: string;
  type: ColumnType;
  label: string;
  /** Record kind -> label override. */
  labels: Partial<Record<RecordKind, string>>;
  /** Record kinds the column applies to. */
  kinds: readonly RecordKind[];
  /** SQL on the list's base query; null for aggregates. */
  path: SQL | null;
  /** Computed per group, filtered with HAVING. */
  aggregate: boolean;
  sortable: boolean;
  filterable: boolean;
  /** Shown by default. */
  visible: boolean;
  /** Code -> label, for code columns. */
  options: Record<string, string>;
  sortPath: SQL | null;
  /** Recipient names: match against the normalised key. */
  normalize: boolean;
}

export interface ListSpec {
  kind: string;
  /** organization / ministry / program / recipient; null = award rows. */
  group: GroupKind | null;
  columns: Column[];
  defaultSort: string;
  footer: string[];
  /** hide_placeholders applies. */
  placeholders: boolean;
  /** include_superseded applies. */
  superseded: boolean;
}

function column(
  key: string,
  type: ColumnType,
  label: string,
  options: Partial<Omit<Column, "key" | "type" | "label">> = {},
): Column {
  return {
    key,
    type,
    label,
    labels: {},
    kinds: BOTH,
    path: null,
    aggregate: false,
    sortable: true,
    filterable: true,
    visible: true,
    options: {},
    sortPath: null,
    normalize: false,
    ...options,
  };
}

export function labelFor(col: Column, kind: RecordKind | null) {
  return (kind && col.labels[kind]) || col.label;
}

export function appliesTo(col: Column, kind: RecordKind | null) {
  return kind === null || col.kinds.includes(kind);
}

export function specColumn(spec: ListSpec, key: string): Column | undefined {
  return spec.columns.find((col) => col.key === key);
}

export function applicable(spec: ListSpec, kind: RecordKind | null): Column[] {
  return spec.columns.filter((col) => appliesTo(col, kind));
}

// --- aggregated-list columns (paths relative to award_rollup) ----------------------------

const count = (key: string, label: string, labels: Partial<Record<RecordKind, string>> = {}) =>
  column(key, "int", label, { labels, aggregate: true });

const AWARD_COUNT = count("award_count", "Awards", {
  agreement: "Agreements",
  payment: "Payments",
});
const AWARD_VALUE = column("award_value", "money", "Value", {
  labels: { agreement: "Agreement value", payment: "Amount paid" },
  aggregate: true,
});
const MINISTRY_COUNT = count("ministry_count", "Ministries", {
  agreement: "Departments",
  payment: "Ministries",
});
const RECIPIENT_COUNT = count("recipient_count", "Recipients");
const PROGRAM_COUNT = count("program_count", "Programs");

const id = (path: string) => column("id", "int", "Id", { path: sql.raw(path), visible: false });

const ORGANIZATION_NAME = column("name", "text", "Organization", { path: sql.raw("o.name") });
const MINISTRY_NAME = column("name", "text", "Ministry", {
  labels: { agreement: "Department", payment: "Ministry" },
  path: sql.raw("m.name"),
});
const PROGRAM_NAME = column("name", "text", "Program", { path: sql.raw("p.name") });
const RECIPIENT_NAME = column("name", "text", "Recipient", {
  path: sql.raw("r.name"),
  normalize: true,
});
const MEASURE = column("measure", "text", "Measure", { sortable: false, filterable: false });

/** The aggregate expressions over award_rollup (ru). */
export const AGGREGATES: Record<string, SQL> = {
  award_count: sql.raw("SUM(ru.n_awards)"),
  award_value: sql.raw("SUM(ru.total_value)"),
  ministry_count: sql.raw("COUNT(DISTINCT ru.ministry_id)"),
  recipient_count: sql.raw("COUNT(DISTINCT ru.recipient_id)"),
  program_count: sql.raw("COUNT(DISTINCT ru.program_id)"),
};

// --- award columns (SQL from the MCP allowlist) ------------------------------------------

function award(
  key: string,
  type: ColumnType,
  label: string,
  options: Partial<Omit<Column, "key" | "type" | "label">> = {},
): Column {
  const field = AWARD_FIELDS[key];
  if (!field) throw new Error(`No award field ${key} in the MCP allowlist`);
  return column(key, type, label, { path: field.sql, ...options });
}

export const AWARD_COLUMNS: Column[] = [
  award("id", "int", "Id", { visible: false }),
  award("reference", "text", "Reference", { kinds: [AGREEMENT] }),
  award("agreement_number", "text", "Agreement number", { kinds: [AGREEMENT], visible: false }),
  award("recipient", "text", "Recipient", { normalize: true }),
  award("ministry", "text", "Ministry", { labels: { agreement: "Department" } }),
  award("program", "text", "Program"),
  award("value", "money", "Value", {
    labels: { agreement: "Agreement value", payment: "Amount paid" },
  }),
  award("start_date", "date", "Start date", { labels: { payment: "Payment date" } }),
  award("fiscal_year", "fiscal_year", "Fiscal year", { sortPath: sql.raw("a.start_date") }),
  award("end_date", "date", "End date", { kinds: [AGREEMENT] }),
  award("agreement_type", "code", "Agreement type", {
    kinds: [AGREEMENT],
    options: AGREEMENT_TYPES,
  }),
  award("title", "text", "Title", { kinds: [AGREEMENT] }),
  award("description", "text", "Description", {
    kinds: [AGREEMENT],
    sortable: false,
    visible: false,
  }),
  award("recipient_type", "code", "Recipient type", {
    kinds: [AGREEMENT],
    options: RECIPIENT_TYPES,
    visible: false,
  }),
  award("recipient_province", "text", "Province", { kinds: [AGREEMENT], visible: false }),
  award("recipient_city", "text", "City", { kinds: [AGREEMENT], visible: false }),
  award("naics", "text", "NAICS code", { kinds: [AGREEMENT], visible: false }),
  award("amendment_number", "int", "Amendment", { kinds: [AGREEMENT], visible: false }),
  award("amendment_date", "date", "Amendment date", { kinds: [AGREEMENT], visible: false }),
  award("is_current", "bool", "Latest amendment", { kinds: [AGREEMENT], visible: false }),
  award("lottery_fund", "bool", "Lottery fund", { kinds: [PAYMENT] }),
  award("business_unit", "text", "Business unit", { kinds: [PAYMENT], visible: false }),
  award("start_date_estimated", "bool", "Date estimated", { kinds: [PAYMENT], visible: false }),
  award("source_file", "text", "Source file", { visible: false }),
  award("import_date", "date", "Import date", { visible: false }),
];

const AGG_FOOTER = ["award_count", "award_value"];

function spec(
  kind: string,
  group: GroupKind | null,
  columns: Column[],
  defaultSort: string,
  options: Partial<Pick<ListSpec, "footer" | "placeholders" | "superseded">> = {},
): ListSpec {
  return {
    kind,
    group,
    columns,
    defaultSort,
    footer: AGG_FOOTER,
    placeholders: false,
    superseded: false,
    ...options,
  };
}

export const LIST_SPECS: Record<string, ListSpec> = Object.fromEntries(
  [
    spec(
      "organizations",
      "organization",
      [
        id("ru.organization_id"),
        ORGANIZATION_NAME,
        MEASURE,
        MINISTRY_COUNT,
        RECIPIENT_COUNT,
        AWARD_COUNT,
        AWARD_VALUE,
      ],
      "name",
      { footer: ["award_count"] },
    ),
    spec(
      "org_ministries",
      "ministry",
      [
        id("ru.ministry_id"),
        MINISTRY_NAME,
        PROGRAM_COUNT,
        RECIPIENT_COUNT,
        AWARD_COUNT,
        AWARD_VALUE,
      ],
      "name",
    ),
    spec(
      "ministry_programs",
      "program",
      [id("ru.program_id"), PROGRAM_NAME, RECIPIENT_COUNT, AWARD_COUNT, AWARD_VALUE],
      "name",
      { placeholders: true },
    ),
    spec(
      "ministry_recipients",
      "recipient",
      [id("ru.recipient_id"), RECIPIENT_NAME, AWARD_COUNT, AWARD_VALUE],
      "name",
      { placeholders: true },
    ),
    spec(
      "program_recipients",
      "recipient",
      [id("ru.recipient_id"), RECIPIENT_NAME, AWARD_COUNT, AWARD_VALUE],
      "name",
      { placeholders: true },
    ),
    spec(
      "org_recipients",
      "recipient",
      [id("ru.recipient_id"), RECIPIENT_NAME, MINISTRY_COUNT, AWARD_COUNT, AWARD_VALUE],
      "name",
      { placeholders: true },
    ),
    spec(
      "recipient_ministries",
      "ministry",
      [id("ru.ministry_id"), MINISTRY_NAME, AWARD_COUNT, AWARD_VALUE],
      "name",
    ),
    spec("awards", null, AWARD_COLUMNS, "-start_date", {
      footer: ["value"],
      placeholders: true,
      superseded: true,
    }),
  ].map((s) => [s.kind, s]),
);
