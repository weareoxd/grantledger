"use client";

import { cn } from "cn";
import { CircleAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ListColumn } from "@/features/lists/types";
import type { RecordKind } from "@/lib/record-kind";

import { columnFor } from "./columns/registry";
import { describeFilter } from "./filters";
import type { FieldFilter, Filters } from "./state/schema";

type FilterChipsProps = {
  columns: ListColumn[];
  /** The organization's kind of record: names a filter's column the list
   * doesn't show */
  kind: RecordKind | undefined;
  filters: Filters;
  /** Messages for filters the API rejected, by field */
  errors: Record<string, string[]>;
  onRemove: (field: string) => void;
  onClear: () => void;
};

/** The active filters, each removable. A shown column's filter is changed
 * from its filter button, in the table's header; one on a field the list
 * doesn't show (from an old link) can still be seen and removed */
export function FilterChips({
  columns,
  kind,
  filters,
  errors,
  onRemove,
  onClear,
}: FilterChipsProps) {
  const active = Object.entries(filters).map(([field, filter]) => ({
    column: columnFor(columns, field, kind),
    filter,
  }));
  if (active.length === 0) return null;

  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: names the chips for assistive tech
    <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters">
      {active.map(({ column, filter }) => (
        <FilterChip
          key={column.id}
          column={column}
          filter={filter}
          errors={errors[column.id]}
          onRemove={() => onRemove(column.id)}
        />
      ))}
      <Button variant="ghost" size="xs" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}

function FilterChip({
  column,
  filter,
  errors,
  onRemove,
}: {
  column: ListColumn;
  filter: FieldFilter;
  errors: string[] | undefined;
  onRemove: () => void;
}) {
  const description = describeFilter(column, filter);

  return (
    <span
      className={cn(
        "inline-flex h-7 max-w-full items-center rounded-full border bg-secondary text-secondary-foreground text-xs",
        errors && "border-destructive bg-destructive/10 text-destructive",
      )}
    >
      <span
        className="flex min-w-0 items-center gap-1 py-1 pr-1 pl-2.5"
        title={errors ? errors.join(" ") : description}
      >
        {errors && <CircleAlertIcon className="size-3.5 shrink-0" />}
        <span className="truncate">{description}</span>
      </span>
      <button
        type="button"
        aria-label={`Remove filter: ${description}`}
        className="mr-1 rounded-full p-0.5 hover:bg-foreground/10"
        onClick={onRemove}
      >
        <XIcon className="size-3" />
      </button>
    </span>
  );
}
