"use client";

import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts";

import { type ChartConfig, ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { Skeleton } from "@/components/ui/skeleton";
import {
  formatAxisCurrency,
  formatChange,
  formatCount,
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatRoundedCurrency,
  percentChange,
} from "@/lib/format";
import type { RecordKind } from "@/lib/record-kind";

import { BASES, type Basis } from "./basis";
import { period } from "./period";
import {
  axisYear,
  FiguresTable,
  fiscalYear,
  Panel,
  recordNouns,
  type Summary,
  TooltipCard,
} from "./shared";

const config = {
  value: { label: "Value", color: "var(--chart-1)" },
} satisfies ChartConfig;

/** One award this big a share of the year's value is worth a mention */
const OUTLIER = 0.25;

/**
 * This fiscal year to date against the same point last year, and the
 * value of awards each year, on the chosen `basis`
 */
export function FundingOverTime({
  summary,
  basis,
  kind,
  className,
}: {
  summary: Summary | undefined;
  basis: Basis;
  kind: RecordKind | undefined;
  className?: string;
}) {
  if (!summary) {
    return (
      <Panel title="Funding over time" className={className}>
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-56 w-full" />
      </Panel>
    );
  }
  const { fiscal_year: year, through, undated } = summary;
  const { complete, partial, span, against } = period(summary);
  const { ytd, by_year } = summary[basis];
  const nouns = recordNouns(kind);
  const payments = kind === "payment";
  const annualized = basis === "annualized" && !payments;
  // "945 agreements active", "2,000 payments"
  const counted = payments ? "" : ` ${BASES[basis].counted}`;
  const countHeader = payments ? nouns.title : `${nouns.title} ${BASES[basis].counted}`;
  const largestHeader = annualized ? `Largest from one ${nouns.one}` : `Largest ${nouns.one}`;
  const years = by_year.map((row) => ({
    ...row,
    label:
      row.fiscal_year === partial
        ? `${fiscalYear(row.fiscal_year)} (to date)`
        : fiscalYear(row.fiscal_year),
    current: row.fiscal_year === partial,
  }));
  const change = percentChange(ytd.value, ytd.previous_value);
  const countChange = percentChange(ytd.count, ytd.previous_count);
  const largest = ytd.largest;
  const outlier =
    largest && ytd.value > 0 && largest.year_value / ytd.value > OUTLIER ? largest : null;

  return (
    <Panel
      title="Funding over time"
      description={
        payments
          ? `Payments by the fiscal year they were made in, to ${formatDate(through)}`
          : annualized
            ? `Agreements' value in each fiscal year, spread over their terms, to ${formatDate(through)}`
            : `Value of ${nouns.many} by the fiscal year they started in, to ${formatDate(through)}`
      }
      className={className}
    >
      {ytd.count === 0 ? (
        <p className="text-sm">
          No {nouns.many}
          {counted} {complete ? "in" : "yet in"} {fiscalYear(year)}.{" "}
          {ytd.previous_count > 0 && (
            <span className="text-muted-foreground">
              {complete ? "In" : "By this point in"} {fiscalYear(year - 1)}:{" "}
              {formatRoundedCurrency(ytd.previous_value)} (
              {formatCount(ytd.previous_count, nouns.one)}).
            </span>
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-sm">
            <span
              className="font-semibold text-2xl tabular-nums tracking-tight"
              title={formatCurrency(ytd.value)}
            >
              {formatRoundedCurrency(ytd.value)}
            </span>{" "}
            in {span}
            {change !== null && (
              <>
                , {formatChange(change)} on {against} ({formatRoundedCurrency(ytd.previous_value)})
              </>
            )}
          </p>
          <p className="text-muted-foreground text-sm">
            {formatCount(ytd.count, nouns.one)}
            {counted}
            {countChange !== null &&
              `, ${formatChange(countChange)} (${formatNumber(ytd.previous_count)})`}
          </p>
          {outlier && (
            <p className="text-muted-foreground text-sm">
              {annualized ? (
                <>
                  Includes {formatRoundedCurrency(outlier.year_value)} (
                  {formatPercent(outlier.year_value / ytd.value)} of it) from one{" "}
                  {formatRoundedCurrency(outlier.value)} {nouns.one}
                </>
              ) : (
                <>
                  Includes one {formatRoundedCurrency(outlier.value)} {nouns.one} (
                  {formatPercent(outlier.value / ytd.value)} of it)
                </>
              )}
              {/* On a recipient's page, it's theirs */}
              {summary.scope !== "recipient" && `, to ${outlier.recipient_name}`}.
            </p>
          )}
        </div>
      )}
      {undated && (
        <p className="text-muted-foreground text-sm">
          Leaves out yearly totals published without a date: {formatRoundedCurrency(undated.value)}{" "}
          in {fiscalYear(year)} and {formatRoundedCurrency(undated.previous_value)} in{" "}
          {fiscalYear(year - 1)}. The chart includes them.
        </p>
      )}

      {years.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No {nouns.many} in the last 10 fiscal years.
        </p>
      ) : (
        <>
          <ChartContainer
            config={config}
            className="aspect-auto h-56 w-full"
            role="img"
            aria-label={`Value of ${nouns.many} by fiscal year, ${years[0]!.label} to ${years.at(-1)!.label}`}
          >
            <BarChart data={years} margin={{ left: 0, right: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="fiscal_year"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={(value: number) =>
                  `${axisYear(value)}${value === partial ? "*" : ""}`
                }
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={formatAxisCurrency}
              />
              <ChartTooltip
                cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                content={({ active, payload }) => {
                  const row = active ? payload?.[0]?.payload : undefined;
                  if (!row) return null;
                  return (
                    <TooltipCard
                      title={row.label}
                      lines={[
                        ["Value", formatRoundedCurrency(row.value)],
                        [countHeader, formatNumber(row.count)],
                        [
                          annualized ? "Largest part" : "Largest",
                          formatRoundedCurrency(row.largest_value),
                        ],
                      ]}
                    />
                  );
                }}
              />
              <Bar dataKey="value" fill="var(--color-value)" radius={4}>
                {years.map((row) => (
                  // The year so far: lighter
                  <Cell key={row.fiscal_year} fillOpacity={row.current ? 0.45 : 1} />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
          <p className="text-muted-foreground text-xs">
            {partial !== undefined && `* ${fiscalYear(partial)} so far. `}
            Fiscal years run April to March.
          </p>
          <FiguresTable
            caption={`Value of ${nouns.many} by fiscal year`}
            headers={["Fiscal year", "Value", countHeader, largestHeader]}
            rows={years.map((row) => [
              row.label,
              formatRoundedCurrency(row.value),
              formatNumber(row.count),
              formatRoundedCurrency(row.largest_value),
            ])}
          />
        </>
      )}
    </Panel>
  );
}
