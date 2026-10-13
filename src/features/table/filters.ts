import type { ListColumn } from "@/features/lists/types";
import { formatDate, formatNumber, formatRoundedCurrency } from "@/lib/format";

import { FILTER_KINDS, matchModeLabel } from "./columns/kinds";
import type { ColumnKind } from "./columns/types";
import {
  type Constraint,
  type FieldFilter,
  MAX_CONSTRAINTS,
  type MatchMode,
  type Operator,
} from "./state/schema";

/** One condition as edited: a range keeps its two ends separately */
export type DraftCondition = { mode: MatchMode; value: string; to: string };
export type Draft = { operator: Operator; conditions: DraftCondition[] };

export function emptyCondition(kind: ColumnKind): DraftCondition {
  return { mode: FILTER_KINDS[kind].defaultMode, value: "", to: "" };
}

export function toDraft(column: ListColumn, filter?: FieldFilter): Draft {
  const kind = FILTER_KINDS[column.kind];
  if (!filter || filter.constraints.length === 0) {
    return {
      operator: kind.defaultOperator,
      conditions: [emptyCondition(column.kind)],
    };
  }
  return {
    // One condition has no real operator (the URL doesn't keep it): use the
    // kind's, so adding a second condition starts from it
    operator: filter.constraints.length > 1 ? filter.operator : kind.defaultOperator,
    conditions: filter.constraints.map(({ matchMode, value }) => {
      if (matchMode !== "between") return { mode: matchMode, value, to: "" };
      const [from = "", to = ""] = value.split(",");
      return { mode: matchMode, value: from, to };
    }),
  };
}

/**
 * The draft as a filter, without its blank conditions; undefined when
 * nothing is left. A range with one end becomes a one-sided comparison.
 */
export function fromDraft(draft: Draft): FieldFilter | undefined {
  const constraints = draft.conditions.flatMap(({ mode, value, to }): Constraint[] => {
    // Exactly as written for "equals": a value a link carries is matched
    // as it is, spaces and all
    const exact = mode === "equals" || mode === "notEquals";
    const from = exact && value.trim() ? value : value.trim();
    const until = to.trim();
    if (mode !== "between") return from ? [{ matchMode: mode, value: from }] : [];
    if (from && until) {
      return [{ matchMode: mode, value: `${from},${until}` }];
    }
    if (from) return [{ matchMode: "gte", value: from }];
    if (until) return [{ matchMode: "lte", value: until }];
    return [];
  });
  return constraints.length > 0
    ? {
        operator: draft.operator,
        constraints: constraints.slice(0, MAX_CONSTRAINTS),
      }
    : undefined;
}

/** A filter in words: `Value ≥ $10K`, `Recipient contains "society" or "centre"` */
export function describeFilter(column: ListColumn, filter: FieldFilter) {
  if (column.kind === "boolean") {
    const [constraint] = filter.constraints;
    const on = (constraint?.value === "true") !== (constraint?.matchMode === "notEquals");
    return column.options?.find(({ value }) => value === String(on))?.label ?? column.header;
  }

  const parts = filter.constraints.map(({ matchMode, value }, index) => {
    const previous = filter.constraints[index - 1];
    // Repeat the mode only when it changes: `contains "a" or "b"`
    const label =
      previous?.matchMode === matchMode ? "" : `${matchModeLabel(column.kind, matchMode)} `;
    if (matchMode === "between") {
      const [from = "", to = ""] = value.split(",");
      return `${label}${formatFilterValue(column, from)} and ${formatFilterValue(column, to)}`;
    }
    return `${label}${formatFilterValue(column, value)}`;
  });
  return `${column.header} ${parts.join(` ${filter.operator} `)}`;
}

export function formatFilterValue(column: ListColumn, value: string) {
  switch (column.kind) {
    case "currency":
      return formatRoundedCurrency(value);
    case "number":
      return formatNumber(value);
    case "fiscalYear":
      return `FY${value}`;
    case "date":
      return formatDate(value);
    case "enum":
      return column.options?.find((option) => option.value === value)?.label ?? value;
    default:
      return `“${value}”`;
  }
}
