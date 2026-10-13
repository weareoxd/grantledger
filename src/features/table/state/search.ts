import {
  type Constraint,
  FIELD_PATTERN,
  type FieldFilter,
  type Filters,
  MATCH_MODES,
  MAX_CONSTRAINTS,
  type MatchMode,
} from "./schema";

/**
 * The router's URL search codec. Table state is written as readable, short
 * params rather than JSON:
 *
 *   ?page=2&size=50&sort=-value&cols=recipient,value&fy=2024
 *    &f=recipient:contains:society&f=recipient:contains:centre&op=recipient:or
 *    &f=value:between:1000,5000
 *
 * - `sort`: field, `-` prefix for descending
 * - `cols`: a comma-separated list
 * - `fy`: the fiscal year an aggregated list totals; `hide_placeholders`,
 *   `include_superseded`: 1 when on
 * - `f=<field>:<matchMode>:<value>`, repeated, one per condition; the value
 *   is everything after the second colon
 * - `op=<field>:or` ORs that field's conditions (AND otherwise)
 *
 * Other params pass through as strings. Validation happens per route
 * (`validateSearch`).
 */

const LIST_PARAMS = new Set(["cols"]);
const NUMBER_PARAMS = new Set(["page", "size", "fy", "hide_placeholders", "include_superseded"]);
// Written first, in this order, so equivalent states have identical URLs
const KEY_ORDER = ["page", "size", "sort", "cols", "fy", "hide_placeholders", "include_superseded"];

export function parseSearch(searchStr: string): Record<string, unknown> {
  const params = new URLSearchParams(searchStr.startsWith("?") ? searchStr.slice(1) : searchStr);
  const search: Record<string, unknown> = {};
  const filters: Filters = {};
  const orFields = new Set<string>();

  for (const [key, value] of params) {
    if (key === "f") {
      const parsed = parseFilterParam(value);
      if (!parsed) continue;
      const filter = filters[parsed.field] ?? { operator: "and", constraints: [] };
      filters[parsed.field] = filter;
      if (filter.constraints.length < MAX_CONSTRAINTS) {
        filter.constraints.push(parsed.constraint);
      }
    } else if (key === "op") {
      const [field, operator] = splitOnce(value, ":");
      if (operator === "or" && FIELD_PATTERN.test(field)) orFields.add(field);
    } else if (NUMBER_PARAMS.has(key)) {
      search[key] = /^\d+$/.test(value) ? Number(value) : value;
    } else if (LIST_PARAMS.has(key)) {
      search[key] = value.split(",").filter(Boolean);
    } else {
      search[key] = value;
    }
  }

  for (const field of orFields) {
    if (filters[field]) filters[field].operator = "or";
  }
  if (Object.keys(filters).length > 0) search.filters = filters;
  return search;
}

export function stringifySearch(search: Record<string, unknown>): string {
  const parts: string[] = [];
  const add = (key: string, value: string) => parts.push(`${encode(key)}=${encode(value)}`);

  const keys = [
    ...KEY_ORDER.filter((key) => key in search),
    ...Object.keys(search).filter((key) => !KEY_ORDER.includes(key) && key !== "filters"),
  ];
  for (const key of keys) {
    const value = search[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) add(key, value.join(","));
    } else if (typeof value === "object") {
      add(key, JSON.stringify(value));
    } else {
      add(key, String(value));
    }
  }

  const filters = search.filters as Filters | undefined;
  for (const [field, filter] of Object.entries(filters ?? {})) {
    for (const { matchMode, value } of filter.constraints) {
      add("f", `${field}:${matchMode}:${value}`);
    }
  }
  for (const [field, filter] of Object.entries(filters ?? {})) {
    if (filter.operator === "or" && filter.constraints.length > 1) {
      add("op", `${field}:or`);
    }
  }

  return parts.length > 0 ? `?${parts.join("&")}` : "";
}

/** `recipient:contains:society` -> field + constraint, or null when malformed */
export function parseFilterParam(param: string): { field: string; constraint: Constraint } | null {
  const [field, rest] = splitOnce(param, ":");
  const [matchMode, value] = splitOnce(rest, ":");
  if (!FIELD_PATTERN.test(field) || !isMatchMode(matchMode) || !value) {
    return null;
  }
  return { field, constraint: { matchMode, value } };
}

export function isMatchMode(value: string): value is MatchMode {
  return (MATCH_MODES as readonly string[]).includes(value);
}

export function isFieldFilter(value: unknown): value is FieldFilter {
  return (
    typeof value === "object" && value !== null && Array.isArray((value as FieldFilter).constraints)
  );
}

function splitOnce(value: string, separator: string): [string, string] {
  const index = value.indexOf(separator);
  return index === -1
    ? [value, ""]
    : [value.slice(0, index), value.slice(index + separator.length)];
}

// encodeURIComponent, but leaving the characters the grammar uses readable.
// All are allowed unescaped in a query string (RFC 3986)
function encode(value: string) {
  return encodeURIComponent(value).replace(/%(?:3A|2C|2F|40)/gi, (escaped) =>
    decodeURIComponent(escaped),
  );
}
