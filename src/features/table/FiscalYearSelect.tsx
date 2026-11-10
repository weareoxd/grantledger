"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fiscalYearOf } from "@/lib/format";

const ALL = "all";

/** The fiscal year an aggregated list totals, or all of them */
export function FiscalYearSelect({
  years,
  value,
  onChange,
}: {
  /** Years with data, newest first */
  years: number[];
  value: number | undefined;
  onChange: (year: number | undefined) => void;
}) {
  const current = fiscalYearOf(new Date());
  // A year from a link that has no data still shows as chosen
  const options = value === undefined || years.includes(value) ? years : [value, ...years];
  return (
    <Select
      value={value === undefined ? ALL : String(value)}
      onValueChange={(next) => onChange(next === ALL ? undefined : Number(next))}
    >
      <SelectTrigger size="sm" className="w-44" aria-label="Fiscal year">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>All fiscal years</SelectItem>
        {options.map((year) => (
          <SelectItem key={year} value={String(year)}>
            FY{year}
            {year === current ? " (to date)" : ""}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
