"use client";

import {
  createColumnHelper,
  rowSortingFeature,
  type SortingState,
  tableFeatures,
  type Updater,
  useTable,
} from "@tanstack/react-table";
import { cn } from "cn";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, FilterIcon } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import type { LinkContext, ListColumn, ListRow, ScopeParams } from "@/features/lists/types";
import { formatCurrency, formatNumber, formatRoundedCurrency } from "@/lib/format";

import { Cell } from "./cells";
import { FilterEditor } from "./FilterEditor";
import type { FieldFilter, Filters } from "./state/schema";
import { formatSort, parseSort } from "./state/table-state";
import { type ColumnWidths, useColumnWidths } from "./useColumnWidths";

const features = tableFeatures({ rowSortingFeature });
const helper = createColumnHelper<typeof features, ListRow>();

// Amounts and dates are usually wanted largest/newest first
const DESC_FIRST = new Set(["number", "currency", "fiscalYear", "date"]);
const NUMERIC = new Set(["number", "currency"]);
// Kept on one line: the rest (text) wraps to the column's width
const ONE_LINE = new Set(["number", "currency", "fiscalYear", "date", "boolean"]);
const FROZEN_DEFAULT_WIDTH = 220;
// Drags shorter than this are clicks, which change nothing
const DRAG_THRESHOLD = 3;
const FILLER_CELL = "border-b bg-background p-0 group-hover:bg-muted/50";

// The CSS variables a column's width and (frozen) offset are set in
const widthVar = (id: string) => `--width-${id}`;
const leftVar = (id: string) => `--left-${id}`;

function widthStyle(id: string): CSSProperties {
  const width = `var(${widthVar(id)})`;
  return { width, minWidth: width, maxWidth: width };
}

function stickyStyle(id: string): CSSProperties {
  return { ...widthStyle(id), position: "sticky", left: `var(${leftVar(id)})` };
}

type DataTableProps = {
  /** Visible columns, in order */
  columns: ListColumn[];
  rows: ListRow[];
  params: ScopeParams;
  /** What the cells' links carry along: the fiscal year and toggles in view */
  linkContext: LinkContext;
  sort: string | undefined;
  onSortChange: (sort: string | undefined) => void;
  filters: Filters;
  onFilterChange: (field: string, filter: FieldFilter | undefined) => void;
  /** Fields whose filter the API rejected */
  filterErrors: Record<string, string[]>;
  footerTotals: Record<string, number> | undefined;
  /** No data yet: show placeholder rows */
  loading: boolean;
  /** Refreshing data that's already shown */
  fetching: boolean;
  pageSize: number;
  empty: ReactNode;
  /** Fit the remaining height, scrolling inside when the rows don't fit */
  fill?: boolean;
  label: string;
  /**
   * Identifies the rows asked for (page, sort, filters): when it changes,
   * the table goes back to the top
   */
  scrollKey?: string;
  /** The kind of list, whose column widths the user's resizing sets */
  widthsKey?: string;
};

export function DataTable({
  columns,
  rows,
  params,
  linkContext,
  sort,
  onSortChange,
  filters,
  onFilterChange,
  filterErrors,
  footerTotals,
  loading,
  fetching,
  pageSize,
  empty,
  fill,
  label,
  scrollKey,
  widthsKey,
}: DataTableProps) {
  // New rows start at the top. Sideways position is kept, so the column
  // being read stays in view from page to page
  const scroller = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs for each new scrollKey
  useLayoutEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [scrollKey]);

  const byId = useMemo(() => new Map(columns.map((column) => [column.id, column])), [columns]);

  const tableColumns = useMemo(
    () =>
      helper.columns(
        columns.map((column) =>
          helper.accessor((row) => row[column.id], {
            id: column.id,
            header: column.header,
            enableSorting: column.sortable,
            sortDescFirst: DESC_FIRST.has(column.kind),
          }),
        ),
      ),
    [columns],
  );

  const sorting = useMemo<SortingState>(() => {
    const parsed = parseSort(sort);
    return parsed ? [{ id: parsed.field, desc: parsed.desc }] : [];
  }, [sort]);

  const table = useTable({
    features,
    columns: tableColumns,
    data: rows,
    getRowId: (row) => String(row.id),
    state: { sorting },
    onSortingChange: (updater: Updater<SortingState>) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const [first] = next;
      onSortChange(first ? formatSort(first.id, first.desc) : undefined);
    },
    manualSorting: true,
    enableMultiSort: false,
  });

  // Columns the user has resized; the rest fit their content
  const [widths, setWidth] = useColumnWidths(widthsKey);
  const frozen = useMemo(() => frozenOffsets(columns, widths), [columns, widths]);
  const showFooter =
    footerTotals !== undefined && columns.some((column) => hasTotal(column, footerTotals));

  // Widths (and the frozen columns' offsets) are set on the table, as CSS
  // variables its cells read: resizing a column changes them, and the body
  // isn't rendered again for each step of a drag
  const sized = columns
    .filter(({ id }) => widths[id] !== undefined)
    .map(({ id }) => id)
    .join(",");
  const frozenIds = [...frozen.keys()].join(",");
  const widthVars: Record<string, string> = {};
  for (const column of columns) {
    const offset = frozen.get(column.id);
    const width = offset?.width ?? widths[column.id];
    if (width !== undefined) widthVars[widthVar(column.id)] = `${width}px`;
    if (offset) widthVars[leftVar(column.id)] = `${offset.left}px`;
  }
  const columnStyle = useMemo(() => {
    const styles = new Map<string, CSSProperties>();
    for (const id of frozenIds.split(",")) {
      if (id) styles.set(id, stickyStyle(id));
    }
    for (const id of sized.split(",")) {
      if (id && !styles.has(id)) styles.set(id, widthStyle(id));
    }
    return (id: string) => styles.get(id);
  }, [sized, frozenIds]);

  // Rendered again when the rows or columns change, not as widths do
  const body = useMemo(() => {
    const sizedIds = new Set(sized.split(","));
    const frozenSet = frozenIds.split(",");
    const lastFrozen = frozenSet.at(-1);
    return rows.map((row) => (
      <tr key={String(row.id)} className="group">
        {columns.map((column) => {
          const isFrozen = frozenSet.includes(column.id);
          return (
            <td
              key={column.id}
              style={columnStyle(column.id)}
              className={cn(
                // Top-aligned, as wrapped text makes rows taller
                "h-9 border-b bg-background px-3 py-2 align-top group-hover:bg-muted/50",
                ONE_LINE.has(column.kind)
                  ? "whitespace-nowrap"
                  : // Long words (URLs) too, so a column can be narrower
                    // than them
                    "wrap-anywhere",
                isFrozen && "z-[1] group-hover:bg-muted",
                column.id === lastFrozen && "shadow-[inset_-1px_0_0_var(--border)]",
                NUMERIC.has(column.kind) && "text-right tabular-nums",
                column.kind === "boolean" && "text-center",
              )}
            >
              <Cell
                column={column}
                row={row}
                params={params}
                linkContext={linkContext}
                sized={sizedIds.has(column.id)}
              />
            </td>
          );
        })}
        <td aria-hidden className={FILLER_CELL} />
      </tr>
    ));
  }, [rows, columns, sized, frozenIds, columnStyle, params, linkContext]);

  return (
    <div
      ref={scroller}
      className={cn(
        "@container relative overflow-auto rounded-lg border bg-background",
        fill ? "min-h-0" : "max-h-[70svh]",
      )}
    >
      {fetching && !loading && (
        <div
          className="absolute inset-x-0 top-0 z-30 h-0.5 animate-pulse bg-brand"
          role="progressbar"
          aria-label="Loading"
        />
      )}
      <table
        className="w-max min-w-full border-separate border-spacing-0 text-sm"
        style={widthVars as CSSProperties}
        aria-label={label}
        aria-busy={loading || fetching}
      >
        <thead className="sticky top-0 z-20 bg-table-header">
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const column = byId.get(header.column.id)!;
                const sorted = header.column.getIsSorted();
                const offset = frozen.get(column.id);
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined
                    }
                    style={columnStyle(column.id)}
                    className={cn(
                      "relative h-9 border-b bg-table-header px-2 text-left align-middle font-medium text-table-header-foreground text-xs",
                      offset && "z-10",
                      offset?.last && "shadow-[inset_-1px_0_0_var(--border)]",
                    )}
                  >
                    <div
                      className={cn(
                        "flex items-center gap-0.5",
                        NUMERIC.has(column.kind) && "justify-end",
                      )}
                    >
                      {header.column.getCanSort() ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "-ml-1 flex items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-table-header-foreground/10",
                            sorted && "font-semibold",
                          )}
                        >
                          <span>{column.header}</span>
                          {sorted === "asc" ? (
                            <ArrowUpIcon className="size-3.5 text-brand" />
                          ) : sorted === "desc" ? (
                            <ArrowDownIcon className="size-3.5 text-brand" />
                          ) : (
                            <ArrowUpDownIcon className="size-3.5 opacity-40" />
                          )}
                        </button>
                      ) : (
                        <span className="px-1">{column.header}</span>
                      )}
                      {column.filterable && (
                        <ColumnFilterButton
                          column={column}
                          filter={filters[column.id]}
                          invalid={Boolean(filterErrors[column.id])}
                          onChange={(filter) => onFilterChange(column.id, filter)}
                        />
                      )}
                    </div>
                    <ResizeHandle
                      header={column.header}
                      // The table's right edge: kept inside it, so it
                      // doesn't scroll
                      edge={column === columns.at(-1)}
                      onResize={(width, done) => setWidth(column.id, width, done)}
                      onReset={() => setWidth(column.id, undefined)}
                    />
                  </th>
                );
              })}
              {/* Takes the width the columns don't fill, which would
                  otherwise stretch them past the widths they were given */}
              <th aria-hidden className="border-b bg-table-header p-0" />
            </tr>
          ))}
        </thead>
        <tbody>
          {loading ? (
            Array.from({ length: Math.min(pageSize, 12) }, (_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows, all alike
              <tr key={index}>
                {columns.map((column) => (
                  <td
                    key={column.id}
                    style={columnStyle(column.id)}
                    className="h-9 border-b bg-background px-3"
                  >
                    <Skeleton className="h-4 w-full min-w-12" />
                  </td>
                ))}
                <td aria-hidden className={FILLER_CELL} />
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              {/* Centred in the visible width (the scroll area's, via
                  cqw), not the table's, which can be far wider */}
              <td colSpan={columns.length + 1} className="h-40 p-0">
                <div className="sticky left-0 flex w-[100cqw] items-center justify-center p-6">
                  {empty}
                </div>
              </td>
            </tr>
          ) : (
            body
          )}
        </tbody>
        {showFooter && !loading && rows.length > 0 && (
          <tfoot className="sticky bottom-0 z-20">
            <tr>
              {columns.map((column, index) => {
                const offset = frozen.get(column.id);
                const total = hasTotal(column, footerTotals) ? footerTotals[column.id] : undefined;
                return (
                  <td
                    key={column.id}
                    style={columnStyle(column.id)}
                    className={cn(
                      "h-9 whitespace-nowrap border-t bg-table-header px-3 font-medium text-table-header-foreground",
                      offset && "z-10",
                      offset?.last && "shadow-[inset_-1px_0_0_var(--border)]",
                      NUMERIC.has(column.kind) && "text-right tabular-nums",
                    )}
                  >
                    {total !== undefined ? (
                      column.kind === "currency" ? (
                        <span title={formatCurrency(total)}>{formatRoundedCurrency(total)}</span>
                      ) : (
                        formatNumber(total)
                      )
                    ) : index === 0 ? (
                      "Total"
                    ) : null}
                  </td>
                );
              })}
              <td aria-hidden className="border-t bg-table-header p-0" />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/**
 * The edge of a column's header, dragged to resize the column, which
 * follows it (once a frame). Let go, the column's width is kept as it's
 * drawn: no narrower than its content allows. Double-click fits it to its
 * content again.
 */
function ResizeHandle({
  header,
  edge,
  onResize,
  onReset,
}: {
  header: string;
  /** At the table's right edge */
  edge: boolean;
  /** `done`: let go */
  onResize: (width: number, done: boolean) => void;
  onReset: () => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a draggable handle, which <hr> can't be
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${header}`}
      title="Drag to resize. Double-click to fit"
      className={cn(
        // Over the next header, but under the frozen ones
        "absolute inset-y-0 z-[1] w-2 cursor-col-resize touch-none select-none after:absolute after:inset-y-2 after:w-px after:bg-border hover:after:w-0.5 hover:after:bg-brand",
        edge ? "right-0 after:right-0" : "-right-1 after:left-1",
      )}
      onDoubleClick={onReset}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        const cell = event.currentTarget.parentElement;
        if (!cell) return;
        const view = event.currentTarget.ownerDocument.defaultView ?? window;
        const pointer = event.pointerId;
        const startX = event.clientX;
        const start = cell.getBoundingClientRect().width;
        let width: number | null = null;
        let frame: number | null = null;
        const move = (move: PointerEvent) => {
          if (move.pointerId !== pointer) return;
          // Let go where the page didn't hear it (over a context menu, say)
          if ((move.buttons & 1) === 0) return finish();
          const moved = move.clientX - startX;
          // A click that wobbles a little isn't a drag
          if (width === null && Math.abs(moved) < DRAG_THRESHOLD) return;
          width = start + moved;
          frame ??= view.requestAnimationFrame(() => {
            frame = null;
            if (width !== null) onResize(width, false);
          });
        };
        const end = (end: PointerEvent) => {
          if (end.pointerId === pointer) finish();
        };
        const finish = () => {
          view.removeEventListener("pointermove", move);
          view.removeEventListener("pointerup", end);
          view.removeEventListener("pointercancel", end);
          if (frame !== null) view.cancelAnimationFrame(frame);
          // Not moved: a click, which changes nothing
          if (width === null) return;
          const asked = width;
          flushSync(() => onResize(asked, false));
          // As drawn, wider than asked if its content needs it (nothing is
          // drawn without layout, as in tests: then as asked)
          onResize(Math.max(asked, cell.getBoundingClientRect().width), true);
        };
        view.addEventListener("pointermove", move);
        view.addEventListener("pointerup", end);
        view.addEventListener("pointercancel", end);
      }}
    />
  );
}

function ColumnFilterButton({
  column,
  filter,
  invalid,
  onChange,
}: {
  column: ListColumn;
  filter: FieldFilter | undefined;
  invalid: boolean;
  onChange: (filter: FieldFilter | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const active = Boolean(filter);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Filter by ${column.header}${active ? " (filtered)" : ""}`}
          className={cn(
            "text-table-header-foreground/50 hover:bg-table-header-foreground/10 hover:text-table-header-foreground",
            active && "text-brand hover:text-brand",
            invalid && "text-destructive",
          )}
        >
          <FilterIcon className={cn(active && "fill-current")} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 font-normal">
        <FilterEditor
          column={column}
          filter={filter}
          onApply={(next) => {
            setOpen(false);
            onChange(next);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Sticky positions for the columns that stay in view when scrolling
 * sideways: the first column, plus the frozen ones (a name) directly after
 * it, at the widths the user gave them
 */
function frozenOffsets(columns: ListColumn[], widths: ColumnWidths) {
  const offsets = new Map<string, { left: number; width: number; last: boolean }>();
  let left = 0;
  for (const [index, column] of columns.entries()) {
    if (index > 0 && !column.frozen) break;
    const width = widths[column.id] ?? column.width ?? FROZEN_DEFAULT_WIDTH;
    offsets.set(column.id, { left, width, last: false });
    left += width;
  }
  const last = [...offsets.values()].at(-1);
  if (last) last.last = true;
  return offsets;
}

function hasTotal(
  column: ListColumn,
  totals: Record<string, number> | undefined,
): totals is Record<string, number> {
  return NUMERIC.has(column.kind) && totals?.[column.id] !== undefined;
}
