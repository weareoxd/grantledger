import type { MatchMode, Operator } from "../state/schema";

/**
 * How a column's values are shown, filtered and edited:
 * - text: free text (contains / starts with / ...)
 * - number, currency: amounts and counts (=, <, between, ...)
 * - fiscalYear: April-March years (FY2024 = Apr 2024 - Mar 2025)
 * - date: date-only values (on, before, after, between)
 * - enum: one of a fixed set of options
 * - boolean: a yes/no flag
 */
export type ColumnKind =
  | "text"
  | "number"
  | "currency"
  | "fiscalYear"
  | "date"
  | "enum"
  | "boolean";

export type ColumnOption = { value: string; label: string };

export type ColumnDefinition = {
  /** Field name in the API (rows, filters, sort) */
  id: string;
  header: string;
  kind: ColumnKind;
  sortable: boolean;
  filterable: boolean;
  /** Stays in view when scrolling sideways, if at the start of the table */
  frozen?: boolean;
  /** Fixed width in px (frozen and narrow columns) */
  width?: number;
  options?: ColumnOption[];
  /** Column picker section */
  group?: string;
};

export type FilterKindConfig = {
  modes: MatchMode[];
  defaultMode: MatchMode;
  defaultOperator: Operator;
};
