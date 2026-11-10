"use client";

import { cn } from "cn";
import { PlusIcon, XIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ListColumn } from "@/features/lists/types";

import { FILTER_KINDS, isRangeMode, matchModeLabel } from "./columns/kinds";
import { type Draft, type DraftCondition, emptyCondition, fromDraft, toDraft } from "./filters";
import { type FieldFilter, MAX_CONSTRAINTS, type MatchMode } from "./state/schema";

type FilterEditorProps = {
  column: ListColumn;
  filter: FieldFilter | undefined;
  /** undefined clears the filter */
  onApply: (filter: FieldFilter | undefined) => void;
};

/** Edit one column's filter: one or more conditions, all or any of them */
export function FilterEditor({ column, filter, onApply }: FilterEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(column, filter));
  const kind = FILTER_KINDS[column.kind];
  const single = column.kind === "boolean";

  const update = (index: number, change: Partial<DraftCondition>) =>
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition, i) =>
        i === index ? { ...condition, ...change } : condition,
      ),
    }));

  const remove = (index: number) =>
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.filter((_, i) => i !== index),
    }));

  const add = () =>
    setDraft((current) => ({
      ...current,
      conditions: [...current.conditions, emptyCondition(column.kind)],
    }));

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(fromDraft(draft));
      }}
    >
      <p className="font-medium text-sm">Filter by {column.header.toLowerCase()}</p>

      {draft.conditions.map((condition, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: conditions are positional (no ids)
        <div key={index} className="flex flex-col gap-1.5">
          {index > 0 && (
            <span className="font-medium text-muted-foreground text-xs uppercase">
              {draft.operator}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            {kind.modes.length > 1 && (
              <Select
                value={condition.mode}
                onValueChange={(mode) => update(index, { mode: mode as MatchMode })}
              >
                <SelectTrigger
                  // As wide as its label: "is on or before" is cut off at
                  // a fixed width
                  className="shrink-0"
                  aria-label={`Condition ${index + 1}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {kind.modes.map((mode) => (
                    <SelectItem key={mode} value={mode}>
                      {matchModeLabel(column.kind, mode)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isRangeMode(condition.mode) ? (
              <div className="flex-1" />
            ) : (
              <ConditionInput
                column={column}
                condition={condition}
                onChange={(change) => update(index, change)}
                autoFocus={index === draft.conditions.length - 1}
              />
            )}
            {draft.conditions.length > 1 && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove condition ${index + 1}`}
                onClick={() => remove(index)}
              >
                <XIcon />
              </Button>
            )}
          </div>
          {/* A range's two ends on a line of their own: beside the picker,
              a date in each wouldn't fit */}
          {isRangeMode(condition.mode) && (
            <ConditionInput
              column={column}
              condition={condition}
              onChange={(change) => update(index, change)}
              autoFocus={index === draft.conditions.length - 1}
            />
          )}
        </div>
      ))}

      {!single && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-2"
            disabled={draft.conditions.length >= MAX_CONSTRAINTS}
            onClick={add}
          >
            <PlusIcon />
            Add condition
          </Button>
          {draft.conditions.length > 1 && (
            <div
              role="radiogroup"
              aria-label="Combine conditions"
              className="flex rounded-md border p-0.5 text-xs"
            >
              {(["and", "or"] as const).map((operator) => (
                // biome-ignore lint/a11y/useSemanticElements: a segmented control, styled as one
                <button
                  key={operator}
                  type="button"
                  role="radio"
                  aria-checked={draft.operator === operator}
                  onClick={() => setDraft((current) => ({ ...current, operator }))}
                  className={cn(
                    "rounded-sm px-2 py-0.5",
                    draft.operator === operator
                      ? "bg-secondary font-medium text-secondary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {operator === "and" ? "Match all" : "Match any"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex justify-between gap-2 border-t pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!filter}
          onClick={() => onApply(undefined)}
        >
          Clear
        </Button>
        <Button type="submit" size="sm">
          Apply
        </Button>
      </div>
    </form>
  );
}

function ConditionInput({
  column,
  condition,
  onChange,
  autoFocus,
}: {
  column: ListColumn;
  condition: DraftCondition;
  onChange: (change: Partial<DraftCondition>) => void;
  autoFocus: boolean;
}) {
  const id = useId();

  if (column.kind === "boolean" || column.kind === "enum") {
    return (
      <Select value={condition.value || undefined} onValueChange={(value) => onChange({ value })}>
        <SelectTrigger className="min-w-0 flex-1" aria-label="Value">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {column.options?.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const inputProps = inputPropsFor(column);
  if (condition.mode === "between") {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Input
          {...inputProps}
          id={id}
          aria-label="From"
          placeholder={inputProps.placeholder ? `From` : undefined}
          value={condition.value}
          onChange={(event) => onChange({ value: event.target.value })}
          autoFocus={autoFocus}
        />
        <span className="text-muted-foreground text-xs">to</span>
        <Input
          {...inputProps}
          aria-label="To"
          placeholder={inputProps.placeholder ? `To` : undefined}
          value={condition.to}
          onChange={(event) => onChange({ to: event.target.value })}
        />
      </div>
    );
  }

  return (
    <Input
      {...inputProps}
      id={id}
      aria-label="Value"
      value={condition.value}
      onChange={(event) => onChange({ value: event.target.value })}
      autoFocus={autoFocus}
      className="h-8 min-w-0 flex-1"
    />
  );
}

function inputPropsFor(column: ListColumn) {
  const base = { className: "h-8 min-w-0 flex-1" };
  switch (column.kind) {
    case "date":
      return { ...base, type: "date", placeholder: undefined };
    case "fiscalYear":
      return {
        ...base,
        type: "number",
        inputMode: "numeric" as const,
        step: 1,
        placeholder: "2024",
      };
    case "number":
      return {
        ...base,
        type: "number",
        inputMode: "numeric" as const,
        step: 1,
        placeholder: "0",
      };
    case "currency":
      return {
        ...base,
        type: "number",
        inputMode: "decimal" as const,
        step: "any",
        placeholder: "0.00",
      };
    default:
      return { ...base, type: "text", placeholder: "Text…" };
  }
}
