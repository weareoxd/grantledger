"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { PlaceholderBadge } from "@/features/table/cells";
import {
  formatCount,
  formatCurrency,
  formatDate,
  formatNumber,
  formatRoundedCurrency,
} from "@/lib/format";
import type { RecordKind } from "@/lib/record-kind";

import type { OverviewScope } from "../queries";
import type { Basis } from "./basis";
import { period } from "./period";
import {
  AppLink,
  awardLink,
  awardsLink,
  counterpartAwardsLink,
  equalsFilter,
  ministryNouns,
  Panel,
  recordNouns,
  type Summary,
  thisYearsAwards,
} from "./shared";

/**
 * The latest data: when it was last loaded, and the latest awards to start
 * (or payments made)
 */
export function WhatsNew({
  summary,
  scope,
  kind,
  className,
}: {
  summary: Summary | undefined;
  scope: OverviewScope;
  kind: RecordKind | undefined;
  className?: string;
}) {
  const latest = summary?.latest ?? [];
  const loaded = summary?.last_import;
  const nouns = recordNouns(kind);
  return (
    <Panel
      title="What's new"
      className={className}
      action={
        latest.length > 0 && (
          <AppLink
            // Up to today (the server's, as the latest here): not the
            // future-dated ones first
            to={awardsLink(scope, {
              sort: "-start_date",
              filters: {
                start_date: {
                  operator: "and",
                  constraints: [{ matchMode: "lte", value: summary?.today ?? "" }],
                },
              },
            })}
            className="text-xs"
          >
            See all
          </AppLink>
        )
      }
    >
      {!summary ? (
        <>
          <Skeleton className="h-5 w-full" />
          {Array.from({ length: 5 }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders, all alike
            <Skeleton key={index} className="h-9 w-full" />
          ))}
        </>
      ) : (
        <>
          {loaded && (
            <p className="text-sm">
              Data loaded{" "}
              <AppLink
                to={awardsLink(scope, {
                  filters: equalsFilter("import_date", loaded.date),
                })}
              >
                {formatDate(loaded.date)}
              </AppLink>
              : {formatCount(loaded.count, nouns.one)} ({formatRoundedCurrency(loaded.value)}) from{" "}
              {formatCount(loaded.files, "file")}
            </p>
          )}
          {latest.length === 0 ? (
            <p className="text-muted-foreground text-sm">No {nouns.many} yet.</p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Latest {nouns.many}</caption>
              <thead className="sr-only">
                <tr>
                  <th scope="col">{nouns.title.slice(0, -1)}</th>
                  <th scope="col">Value</th>
                </tr>
              </thead>
              <tbody>
                {latest.map((award) => (
                  <tr key={award.id} className="border-t align-top">
                    <td className="wrap-anywhere py-1.5 pr-2">
                      {/* The award, named by the other side of it: its
                          recipient, or on a recipient's page its ministry */}
                      <AppLink to={awardLink(scope, award)}>
                        {summary.scope === "recipient" ? award.ministry_name : award.recipient_name}
                      </AppLink>
                      {summary.scope !== "recipient" && award.recipient_is_placeholder && (
                        <PlaceholderBadge />
                      )}
                      <span className="block text-muted-foreground text-xs">
                        {kind === "payment" ? "Paid" : "Started"} {formatDate(award.start_date)}
                        {summary.scope === "organization" && ` · ${award.ministry_name}`}
                      </span>
                    </td>
                    <td
                      className="whitespace-nowrap py-1.5 text-right tabular-nums"
                      title={formatCurrency(award.value)}
                    >
                      {formatRoundedCurrency(award.value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Panel>
  );
}

/** Recipients with their first awards this year (on a recipient's page, the
 * ministries that first funded it), the biggest on the chosen `basis` first */
export function Newcomers({
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
  const one = kind === "ministry" ? ministries.one : "recipient";
  const plural = kind === "ministry" ? ministries.many : "recipients";
  const title = kind === "ministry" ? `First-time ${ministries.many}` : "New recipients";
  if (!summary) {
    return (
      <Panel title={title} className={className}>
        <Skeleton className="h-8 w-24" />
        {Array.from({ length: 5 }, (_, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders, all alike
          <Skeleton key={index} className="h-6 w-full" />
        ))}
      </Panel>
    );
  }
  const { count, top } = summary[basis].new;
  const awards = thisYearsAwards(summary, basis, recordKind);
  const { span, soFar } = period(summary);
  return (
    <Panel title={title} description={`First ${nouns.many} in ${span}`} className={className}>
      <p className="text-sm">
        <span className="font-semibold text-2xl tabular-nums tracking-tight">
          {formatNumber(count)}
        </span>{" "}
        {count === 1 ? one : plural} {soFar}
      </p>
      {top.length > 0 && (
        <table className="w-full text-sm">
          <caption className="sr-only">
            {kind === "ministry"
              ? `${ministries.many} funding it for the first time`
              : "Recipients new this year"}
          </caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Value this year</th>
            </tr>
          </thead>
          <tbody>
            {top.map((newcomer) => (
              <tr key={newcomer.id} className="border-t align-top">
                <td className="wrap-anywhere py-1.5 pr-2">
                  {/* Its awards behind the figures */}
                  <AppLink to={counterpartAwardsLink(scope, kind, newcomer.id, awards)}>
                    {newcomer.name}
                  </AppLink>
                  <span className="block text-muted-foreground text-xs">
                    Since {formatDate(newcomer.first_start_date)} ·{" "}
                    {formatCount(newcomer.count, nouns.one)}
                  </span>
                </td>
                <td
                  className="whitespace-nowrap py-1.5 text-right tabular-nums"
                  title={formatCurrency(newcomer.value)}
                >
                  {formatRoundedCurrency(newcomer.value)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
