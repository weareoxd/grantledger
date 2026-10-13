"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime, formatRelative } from "@/lib/format-time";

/** "3 hours ago" with the exact time on hover; rendered on the client's clock. */
export function RelativeTime({ value }: { value: Date | string | null | undefined }) {
  if (!value) return <span className="text-muted-foreground">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          dateTime={new Date(value).toISOString()}
          suppressHydrationWarning
          className="whitespace-nowrap"
        >
          {formatRelative(value)}
        </time>
      </TooltipTrigger>
      <TooltipContent>{formatDateTime(value)}</TooltipContent>
    </Tooltip>
  );
}
