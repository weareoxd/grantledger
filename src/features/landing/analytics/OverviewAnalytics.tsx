"use client";

import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { RecordKind } from "@/lib/record-kind";

import { type OverviewScope, summaryQueryOptions } from "../queries";
import { AgreementMix } from "./AgreementMix";
import { BASES, type Basis, useBasis } from "./basis";
import { FundingOverTime } from "./FundingOverTime";
import { Movers } from "./Movers";
import { period } from "./period";
import { Newcomers, WhatsNew } from "./WhatsNew";

/**
 * An overview's figures over time: this year to date against the last,
 * what's new, who moved most and, for agreements, grants against
 * contributions. Agreements' values are annualized or counted in the year
 * they started, as the user picks; payments count on the day they were made
 */
export function OverviewAnalytics({
  scope,
  kind,
}: {
  scope: OverviewScope;
  /** The organization's kind of record; undefined while it loads */
  kind: RecordKind | undefined;
}) {
  const summary = useQuery(summaryQueryOptions(scope));
  const [picked, setBasis] = useBasis();
  // A payment has no term to spread it over
  const basis: Basis = kind === "payment" ? "started" : picked;
  if (summary.isError) {
    // The cards above still lead to the lists
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border p-4 text-sm">
        <p>This page's figures couldn't be loaded.</p>
        <Button variant="outline" size="sm" onClick={() => summary.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const data = summary.data;
  const when = data ? period(data) : undefined;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {kind === "agreement" && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 lg:col-span-3">
          <p className="text-muted-foreground text-sm">{BASES[basis].explained}</p>
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={basis}
            // Picking the picked one again unpicks it: keep it
            onValueChange={(value: Basis | "") => value && setBasis(value)}
            aria-label="Agreement values"
          >
            {(Object.keys(BASES) as Basis[]).map((key) => (
              <ToggleGroupItem key={key} value={key}>
                {BASES[key].label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      )}
      <FundingOverTime summary={data} basis={basis} kind={kind} className="lg:col-span-2" />
      <WhatsNew summary={data} scope={scope} kind={kind} />
      <Movers summary={data} basis={basis} scope={scope} kind={kind} className="lg:col-span-2" />
      <Newcomers summary={data} basis={basis} scope={scope} kind={kind} />
      {data?.mix && (
        <AgreementMix
          mix={data.mix}
          fiscalYear={data.fiscal_year}
          partial={when?.partial}
          soFar={when?.soFar ?? "so far this year"}
          className="lg:col-span-3"
        />
      )}
    </div>
  );
}
