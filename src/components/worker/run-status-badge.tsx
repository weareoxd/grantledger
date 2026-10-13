import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import type { RunStatus } from "@/lib/domain";

const LABELS: Record<RunStatus, string> = {
  queued: "Queued",
  downloading: "Downloading",
  importing: "Importing",
  pruning: "Pruning",
  rollup: "Totalling",
  succeeded: "Imported",
  failed: "Failed",
  skipped: "Skipped",
};

const ACTIVE = "bg-chart-1/15 text-chart-1";
const TONES: Record<RunStatus, string> = {
  queued: "bg-muted text-muted-foreground",
  downloading: ACTIVE,
  importing: ACTIVE,
  pruning: ACTIVE,
  rollup: ACTIVE,
  succeeded: "bg-emerald-600/12 text-emerald-700 dark:text-emerald-400",
  failed: "bg-destructive/12 text-destructive",
  skipped: "bg-muted text-muted-foreground",
};

export function RunStatusBadge({ status, className }: { status: RunStatus; className?: string }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", TONES[status], className)}>
      {LABELS[status]}
    </Badge>
  );
}
