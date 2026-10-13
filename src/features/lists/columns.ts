import {
  AMENDMENT_COLUMNS,
  appliesTo,
  COLUMNS,
  resolveColumn,
} from "@/features/table/columns/registry";
import type { RecordKind } from "@/lib/record-kind";

import type { ColumnSpec, ListColumn, ListConfig } from "./types";

/**
 * Every column a list offers for an organization, in display order: the
 * defaults, then the extras, with headers for its kind of record. Columns
 * only one government's data has are left out for the other's, and until the
 * organization is known.
 */
export function listColumns(config: ListConfig, kind: RecordKind | undefined): ListColumn[] {
  return [...config.columns, ...(config.extraColumns ?? [])]
    .map(toSpec)
    .filter(({ id }) => appliesTo(COLUMNS[id], kind))
    .map(({ id, link }) => ({ ...resolveColumn(COLUMNS[id], kind), link }));
}

/**
 * Ids of the columns shown when the URL doesn't choose: with superseded
 * amendments included, the amendment columns that tell them apart too
 */
export function defaultColumnIds(
  available: ListColumn[],
  config: ListConfig,
  { includeSuperseded = false } = {},
) {
  const defaults = new Set<string>(config.columns.map((spec) => toSpec(spec).id));
  if (includeSuperseded) {
    for (const id of AMENDMENT_COLUMNS) defaults.add(id);
  }
  return available.filter(({ id }) => defaults.has(id)).map(({ id }) => id);
}

function toSpec(spec: ColumnSpec) {
  return typeof spec === "string" ? { id: spec } : spec;
}
