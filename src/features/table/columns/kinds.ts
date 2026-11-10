import type { MatchMode } from "../state/schema";
import type { ColumnKind, FilterKindConfig } from "./types";

/** Match modes the filter UI offers per kind; the first is the default */
export const FILTER_KINDS: Record<ColumnKind, FilterKindConfig> = {
  text: {
    modes: ["contains", "notContains", "startsWith", "endsWith", "equals", "notEquals"],
    defaultMode: "contains",
    defaultOperator: "or",
  },
  number: {
    modes: ["equals", "notEquals", "gte", "lte", "gt", "lt", "between"],
    defaultMode: "equals",
    defaultOperator: "and",
  },
  currency: {
    modes: ["gte", "lte", "between", "equals", "notEquals", "gt", "lt"],
    defaultMode: "gte",
    defaultOperator: "and",
  },
  fiscalYear: {
    modes: ["equals", "notEquals", "between", "gte", "lte", "gt", "lt"],
    defaultMode: "equals",
    defaultOperator: "or",
  },
  date: {
    // "on or before/after" too: the overviews' links use them
    modes: ["between", "equals", "notEquals", "lte", "gte", "lt", "gt"],
    defaultMode: "between",
    defaultOperator: "and",
  },
  enum: {
    modes: ["equals", "notEquals"],
    defaultMode: "equals",
    defaultOperator: "or",
  },
  boolean: {
    modes: ["equals"],
    defaultMode: "equals",
    defaultOperator: "and",
  },
};

const TEXT_LABELS: Partial<Record<MatchMode, string>> = {
  contains: "contains",
  notContains: "doesn't contain",
  startsWith: "starts with",
  endsWith: "ends with",
  equals: "is",
  notEquals: "is not",
};

const NUMBER_LABELS: Partial<Record<MatchMode, string>> = {
  equals: "=",
  notEquals: "≠",
  gte: "≥",
  lte: "≤",
  gt: ">",
  lt: "<",
  between: "between",
  in: "is one of",
};

const DATE_LABELS: Partial<Record<MatchMode, string>> = {
  equals: "is on",
  notEquals: "isn't on",
  lt: "is before",
  gt: "is after",
  lte: "is on or before",
  gte: "is on or after",
  between: "is between",
};

/** How a match mode reads for a column kind: "contains", "≥", "is before" */
export function matchModeLabel(kind: ColumnKind, mode: MatchMode) {
  const labels =
    kind === "text" || kind === "enum"
      ? TEXT_LABELS
      : kind === "date"
        ? DATE_LABELS
        : NUMBER_LABELS;
  return labels[mode] ?? mode;
}

/** Modes whose value is a `low,high` pair */
export const isRangeMode = (mode: MatchMode) => mode === "between";
