"use client";

import { useId } from "react";

import { Switch } from "@/components/ui/switch";

import { FiscalYearSelect } from "./FiscalYearSelect";
import type { Toggle } from "./state/table-state";

type ListOptionsProps = {
  /** The years to choose from, on lists that total by fiscal year */
  fiscalYears?: number[];
  fiscalYear: number | undefined;
  onFiscalYearChange: (year: number | undefined) => void;
  /** Whether placeholder recipients are hidden, on lists that have them */
  hidePlaceholders?: boolean;
  /** Whether superseded amendments are shown, on agreement lists */
  includeSuperseded?: boolean;
  onToggle: (toggle: Toggle, on: boolean) => void;
};

/** A list's own controls, beside its columns: the fiscal year it totals, and
 * which rows it shows of the ones the data's conventions set apart */
export function ListOptions({
  fiscalYears,
  fiscalYear,
  onFiscalYearChange,
  hidePlaceholders,
  includeSuperseded,
  onToggle,
}: ListOptionsProps) {
  return (
    <>
      {fiscalYears && (
        <FiscalYearSelect years={fiscalYears} value={fiscalYear} onChange={onFiscalYearChange} />
      )}
      {hidePlaceholders !== undefined && (
        <Option
          label="Hide placeholders"
          title="Leave out the rows of withheld and undisclosed recipients"
          checked={hidePlaceholders}
          onChange={(on) => onToggle("hide_placeholders", on)}
        />
      )}
      {includeSuperseded !== undefined && (
        <Option
          label="Superseded amendments"
          title="Every version of each agreement, not only its latest. Values aren't totalled: each amendment restates the agreement's value"
          checked={includeSuperseded}
          onChange={(on) => onToggle("include_superseded", on)}
        />
      )}
    </>
  );
}

function Option({
  label,
  title,
  checked,
  onChange,
}: {
  label: string;
  title: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex h-8 items-center gap-2 px-1" title={title}>
      <Switch id={id} size="sm" checked={checked} onCheckedChange={onChange} />
      <label htmlFor={id} className="whitespace-nowrap text-sm">
        {label}
      </label>
    </div>
  );
}
