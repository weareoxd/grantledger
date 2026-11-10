"use client";

import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { LinkContext, ListColumn, ListRow, ScopeParams } from "@/features/lists/types";
import { formatCurrency, formatDate, formatNumber, formatRoundedCurrency } from "@/lib/format";
import { AppLink } from "@/lib/routes";

type CellProps = {
  column: ListColumn;
  row: ListRow;
  params: ScopeParams;
  linkContext: LinkContext;
  /** The user set the column's width: text fills it, rather than its own */
  sized?: boolean;
};

export function Cell({ column, row, params, linkContext, sized = false }: CellProps) {
  const value = row[column.id];
  const content = renderValue(column, row, value, sized);
  const target = column.link?.(row, params, linkContext);
  if (!target || value === null || value === undefined || value === "") {
    return content;
  }
  return (
    <AppLink
      to={target.to}
      params={target.params}
      search={target.search}
      // Not as it scrolls into view: a table has a link in most cells
      prefetch={false}
      className="link"
    >
      {content}
    </AppLink>
  );
}

function renderValue(column: ListColumn, row: ListRow, value: unknown, sized: boolean) {
  // Long text wraps: at the width the user gave the column, or else at a
  // width that suits it
  const textWidth = sized
    ? undefined
    : column.id === "description" || column.id === "title"
      ? "max-w-md"
      : "max-w-xs";
  switch (column.kind) {
    case "number":
      return value === null || value === undefined ? <Empty /> : formatNumber(value as number);
    case "currency":
      return value === null || value === undefined ? (
        <Empty />
      ) : (
        <span title={formatCurrency(value as number)}>
          {formatRoundedCurrency(value as number)}
        </span>
      );
    case "date":
      if (!value) return <Empty />;
      return column.id === "start_date" && row.start_date_estimated === true ? (
        <>
          {formatDate(value as string)}
          <span
            className="text-muted-foreground"
            title="No date was published: this is the first day of the fiscal year."
          >
            {" "}
            (est.)
          </span>
        </>
      ) : (
        formatDate(value as string)
      );
    case "boolean":
      return value === null || value === undefined ? <Empty /> : value === true ? "Yes" : "No";
    case "enum": {
      if (value === null || value === undefined || value === "") {
        return <Empty />;
      }
      const option = column.options?.find((option) => option.value === value);
      return <span className={cn("block", textWidth)}>{option?.label ?? String(value)}</span>;
    }
    default: {
      if (value === null || value === undefined || value === "") {
        return <Empty />;
      }
      const placeholder =
        (column.id === "name" && row.is_placeholder === true) ||
        (column.id === "recipient" && row.recipient_is_placeholder === true);
      return (
        <span className={cn("block", textWidth)}>
          {String(value)}
          {placeholder && <PlaceholderBadge />}
        </span>
      );
    }
  }
}

export const PLACEHOLDER_HELP =
  "Not a real recipient: amounts the publisher released without a name, or individuals whose names are withheld. They count in totals.";

export function PlaceholderBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className="ml-2 cursor-help align-text-bottom font-normal text-[0.7rem]"
        >
          Placeholder
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{PLACEHOLDER_HELP}</TooltipContent>
    </Tooltip>
  );
}

function Empty() {
  return <span className="text-muted-foreground/60">–</span>;
}
