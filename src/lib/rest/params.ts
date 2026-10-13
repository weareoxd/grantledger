/**
 * Parse and validate a list request into canonical ListParams.
 *
 * The grammar is the web UI's (src/features/table/state/api-params.ts):
 *
 * - `page` and `page_size` (1 to 100, default 25)
 * - `sort=<column>&sort_order=asc|desc`
 * - `<column>[<i>][value]=...&<column>[<i>][matchMode]=...` per condition (i = 0, 1, ...), with
 *   `<column>[operator]=or` combining that column's conditions with OR (default AND). Different
 *   columns are always ANDed.
 * - flat `fiscal_year`, `hide_placeholders` and `include_superseded`
 *
 * Every name is checked against the list's columns for the organization's record kind. An
 * unknown column, match mode or value is a 400 in the `{"<field>": ["<message>"]}` shape, which
 * the UI shows on that column's filter. Canonical params also make stable cache keys (parameter
 * order and defaults don't matter).
 */
import type { RecordKind } from "@/lib/domain";
import { applicable, type Column, type ListSpec, MATCH_MODES, TYPE_OPERATORS } from "./columns";
import { invalid, notFound } from "./errors";

export const MAX_PAGE_SIZE = 100;
export const DEFAULT_PAGE_SIZE = 25;
const MAX_FILTER_COLUMNS = 20;
const MAX_CONDITIONS = 30;
const MAX_TEXT = 200;
const MAX_IN_VALUES = 50;
const FISCAL_YEAR_RANGE: [number, number] = [1900, 2100];
// Award values are numeric(18, 2): a filter amount past that can't be compared. Checked by
// exponent, not by arithmetic, which overflows on an amount like 1e99999999
const MAX_MONEY_DIGITS = 16;
const MAX_INT = 2n ** 63n;
const FLAT_PARAMS = new Set([
  "page",
  "page_size",
  "sort",
  "sort_order",
  "fiscal_year",
  "hide_placeholders",
  "include_superseded",
]);
const FLAGS: Record<string, boolean> = {
  "1": true,
  true: true,
  yes: true,
  "0": false,
  false: false,
  no: false,
  "": false,
};

/** A condition's value: a scalar, or a pair (between) or list (in) of them. */
export type FilterValue = string | number | boolean | FilterValue[];

export interface FilterGroup {
  key: string;
  match: "all" | "any";
  rules: [op: string, value: FilterValue][];
}

export interface ListParams {
  page: number;
  page_size: number;
  /** A column key, "-" first for descending. */
  sort: string;
  filters: FilterGroup[];
  fiscal_year: number | null;
  include_superseded: boolean;
  hide_placeholders: boolean;
}

/** Canonical JSON of the params (minus `without`), for cache keys. */
export function identity(params: ListParams, without: (keyof ListParams)[] = []) {
  const data = Object.fromEntries(
    Object.entries(params)
      .filter(([key]) => !without.includes(key as keyof ListParams))
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return JSON.stringify(data);
}

export function offset(params: ListParams) {
  return (params.page - 1) * params.page_size;
}

/** The last value given for a name, as Django's QueryDict.get reads it. */
function last(query: URLSearchParams, name: string): string | null {
  const values = query.getAll(name);
  return values.length ? (values[values.length - 1] as string) : null;
}

function integer(raw: string | null): number | null {
  if (raw === null) return null;
  const text = raw.trim();
  if (!/^[+-]?\d+(_\d+)*$/.test(text)) return null;
  const value = Number(text.replaceAll("_", ""));
  return Number.isSafeInteger(value) ? value : null;
}

/**
 * `[page, page_size]` as DRF's paginator reads them: a page size that isn't a positive number is
 * the default, one past the maximum the maximum; a page that isn't one is a 404.
 */
export function parsePage(query: URLSearchParams): [number, number] {
  const rawSize = last(query, "page_size");
  let pageSize = rawSize === null ? DEFAULT_PAGE_SIZE : (integer(rawSize) ?? DEFAULT_PAGE_SIZE);
  pageSize = pageSize < 1 ? DEFAULT_PAGE_SIZE : Math.min(pageSize, MAX_PAGE_SIZE);
  const raw = last(query, "page") || "1";
  const page = /^[0-9]+$/.test(raw) ? Number(raw) : 0;
  if (!(page >= 1) || !Number.isSafeInteger(page)) throw notFound("Invalid page.");
  return [page, pageSize];
}

/**
 * `kind` is the organization's record kind (null on the home list). Without `paging` (a CSV
 * export), `page` and `page_size` are ignored.
 */
export function parseParams(
  query: URLSearchParams,
  spec: ListSpec,
  kind: RecordKind | null,
  { paging = true } = {},
): ListParams {
  const columns = new Map(applicable(spec, kind).map((col) => [col.key, col]));
  const [page, pageSize] = paging ? parsePage(query) : [1, DEFAULT_PAGE_SIZE];

  let sort = last(query, "sort") || "";
  if (sort) {
    const col = columns.get(sort);
    if (!col || !col.sortable) throw invalid("sort", `Unknown sort field '${sort}'.`);
    sort = last(query, "sort_order") === "desc" ? `-${sort}` : sort;
  } else {
    sort = spec.defaultSort;
  }

  let fiscalYear: number | null = null;
  const rawYear = last(query, "fiscal_year");
  if (rawYear) {
    fiscalYear = integer(rawYear);
    if (
      fiscalYear === null ||
      fiscalYear < FISCAL_YEAR_RANGE[0] ||
      fiscalYear > FISCAL_YEAR_RANGE[1]
    ) {
      throw invalid("fiscal_year", "A fiscal year such as 2024 is required.");
    }
  }

  const includeSuperseded = flag(query, "include_superseded");
  if (includeSuperseded && !spec.superseded) {
    throw invalid("include_superseded", "Doesn't apply to this list.");
  }
  const hidePlaceholders = flag(query, "hide_placeholders");
  if (hidePlaceholders && !spec.placeholders) {
    throw invalid("hide_placeholders", "Doesn't apply to this list.");
  }

  return {
    page,
    page_size: pageSize,
    sort,
    filters: parseFilters(query, columns),
    fiscal_year: fiscalYear,
    include_superseded: includeSuperseded,
    hide_placeholders: hidePlaceholders,
  };
}

function flag(query: URLSearchParams, name: string): boolean {
  const text = (last(query, name) ?? "").trim().toLowerCase();
  if (!(text in FLAGS)) throw invalid(name, "Must be true or false.");
  return FLAGS[text] as boolean;
}

/**
 * Group the filter params by column: `{column: [operator, [[value, matchMode], ...]]}`.
 *
 * A condition with an empty value or no match mode (one the user cleared) is inert and dropped;
 * a column whose conditions are all inert comes back with none. Any other param that isn't a
 * list's own (`page`, `sort`, ...) is unknown: a 400, so a misspelt `fiscal_year` can't quietly
 * return every year.
 */
export function filterParams(query: URLSearchParams) {
  const grouped = new Map<string, Map<string, Map<string, string | null>>>();
  for (const param of new Set(query.keys())) {
    if (FLAT_PARAMS.has(param)) continue;
    const bracketAt = param.indexOf("[");
    if (bracketAt === -1) throw invalid(param, "Unknown parameter.");
    const column = param.slice(0, bracketAt);
    const rest = param.slice(bracketAt + 1);
    const closeAt = rest.indexOf("]");
    const index = closeAt === -1 ? rest : rest.slice(0, closeAt);
    const subParam = (closeAt === -1 ? "" : rest.slice(closeAt + 1)).replace(
      /^[[\]]+|[[\]]+$/g,
      "",
    );
    const entries = grouped.get(column) ?? new Map();
    grouped.set(column, entries);
    const entry = entries.get(index) ?? new Map();
    entries.set(index, entry);
    entry.set(subParam, last(query, param));
  }

  const parsed = new Map<string, [string | null | undefined, [string, string][]]>();
  for (const [column, entries] of grouped) {
    const operator = entries.get("operator")?.get("");
    entries.delete("operator");
    const conditions = [...entries.entries()]
      .sort(([a], [b]) => (integer(a) || 0) - (integer(b) || 0))
      .filter(([, entry]) => {
        const value = entry.get("value");
        return value !== undefined && value !== null && value !== "" && entry.get("matchMode");
      })
      .map(
        ([, entry]) =>
          [entry.get("value") as string, entry.get("matchMode") as string] as [string, string],
      );
    parsed.set(column, [operator, conditions]);
  }
  return parsed;
}

function parseFilters(query: URLSearchParams, columns: Map<string, Column>): FilterGroup[] {
  const groups: FilterGroup[] = [];
  const entries = [...filterParams(query).entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  for (const [key, [operator, conditions]] of entries) {
    if (!conditions.length) continue;
    const col = columns.get(key);
    if (!col || !col.filterable) throw invalid(key, `Unknown filter field '${key}'.`);
    if (groups.length === MAX_FILTER_COLUMNS) {
      throw invalid(key, `At most ${MAX_FILTER_COLUMNS} columns can be filtered at once.`);
    }
    if (conditions.length > MAX_CONDITIONS) {
      throw invalid(key, `At most ${MAX_CONDITIONS} conditions per column.`);
    }
    const rules: [string, FilterValue][] = [];
    for (const [value, matchMode] of conditions) {
      const op = MATCH_MODES[matchMode];
      if (!op || !TYPE_OPERATORS[col.type].includes(op)) {
        throw invalid(key, `Unsupported matchMode '${matchMode}'.`);
      }
      const converted = convert(col, op, value);
      if (converted === null) throw invalid(key, `Invalid value for '${key}'.`);
      rules.push([op, converted]);
    }
    groups.push({ key, match: operator === "or" ? "any" : "all", rules });
  }
  return groups;
}

/** One condition's value, checked and made canonical; null if it's invalid. */
function convert(col: Column, op: string, raw: string): FilterValue | null {
  if (raw.includes("\u0000")) return null;
  if (op === "between") {
    const parts = raw.split(",");
    if (parts.length !== 2) return null;
    const pair = parts.map((part) => scalar(col, part));
    return pair.includes(null) ? null : (pair as FilterValue[]);
  }
  if (op === "in") {
    const parts = raw.split(",").filter((part) => part.trim());
    if (parts.length < 1 || parts.length > MAX_IN_VALUES) return null;
    const values = parts.map((part) => scalar(col, part));
    return values.includes(null) ? null : (values as FilterValue[]);
  }
  return scalar(col, raw);
}

const DECIMAL = /^([+-]?)((?:\d+(?:_\d+)*)?)(?:\.(\d*(?:_\d+)*))?(?:[eE]([+-]?\d+))?$/;

/**
 * A money amount as Python's Decimal reads it, returned as a plain decimal string, or null when
 * it isn't one or has more than MAX_MONEY_DIGITS digits before the point.
 */
export function moneyValue(text: string): string | null {
  const match = DECIMAL.exec(text.replaceAll("$", "").trim());
  if (!match) return null;
  const [, sign = "", intRaw = "", fracRaw = "", expRaw = "0"] = match;
  const intPart = intRaw.replaceAll("_", "");
  const fracPart = fracRaw.replaceAll("_", "");
  if (!intPart && !fracPart) return null;
  const exponent = Number(expRaw);
  if (!Number.isFinite(exponent)) return null;
  const coefficient = (intPart + fracPart).replace(/^0+/, "") || "0";
  const exp = exponent - fracPart.length;
  const adjusted = coefficient === "0" ? exp : exp + coefficient.length - 1;
  if (adjusted >= MAX_MONEY_DIGITS) return null;
  if (coefficient === "0") return "0";
  // Write it out without an exponent
  if (exp >= 0) return `${sign === "-" ? "-" : ""}${coefficient}${"0".repeat(exp)}`;
  const digits = coefficient.padStart(-exp + 1, "0");
  const whole = digits.slice(0, exp);
  const frac = digits.slice(exp).replace(/0+$/, "");
  return `${sign === "-" ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

function isoDate(text: string): string | null {
  const match = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(text);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = new Date(`${y}-${m}-${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== `${y}-${m}-${d}`) {
    return null;
  }
  return `${y}-${m}-${d}`;
}

function scalar(col: Column, raw: string): string | number | boolean | null {
  const text = raw.trim();
  switch (col.type) {
    case "text":
      return text && Array.from(text).length <= MAX_TEXT ? text : null;
    case "int": {
      if (!/^[+-]?\d+(_\d+)*$/.test(text)) return null;
      const value = BigInt(text.replaceAll("_", ""));
      if ((value < 0n ? -value : value) >= MAX_INT) return null;
      return Number.isSafeInteger(Number(value)) ? Number(value) : value.toString();
    }
    case "money":
      return moneyValue(text);
    case "date":
      return isoDate(text);
    case "fiscal_year": {
      const year = integer(text);
      return year !== null && year >= FISCAL_YEAR_RANGE[0] && year <= FISCAL_YEAR_RANGE[1]
        ? year
        : null;
    }
    case "code":
      return text in col.options ? text : null;
    case "bool": {
      const lower = text.toLowerCase();
      return text && lower in FLAGS ? (FLAGS[lower] as boolean) : null;
    }
  }
}
