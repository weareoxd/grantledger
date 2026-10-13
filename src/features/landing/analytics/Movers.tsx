"use client";

import { Skeleton } from "@/components/ui/skeleton";
import {
  formatCount,
  formatCurrency,
  formatMultiple,
  formatPercent,
  formatRoundedCurrency,
  percentChange,
} from "@/lib/format";
import type { RecordKind } from "@/lib/record-kind";

import type { OverviewScope } from "../queries";
import { BASES, type Basis } from "./basis";
import { period } from "./period";
import {
  AppLink,
  counterpartAwardsLink,
  fiscalYear,
  ministryNouns,
  Panel,
  recordNouns,
  type Summary,
  thisYearsAwards,
} from "./shared";

/**
 * The biggest recipients (or a recipient's ministries) this year to date,
 * each against the same point last year, on the chosen `basis`. Placeholder
 * recipients aren't among them
 */
export function Movers({
  summary,
  basis,
  scope,
  kind: recordKind,
  className,
}: {
  summary: Summary | undefined;
  basis: Basis;
  scope: OverviewScope;
  kind: RecordKind | undefined;
  className?: string;
}) {
  // From the page, not the summary: right while it loads
  const kind = scope.recipientId ? "ministry" : "recipient";
  const ministries = ministryNouns(recordKind);
  const nouns = recordNouns(recordKind);
  const payments = recordKind === "payment";
  const title = `Biggest ${kind === "ministry" ? ministries.many : "recipients"} ${summary ? period(summary).thisYear : "this year"}`;
  if (!summary) {
    return (
      <Panel title={title} className={className}>
        {Array.from({ length: 6 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders, all alike
          <Skeleton key={index} className="h-7 w-full" />
        ))}
      </Panel>
    );
  }
  const year = summary.fiscal_year;
  const { movers } = summary[basis];
  const awards = thisYearsAwards(summary, basis, recordKind);
  const { span, against, soFar } = period(summary);
  return (
    <Panel
      title={title}
      description={`${
        payments
          ? `By payments in ${span}`
          : basis === "annualized"
            ? `By agreements' value in ${span}, spread over their terms`
            : `By value of ${nouns.many} started in ${span}`
      }, against ${against}`}
      className={className}
    >
      {movers.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No {nouns.many} {soFar}.
        </p>
      ) : (
        <table className="w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th scope="col" className="pb-1.5 text-left font-medium">
                {kind === "ministry"
                  ? ministries.one[0]!.toUpperCase() + ministries.one.slice(1)
                  : "Recipient"}
              </th>
              <th scope="col" className="pb-1.5 text-right font-medium">
                {fiscalYear(year)}
              </th>
              <th scope="col" className="hidden pb-1.5 pl-3 text-right font-medium sm:table-cell">
                {fiscalYear(year - 1)}
              </th>
              <th scope="col" className="pb-1.5 pl-3 text-right font-medium">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {movers.map((mover) => {
              const change = percentChange(mover.value, mover.previous_value);
              return (
                <tr key={mover.id} className="border-t align-top">
                  <td className="wrap-anywhere py-1.5 pr-2">
                    {/* Its awards behind the figures */}
                    <AppLink to={counterpartAwardsLink(scope, kind, mover.id, awards)}>
                      {mover.name}
                    </AppLink>
                    <span className="block text-muted-foreground text-xs">
                      {formatCount(mover.count, nouns.one)}
                      {payments ? "" : ` ${BASES[basis].counted}`}
                    </span>
                  </td>
                  <td
                    className="whitespace-nowrap py-1.5 text-right tabular-nums"
                    title={formatCurrency(mover.value)}
                  >
                    {formatRoundedCurrency(mover.value)}
                  </td>
                  <td
                    className="hidden whitespace-nowrap py-1.5 pl-3 text-right text-muted-foreground tabular-nums sm:table-cell"
                    title={formatCurrency(mover.previous_value)}
                  >
                    {formatRoundedCurrency(mover.previous_value)}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pl-3 text-right tabular-nums">
                    <Change change={change} isNew={mover.previous_count === 0} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

/** "▲ 12%", "▼ 8%", "▲ 34×", "Unchanged" (to the nearest percent), "New"
 * (no awards before), or "–" (some, but worth nothing to compare to) */
function Change({ change, isNew }: { change: number | null; isNew: boolean }) {
  if (change === null) {
    return isNew ? (
      <span className="text-muted-foreground">New</span>
    ) : (
      // biome-ignore lint/a11y/useAriaPropsSupportedByRole: read as its label, not "–"
      <span className="text-muted-foreground" aria-label="No change to show">
        –
      </span>
    );
  }
  const percent = formatMultiple(change) ?? formatPercent(Math.abs(change));
  if (percent === formatPercent(0)) {
    return <span className="text-muted-foreground">Unchanged</span>;
  }
  return (
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: read as its label, not the arrow
    <span aria-label={`${change < 0 ? "Down" : "Up"} ${percent}`}>
      {change < 0 ? "▼" : "▲"} {percent}
    </span>
  );
}
