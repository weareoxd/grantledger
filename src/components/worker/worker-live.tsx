"use client";

import { cn } from "cn";
import { Loader2Icon, XIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { cancelQueuedImport } from "@/actions/worker";
import { EmptyState, StatCard, StatGrid } from "@/components/page-parts";
import { RelativeTime } from "@/components/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IMPORT_SOURCE_LABELS } from "@/lib/domain";
import { formatBytes } from "@/lib/format-time";
import type { QueuedImport } from "@/lib/queries/worker";
import { RunStatusBadge } from "./run-status-badge";
import { ProgressBar, progressOf, workerSummary } from "./worker-indicator";
import { useWorkerStatus } from "./worker-status-provider";

const numbers = new Intl.NumberFormat("en-CA");

function CancelButton({ job }: { job: QueuedImport }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={pending}
      aria-label={`Remove ${IMPORT_SOURCE_LABELS[job.source]} from the queue`}
      onClick={() =>
        startTransition(async () => {
          const result = await cancelQueuedImport(job.jobId);
          if (!result.ok) toast.error(result.error);
          else {
            toast.success("Removed from the queue");
            router.refresh();
          }
        })
      }
    >
      <XIcon />
    </Button>
  );
}

/** Live worker status, current step and queue (from the shared poller). */
export function WorkerLive() {
  const snapshot = useWorkerStatus();
  const { worker, queued, active, failedLast24h } = snapshot;
  const summary = workerSummary(snapshot);
  const progress = progressOf(worker);
  const running = active.filter((run) => run.status !== "queued").length;

  return (
    <>
      <StatGrid>
        <StatCard
          label="Worker"
          value={
            <span
              className={cn(
                worker?.online ? "text-emerald-700 dark:text-emerald-400" : "text-destructive",
              )}
            >
              {worker?.online ? "Online" : "Offline"}
            </span>
          }
          hint={
            worker ? (
              worker.online ? (
                <>
                  Up since <RelativeTime value={worker.startedAt} />
                </>
              ) : (
                <>
                  Last heard from <RelativeTime value={worker.heartbeatAt} />
                </>
              )
            ) : (
              "Never reported in"
            )
          }
        />
        <StatCard
          label="Running"
          value={running}
          hint={
            active.length > running
              ? `${active.length - running} file waiting its turn`
              : "Files in progress"
          }
        />
        <StatCard label="Queued" value={queued.length} hint="Imports waiting to start" />
        <StatCard
          label="Failed, last 24 h"
          value={
            <span className={cn(failedLast24h > 0 && "text-destructive")}>{failedLast24h}</span>
          }
          hint={failedLast24h > 0 ? "See the history below" : "All good"}
        />
      </StatGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Now</CardTitle>
            <CardDescription>What the worker is doing, updated every few seconds.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!worker?.online ? (
              <p className="text-muted-foreground text-sm">
                The worker isn't running, so nothing is imported. Locally it starts with{" "}
                <code>make start</code>; in production check the <code>worker</code> container.
              </p>
            ) : worker.state === "idle" ? (
              <p className="text-muted-foreground text-sm">
                Idle. Imports start on their schedule or when an admin runs one.
              </p>
            ) : (
              <>
                <div className="flex items-center gap-2 text-sm">
                  <Loader2Icon className="size-4 animate-spin text-chart-1" />
                  <span className="font-medium">{summary.label}</span>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  {worker.source && (
                    <>
                      <dt className="text-muted-foreground">Source</dt>
                      <dd>{IMPORT_SOURCE_LABELS[worker.source]}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">Step</dt>
                  <dd>{worker.message}</dd>
                  {worker.state === "importing" && worker.progressCurrent !== null && (
                    <>
                      <dt className="text-muted-foreground">Rows read</dt>
                      <dd className="tabular-nums">{numbers.format(worker.progressCurrent)}</dd>
                    </>
                  )}
                </dl>
                {progress && (
                  <div className="space-y-1">
                    <ProgressBar current={progress.current} total={progress.total} />
                    <div className="text-muted-foreground text-xs tabular-nums">
                      {formatBytes(progress.current)}
                      {progress.total !== null && ` of ${formatBytes(progress.total)}`}{" "}
                      {worker.state === "downloading" ? "downloaded" : "read"}
                    </div>
                  </div>
                )}
              </>
            )}
            {active.length > 0 && (
              <ul className="space-y-1 border-t pt-3 text-sm">
                {active.map((run) => (
                  <li key={run.id} className="flex items-center justify-between gap-2">
                    <span className="truncate">
                      {run.sourceFile ?? IMPORT_SOURCE_LABELS[run.source]}
                    </span>
                    <RunStatusBadge status={run.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Queue</CardTitle>
            <CardDescription>
              Imports waiting to start. The worker runs one at a time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {queued.length === 0 ? (
              <EmptyState title="Nothing queued">Use “Run now” below to add one.</EmptyState>
            ) : (
              <ul className="divide-y">
                {queued.map((job) => (
                  <li key={job.jobId} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1 text-sm">
                      <div className="font-medium">{IMPORT_SOURCE_LABELS[job.source]}</div>
                      <div className="text-muted-foreground text-xs">
                        Queued <RelativeTime value={job.createdOn} />
                        {job.force && " · even if unchanged"}
                      </div>
                    </div>
                    <Badge variant="outline">
                      {job.trigger === "manual" ? "Run now" : "Scheduled"}
                    </Badge>
                    <CancelButton job={job} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
