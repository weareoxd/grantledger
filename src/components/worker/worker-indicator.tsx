"use client";

import { cn } from "cn";
import { ArrowRightIcon, ClockIcon, Loader2Icon } from "lucide-react";
import Link from "next/link";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { IMPORT_SOURCE_LABELS } from "@/lib/domain";
import { formatBytes } from "@/lib/format-time";
import type { WorkerInfo, WorkerSnapshot } from "@/lib/queries/worker";
import { useWorkerStatus } from "./worker-status-provider";

type Tone = "offline" | "busy" | "waiting" | "idle";

function Dot({ tone }: { tone: Tone }) {
  if (tone === "busy") return <Loader2Icon className="size-3.5 animate-spin text-chart-1" />;
  if (tone === "waiting") return <ClockIcon className="size-3.5 text-chart-4" />;
  return (
    <span className="relative flex size-2.5 items-center justify-center">
      {tone === "idle" && (
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500/40 [animation-duration:3s]" />
      )}
      <span
        className={cn(
          "relative inline-flex size-2 rounded-full",
          tone === "idle" ? "bg-emerald-500" : "bg-destructive",
        )}
      />
    </span>
  );
}

const PHASES: Partial<Record<WorkerInfo["state"], string>> = {
  downloading: "Downloading",
  importing: "Importing",
  pruning: "Pruning",
  rollup: "Totalling",
};

/** The share of the current step that's done (bytes while downloading, rows read while importing), or null. */
export function progressOf(
  worker: WorkerInfo | null,
): { current: number; total: number | null } | null {
  if (!worker?.online) return null;
  if (
    (worker.state === "downloading" || worker.state === "importing") &&
    worker.bytesDone !== null
  ) {
    return { current: worker.bytesDone, total: worker.bytesTotal };
  }
  return null;
}

/** One short line for the header: what the worker is doing right now. */
export function workerSummary(snapshot: WorkerSnapshot): { tone: Tone; label: string } {
  const { worker, queued } = snapshot;
  if (!worker?.online) return { tone: "offline", label: "Worker offline" };
  const phase = PHASES[worker.state];
  if (phase) {
    const source = worker.source ? IMPORT_SOURCE_LABELS[worker.source] : "";
    const progress = progressOf(worker);
    const percent = progress?.total
      ? ` ${Math.min(100, Math.round((progress.current / progress.total) * 100))}%`
      : "";
    return { tone: "busy", label: `${phase} ${source}${percent}`.trim() };
  }
  if (queued.length > 0) return { tone: "waiting", label: `${queued.length} queued` };
  return { tone: "idle", label: "Idle" };
}

export function ProgressBar({ current, total }: { current: number; total: number | null }) {
  const percent = total ? Math.min(100, Math.round((current / total) * 100)) : null;
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      <div
        className={cn(
          "h-full rounded-full bg-chart-1 transition-[width] duration-500",
          percent === null && "w-1/3 animate-pulse",
        )}
        style={percent === null ? undefined : { width: `${percent}%` }}
      />
    </div>
  );
}

/** Header pill with a popover of the worker's state and queue; links to the Worker page. */
export function WorkerIndicator() {
  const snapshot = useWorkerStatus();
  const { tone, label } = workerSummary(snapshot);
  const { worker, queued, failedLast24h } = snapshot;
  const progress = progressOf(worker);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="max-w-[16rem] gap-2 rounded-full px-2.5 font-normal text-muted-foreground"
          aria-label={`Worker: ${label}`}
        >
          <Dot tone={tone} />
          <span className="truncate tabular-nums max-sm:hidden">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div className="flex items-start gap-2">
          <div className="pt-1">
            <Dot tone={tone} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium text-sm">{label}</div>
            <div className="text-muted-foreground text-xs">
              {worker ? (
                worker.online ? (
                  <>
                    Heartbeat <RelativeTime value={worker.heartbeatAt} /> · up since{" "}
                    <RelativeTime value={worker.startedAt} />
                  </>
                ) : (
                  <>
                    Last heard from <RelativeTime value={worker.heartbeatAt} />. Start it with{" "}
                    <code>make start</code> or check the worker container.
                  </>
                )
              ) : (
                "The worker has never reported in."
              )}
            </div>
          </div>
        </div>

        {progress && (
          <div className="space-y-1.5">
            <div className="text-muted-foreground text-xs">{worker?.message}</div>
            <ProgressBar current={progress.current} total={progress.total} />
            <div className="text-muted-foreground text-xs tabular-nums">
              {formatBytes(progress.current)}
              {progress.total !== null && ` of ${formatBytes(progress.total)}`}
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <div className="font-medium text-muted-foreground text-xs">Queue</div>
          {queued.length === 0 ? (
            <div className="text-muted-foreground text-sm">Nothing waiting.</div>
          ) : (
            <ul className="space-y-1 text-sm">
              {queued.slice(0, 5).map((job) => (
                <li key={job.jobId} className="flex justify-between gap-2">
                  <span className="truncate">{IMPORT_SOURCE_LABELS[job.source]}</span>
                  <span className="shrink-0 text-muted-foreground text-xs">
                    {job.trigger === "manual" ? "Run now" : "Scheduled"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <span
            className={cn(
              "text-xs",
              failedLast24h > 0 ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {failedLast24h === 0 ? "No failures in 24 h" : `${failedLast24h} failed in 24 h`}
          </span>
          <Button asChild variant="ghost" size="sm">
            <Link href="/worker">
              Worker
              <ArrowRightIcon />
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
