"use client";

import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ListColumn } from "@/features/lists/types";
import { apiUrl } from "@/lib/api/client";
import { ApiError } from "@/lib/api/errors";
import { formatNumber } from "@/lib/format";

import { downloadFile } from "./csv";

// Above this, confirm first: it takes a while to download
const LARGE_EXPORT = 50_000;
// An Excel sheet's rows, but for the header: the API stops there
export const EXPORT_MAX_ROWS = 1_048_575;

type ExportButtonProps = {
  path: string;
  /** The table's API query; the export drops its paging */
  params: URLSearchParams;
  columns: ListColumn[];
  count: number;
  /** The count is the last page's, while the next loads */
  stale: boolean;
  filename: string;
};

/**
 * Download every row matching the filters, with the visible columns: the
 * API writes the CSV and streams it, up to as many rows as Excel opens
 */
export function ExportButton({ path, params, columns, count, stale, filename }: ExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const run = async () => {
    setConfirming(false);
    setBusy(true);
    try {
      // The list's filters and sort as for a page, the columns in the body:
      // all of a list's can be more than a URL holds
      const query = new URLSearchParams(params);
      query.delete("page");
      query.delete("page_size");
      const response = await fetch(apiUrl(path, query), {
        credentials: "same-origin",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          columns: columns.map(({ id, header }) => ({ id, header })),
        }),
      });
      if (!response.ok) {
        throw new ApiError(response.status, await response.json().catch(() => null));
      }
      downloadFile(await response.blob(), `${filename}.csv`);
      const rows = Number(response.headers.get("X-Export-Rows") ?? count);
      if (response.headers.get("X-Export-Truncated") === "true") {
        toast.warning(`Exported the first ${formatNumber(rows)} rows`, {
          description: `That's as many as Excel opens. Filters narrow the export to the rows you need.`,
        });
      } else {
        toast.success(`Exported ${formatNumber(rows)} rows`);
      }
    } catch (error) {
      toast.error("Export failed", {
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={busy || stale || count === 0}
        onClick={() => (count > LARGE_EXPORT ? setConfirming(true) : run())}
      >
        {busy ? <Spinner /> : <DownloadIcon />}
        Export
      </Button>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Export {formatNumber(count)} rows?</AlertDialogTitle>
            <AlertDialogDescription>
              {count > EXPORT_MAX_ROWS
                ? `Excel opens at most ${formatNumber(EXPORT_MAX_ROWS)} rows, so the file stops there. `
                : ""}
              Large exports can take a few minutes to download. Filters narrow the export to the
              rows you need.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={run}>Export</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
