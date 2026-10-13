"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/page-parts";
import { RelativeTime } from "@/components/relative-time";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IMPORT_SOURCE_LABELS, IMPORT_SOURCES, RUN_STATUSES } from "@/lib/domain";
import { formatBytes, formatDuration } from "@/lib/format-time";
import type { ImportRunRow } from "@/lib/queries/worker";
import { RunStatusBadge } from "./run-status-badge";

const numbers = new Intl.NumberFormat("en-CA");
const count = (value: number | null) => (value === null ? "—" : numbers.format(value));
const PAGE = 25;

/** Every file the worker has downloaded or imported, newest first. */
export function RunsTable({ runs }: { runs: ImportRunRow[] }) {
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState("all");
  const [shown, setShown] = useState(PAGE);
  const filtered = useMemo(
    () =>
      runs.filter(
        (run) =>
          (source === "all" || run.source === source) &&
          (status === "all" || run.status === status),
      ),
    [runs, source, status],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={source}
          onValueChange={(value) => {
            setSource(value);
            setShown(PAGE);
          }}
        >
          <SelectTrigger size="sm" className="w-56" aria-label="Source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {IMPORT_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {IMPORT_SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(value) => {
            setStatus(value);
            setShown(PAGE);
          }}
        >
          <SelectTrigger size="sm" className="w-40" aria-label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Any status</SelectItem>
            {RUN_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                <span className="capitalize">{s}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {filtered.length === 0 ? (
        <EmptyState title="No imports yet">
          Runs appear here once the worker has downloaded a file.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>File</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Size</TableHead>
                <TableHead className="text-right">Read</TableHead>
                <TableHead className="text-right">Imported</TableHead>
                <TableHead className="text-right">Replaced</TableHead>
                <TableHead className="text-right">Withheld</TableHead>
                <TableHead className="text-right">Malformed</TableHead>
                <TableHead>Notes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.slice(0, shown).map((run) => {
                const duration = formatDuration(run.startedAt, run.finishedAt);
                return (
                  <TableRow key={run.id}>
                    <TableCell>
                      <RelativeTime value={run.startedAt ?? run.createdAt} />
                      <div className="text-muted-foreground text-xs">
                        {run.trigger === "manual" ? "Manual" : "Scheduled"}
                        {duration && ` · ${duration}`}
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {IMPORT_SOURCE_LABELS[run.source]}
                    </TableCell>
                    <TableCell className="max-w-56 truncate font-mono text-xs">
                      {run.sourceFile ?? "—"}
                    </TableCell>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatBytes(run.bytesDownloaded)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{count(run.rowsRead)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(run.rowsImported)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(run.rowsReplaced)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(run.rowsWithheld)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {count(run.rowsMalformed)}
                    </TableCell>
                    <TableCell className="max-w-80 whitespace-normal text-muted-foreground text-xs">
                      {run.error}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {filtered.length > shown && (
        <Button variant="outline" size="sm" onClick={() => setShown(shown + PAGE)}>
          Show more ({numbers.format(filtered.length - shown)} left)
        </Button>
      )}
    </div>
  );
}
