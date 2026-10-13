"use client";

import type { LucideIcon } from "lucide-react";
import { type ReactNode, useId } from "react";

import { useDocumentTitle } from "@/app-shell/scope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { LinkTarget } from "@/features/lists/types";
import { formatCurrency, formatNumber, formatRoundedCurrency } from "@/lib/format";
import { AppLink } from "@/lib/routes";

/**
 * An organization's, ministry's, program's or recipient's own page: its
 * name, and a card for each of its lists with what's in it
 */
export function LandingPage({
  kind,
  name,
  description,
  children,
  analytics,
}: {
  /** What it is: "Organization", "Department", "Program", "Recipient"... */
  kind: string;
  /** undefined while it loads */
  name: string | undefined;
  /** A line under the name: where the data comes from, say */
  description?: ReactNode;
  children: ReactNode;
  /** Its figures over time, under the cards */
  analytics?: ReactNode;
}) {
  useDocumentTitle();
  const headingId = useId();
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={headingId} className="flex flex-col gap-4">
        <div className="flex flex-col gap-0.5">
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {kind}
          </p>
          <h1 id={headingId} className="wrap-anywhere font-semibold text-xl tracking-tight">
            {name ?? <Skeleton className="h-7 w-64" />}
          </h1>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>
      </section>
      {analytics}
    </div>
  );
}

/**
 * One of the lists, with how many things are in it (and what they're
 * worth), leading to it. With nothing in it, there's nowhere to go.
 */
export function SummaryCard({
  title,
  icon: Icon,
  figure,
  detail,
  link,
}: {
  title: string;
  icon: LucideIcon;
  /** The headline: a count, or text (a fiscal year); undefined while it loads */
  figure: number | string | undefined;
  /** A line under it, if any: an amount, or text; "loading" until it comes */
  detail?: { amount: number } | { text: string } | "loading";
  /** The list it leads to, if there's anything in it */
  link?: LinkTarget | null;
}) {
  const card = (
    <Card className="h-full transition-shadow group-hover/summary:ring-foreground/25">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-muted-foreground text-sm">
          <Icon className="size-4" aria-hidden="true" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-1">
        {figure === undefined ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <span className="font-semibold text-2xl tabular-nums tracking-tight">
            {typeof figure === "number" ? formatNumber(figure) : figure}
          </span>
        )}
        {detail === undefined ? null : detail === "loading" ? (
          <Skeleton className="h-4 w-20" />
        ) : "amount" in detail ? (
          <span
            className="text-muted-foreground text-sm tabular-nums"
            title={formatCurrency(detail.amount)}
          >
            {formatRoundedCurrency(detail.amount)}
          </span>
        ) : (
          <span className="text-muted-foreground text-sm">{detail.text}</span>
        )}
      </CardContent>
    </Card>
  );
  return (
    <li>
      {link ? (
        <AppLink
          to={link.to}
          params={link.params}
          className="group/summary block h-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {card}
        </AppLink>
      ) : (
        card
      )}
    </li>
  );
}
