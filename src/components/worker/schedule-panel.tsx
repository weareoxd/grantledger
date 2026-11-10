"use client";

import { PlayIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { runImportNow, setImportsPaused } from "@/actions/worker";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { IMPORT_SOURCE_LABELS, type ImportSource } from "@/lib/domain";
import { formatBytes } from "@/lib/format-time";
import type { SourceSchedule } from "@/lib/queries/worker";
import { RunStatusBadge } from "./run-status-badge";

const DESCRIPTIONS: Record<ImportSource, string> = {
  alberta_live: "Alberta's live export of the current fiscal year's payments.",
  alberta_archive:
    "Alberta's official yearly files, 2014-15 on. Rarely change; run after a new year is published.",
  federal: "The Government of Canada's grants and contributions (grants.csv, about 2.3 GB).",
};

/** "0 6 * * *" -> "Every day at 06:00"; anything else as written. */
function describeCron(cron: string) {
  const [minute, hour, day, month, weekday] = cron.split(/\s+/);
  const time =
    /^\d+$/.test(hour ?? "") && /^\d+$/.test(minute ?? "")
      ? `${hour?.padStart(2, "0")}:${minute?.padStart(2, "0")}`
      : null;
  if (time && day === "*" && month === "*") {
    if (weekday === "*") return `Every day at ${time}`;
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    if (/^[0-6]$/.test(weekday ?? "")) return `Every ${days[Number(weekday)]} at ${time}`;
  }
  return `Cron ${cron}`;
}

function RunNow({ source }: { source: ImportSource }) {
  const router = useRouter();
  const [force, setForce] = useState(false);
  const [pending, startTransition] = useTransition();
  const id = `force-${source}`;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <Checkbox id={id} checked={force} onCheckedChange={(value) => setForce(value === true)} />
        <Label htmlFor={id} className="font-normal text-muted-foreground text-xs">
          Even if unchanged
        </Label>
      </div>
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await runImportNow({ source, force });
            if (!result.ok) toast.error(result.error);
            else {
              toast.success(`${IMPORT_SOURCE_LABELS[source]} queued`);
              router.refresh();
            }
          })
        }
      >
        <PlayIcon />
        Run now
      </Button>
    </div>
  );
}

function PauseSwitch({ paused }: { paused: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <div className="flex items-center gap-2">
      <Switch
        id="paused"
        checked={!paused}
        disabled={pending}
        onCheckedChange={(on) =>
          startTransition(async () => {
            const result = await setImportsPaused(!on);
            if (!result.ok) toast.error(result.error);
            else {
              toast.success(on ? "Scheduled imports resumed" : "Scheduled imports paused");
              router.refresh();
            }
          })
        }
      />
      <Label htmlFor="paused" className="font-normal text-sm">
        Scheduled imports {paused ? "paused" : "on"}
      </Label>
    </div>
  );
}

/** Each source: when it runs, when it last ran, what it last imported, and Run now. */
export function SchedulePanel({
  schedules,
  paused,
}: {
  schedules: SourceSchedule[];
  paused: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sources</CardTitle>
        <CardDescription>
          {paused
            ? "Scheduled imports are paused: nothing starts on its own until they're resumed."
            : "Each source is downloaded on its schedule and imported only when the file has changed."}
        </CardDescription>
        <CardAction>
          <PauseSwitch paused={paused} />
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {schedules.map((schedule) => (
            <li
              key={schedule.source}
              className="flex flex-wrap items-start justify-between gap-4 py-4 first:pt-0 last:pb-0"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{IMPORT_SOURCE_LABELS[schedule.source]}</span>
                  {schedule.lastRun && <RunStatusBadge status={schedule.lastRun.status} />}
                </div>
                <p className="text-muted-foreground text-sm">{DESCRIPTIONS[schedule.source]}</p>
                <div className="text-muted-foreground text-xs">
                  {!schedule.enabled ? (
                    "Turned off: set FEDERAL_IMPORTS_ENABLED=true to download and import it"
                  ) : schedule.cron ? (
                    <>
                      {describeCron(schedule.cron)} ({schedule.timeZone})
                      {schedule.next && !paused && (
                        <>
                          {" "}
                          · next <RelativeTime value={schedule.next} />
                        </>
                      )}
                    </>
                  ) : (
                    "Runs when an admin starts it"
                  )}
                  {schedule.lastRun?.finishedAt && (
                    <>
                      {" "}
                      · last finished <RelativeTime value={schedule.lastRun.finishedAt} />
                    </>
                  )}
                </div>
                {schedule.files.length > 0 && (
                  <div className="text-muted-foreground text-xs">
                    {schedule.files.length === 1
                      ? `${schedule.files[0]?.sourceFile} · ${formatBytes(schedule.files[0]?.size)}`
                      : `${schedule.files.length} files · ${formatBytes(schedule.files.reduce((sum, f) => sum + (f.size ?? 0), 0))}`}
                  </div>
                )}
              </div>
              {schedule.enabled && <RunNow source={schedule.source} />}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
