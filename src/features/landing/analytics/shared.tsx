"use client";

import { cn } from "cn";
import type { ReactNode } from "react";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { LinkTarget } from "@/features/lists/types";
import type { TableSearch } from "@/features/table/state/schema";
import type { RecordKind } from "@/lib/record-kind";
import { AppLink as RouteLink } from "@/lib/routes";

import type { OverviewScope, OverviewSummary } from "../queries";
import type { Basis } from "./basis";

export type Summary = OverviewSummary;

/** A section of the analytics: a card with a title, and what it shows */
export function Panel({
  title,
  description,
  action,
  className,
  children,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {action && <CardAction>{action}</CardAction>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

/**
 * A chart's figures as a table, for screen readers (and tests): charts
 * themselves are pictures
 */
export function FiguresTable({
  caption,
  headers,
  rows,
}: {
  caption: string;
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {headers.map((header) => (
            <th key={header} scope="col">
              {header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a chart's figures, in the chart's order
          <tr key={index}>
            {row.map((cell, column) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: cells are positional, under headers
              <td key={column}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** A chart's tooltip, as the chart component's own looks */
export function TooltipCard({
  title,
  lines,
}: {
  title: ReactNode;
  lines: [label: ReactNode, value: ReactNode][];
}) {
  return (
    <div className="grid min-w-36 gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <p className="font-medium">{title}</p>
      {lines.map(([label, value], index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional (labels may be nodes)
        <p key={index} className="flex justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium font-mono tabular-nums">{value}</span>
        </p>
      ))}
    </div>
  );
}

export function AppLink({
  to,
  children,
  className,
}: {
  to: LinkTarget;
  children: ReactNode;
  className?: string;
}) {
  return (
    <RouteLink to={to.to} params={to.params} search={to.search} className={cn("link", className)}>
      {children}
    </RouteLink>
  );
}

/** What a scope's records are called: agreements, payments, or (before the
 * organization is known) awards */
export function recordNouns(kind: RecordKind | undefined) {
  const one = kind === "agreement" ? "agreement" : kind === "payment" ? "payment" : "award";
  return {
    one,
    many: `${one}s`,
    title: `${one[0]!.toUpperCase()}${one.slice(1)}s`,
  };
}

/** What the organization calls its ministries */
export function ministryNouns(kind: RecordKind | undefined) {
  return kind === "agreement"
    ? { one: "department", many: "departments" }
    : { one: "ministry", many: "ministries" };
}

/** The scope's awards, as listed on its own page */
export function awardsLink(scope: OverviewScope, search?: TableSearch): LinkTarget {
  const { organizationId: organization_id, ministryId, programId, recipientId } = scope;
  if (ministryId && programId) {
    return {
      to: "/organization/$organization_id/ministry/$ministry_id/program/$program_id/award",
      params: {
        organization_id,
        ministry_id: ministryId,
        program_id: programId,
      },
      search,
    };
  }
  if (ministryId) {
    return {
      to: "/organization/$organization_id/ministry/$ministry_id/award",
      params: { organization_id, ministry_id: ministryId },
      search,
    };
  }
  if (recipientId) {
    return {
      to: "/organization/$organization_id/recipient/$recipient_id/awards",
      params: { organization_id, recipient_id: recipientId },
      search,
    };
  }
  return {
    to: "/organization/$organization_id/award",
    params: { organization_id },
    search,
  };
}

/**
 * The awards between the scope and a recipient (on a recipient's page, a
 * ministry), as listed, with `search`
 */
export function counterpartAwardsLink(
  scope: OverviewScope,
  kind: "recipient" | "ministry",
  id: number,
  search?: TableSearch,
): LinkTarget {
  const { organizationId: organization_id, ministryId, programId, recipientId } = scope;
  if (kind === "ministry") {
    return recipientId
      ? pairAwardsLink(organization_id, id, recipientId, search)
      : awardsLink({ organizationId: organization_id, ministryId: String(id) }, search);
  }
  if (ministryId && programId) {
    return {
      to: "/organization/$organization_id/ministry/$ministry_id/program/$program_id/recipient/$recipient_id",
      params: {
        organization_id,
        ministry_id: ministryId,
        program_id: programId,
        recipient_id: String(id),
      },
      search,
    };
  }
  if (ministryId) return pairAwardsLink(organization_id, ministryId, id, search);
  return {
    to: "/organization/$organization_id/recipient/$recipient_id/awards",
    params: { organization_id, recipient_id: String(id) },
    search,
  };
}

/** A ministry's awards to a recipient, with `search` */
function pairAwardsLink(
  organization_id: string,
  ministry: string | number,
  recipient: string | number,
  search?: TableSearch,
): LinkTarget {
  return {
    to: "/organization/$organization_id/ministry/$ministry_id/recipient/$recipient_id",
    params: {
      organization_id,
      ministry_id: String(ministry),
      recipient_id: String(recipient),
    },
    search,
  };
}

/**
 * One award, among its ministry's awards to its recipient: an agreement by
 * its reference (with its amendments), a payment by the day it was made
 */
export function awardLink(scope: OverviewScope, award: Summary["latest"][number]): LinkTarget {
  return pairAwardsLink(scope.organizationId, award.ministry_id, award.recipient_id, {
    filters: award.reference
      ? equalsFilter("reference", award.reference)
      : equalsFilter("start_date", award.start_date),
  });
}

/**
 * The awards behind this year's figures, biggest first: those started (or
 * paid) in the year to date, or (annualized) running in it. The lists can't
 * "or" two fields, so a running agreement without an end date isn't among
 * them; nor, for payments, the yearly totals published without a date,
 * which the figures leave out too
 */
export function thisYearsAwards(
  summary: Summary,
  basis: Basis,
  kind: RecordKind | undefined,
): TableSearch {
  const start = `${summary.fiscal_year}-04-01`;
  const condition = (matchMode: "between" | "lte" | "gte", value: string) => ({
    operator: "and" as const,
    constraints: [{ matchMode, value }],
  });
  if (basis === "annualized" && kind !== "payment") {
    return {
      sort: "-value",
      filters: {
        start_date: condition("lte", summary.through),
        end_date: condition("gte", start),
      },
    };
  }
  return {
    sort: "-value",
    filters: {
      start_date: condition("between", `${start},${summary.through}`),
      ...(kind === "payment" ? equalsFilter("start_date_estimated", "false") : {}),
    },
  };
}

/** One condition on one field, as the lists' URLs hold it */
export function equalsFilter(field: string, value: string) {
  return {
    [field]: {
      operator: "and" as const,
      constraints: [{ matchMode: "equals" as const, value }],
    },
  };
}

export const fiscalYear = (year: number) => `FY${year}`;

/** What a chart's "*" means, when it has the year still running */
export function PartialYearNote({
  partial,
  years,
}: {
  partial: number | undefined;
  years: number[];
}) {
  if (partial === undefined || !years.includes(partial)) return null;
  return <p className="text-muted-foreground text-xs">* {fiscalYear(partial)} so far.</p>;
}

/** A fiscal year for a chart's axis, where ten have to fit: "FY25" */
export const axisYear = (year: number) => `FY${String(year % 100).padStart(2, "0")}`;
