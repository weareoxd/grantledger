"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
} from "@/components/ui/chart";
import { formatNumber, formatPercent, formatRoundedCurrency } from "@/lib/format";

import { pivotMix, share, watchedShare } from "./mix";
import {
  axisYear,
  FiguresTable,
  fiscalYear,
  Panel,
  PartialYearNote,
  type Summary,
  TooltipCard,
} from "./shared";

const COLORS: Record<string, string> = {
  G: "var(--chart-1)",
  C: "var(--chart-2)",
  O: "var(--muted-foreground)",
};

/** Agreements by type each year: shares of the year's agreements (by count,
 * which a few huge agreements can't skew) */
export function AgreementMix({
  mix,
  fiscalYear: year,
  partial,
  soFar,
  className,
}: {
  mix: NonNullable<Summary["mix"]>;
  fiscalYear: number;
  /** The year still running, if it is (see period) */
  partial: number | undefined;
  /** "so far this year", or "in FY2025" once it's over */
  soFar: string;
  className?: string;
}) {
  const years = pivotMix(mix);
  const config = Object.fromEntries(
    mix.groups.map(({ key, label }) => [key, { label, color: COLORS[key] }]),
  ) satisfies ChartConfig;
  const rows = years.map((row) => ({
    label:
      row.fiscal_year === partial
        ? `${fiscalYear(row.fiscal_year)} (to date)`
        : fiscalYear(row.fiscal_year),
    fiscal_year: row.fiscal_year,
    row,
    ...Object.fromEntries(mix.groups.map(({ key }) => [key, row.counts[key] ?? 0])),
  }));
  const watched = watchedShare(mix, year);

  return (
    <Panel
      title="Grants and contributions"
      description="Share of the agreements started each year, by type"
      className={className}
    >
      {watched && (
        <p className="text-sm">
          {watched.label}:{" "}
          <span className="font-semibold tabular-nums">{formatPercent(watched.now)}</span> of
          agreements {soFar}
          {watched.before !== null &&
            ` (${formatPercent(watched.before)} in ${fiscalYear(year - 1)})`}
        </p>
      )}
      <ChartContainer
        config={config}
        className="aspect-auto h-56 w-full"
        role="img"
        aria-label="Share of agreements by type, by fiscal year"
      >
        <BarChart data={rows} stackOffset="expand">
          <CartesianGrid vertical={false} />
          <XAxis
            dataKey="fiscal_year"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tickFormatter={(value: number) => `${axisYear(value)}${value === partial ? "*" : ""}`}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            width={40}
            tickFormatter={(value: number) => formatPercent(value)}
          />
          <ChartTooltip
            cursor={{ fill: "var(--muted)", opacity: 0.5 }}
            content={({ active, payload }) => {
              const point = active ? payload?.[0]?.payload : undefined;
              if (!point) return null;
              const row = point.row as (typeof years)[number];
              return (
                <TooltipCard
                  title={point.label}
                  lines={mix.groups.map(({ key, label }) => [
                    label,
                    `${formatPercent(share(row, key) ?? 0)} · ${formatRoundedCurrency(row.values[key] ?? 0)}`,
                  ])}
                />
              );
            }}
          />
          <ChartLegend content={<ChartLegendContent />} />
          {mix.groups.map(({ key }) => (
            <Bar key={key} dataKey={key} stackId="mix" fill={`var(--color-${key})`} />
          ))}
        </BarChart>
      </ChartContainer>
      <PartialYearNote partial={partial} years={years.map(({ fiscal_year }) => fiscal_year)} />
      <FiguresTable
        caption="Agreements by type"
        headers={["Fiscal year", ...mix.groups.map(({ label }) => label)]}
        rows={rows.map(({ label, row }) => [
          label,
          ...mix.groups.map(
            ({ key }) =>
              `${formatNumber(row.counts[key] ?? 0)} (${formatPercent(share(row, key) ?? 0)})`,
          ),
        ])}
      />
    </Panel>
  );
}
