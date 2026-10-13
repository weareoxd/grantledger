"use client";

import { cn } from "cn";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SearchIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState, useTransition } from "react";
import { EmptyState } from "@/components/page-parts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export interface AdminColumn<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  className?: string;
  /** The sort key (?sort=) this column orders by. */
  sort?: string;
}

export interface AdminListState {
  q: string;
  page: number;
  size: number;
  sort: string;
}

const numbers = new Intl.NumberFormat("en-CA");

/** Change the list's URL (search, page, sort, filters); the server renders the new page. */
export function useListNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();
  const navigate = (changes: Record<string, string | number | null>, resetPage = true) => {
    const next = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    if (resetPage && !("page" in changes)) next.delete("page");
    const query = next.toString();
    startTransition(() =>
      router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }),
    );
  };
  return { navigate, pending };
}

/**
 * A page of records with a search box, sortable headers and paging, all in the URL: the server
 * component above it reads them and runs the query.
 */
export function AdminTable<T>({
  rows,
  total,
  approximate = false,
  state,
  columns,
  rowKey,
  rowActions,
  searchPlaceholder = "Search",
  toolbar,
  actions,
  noun,
}: {
  rows: T[];
  total: number;
  approximate?: boolean;
  state: AdminListState;
  columns: AdminColumn<T>[];
  rowKey: (row: T) => string | number;
  rowActions?: (row: T) => ReactNode;
  searchPlaceholder?: string;
  /** Filters beside the search box. */
  toolbar?: ReactNode;
  /** Buttons on the right (e.g. Add). */
  actions?: ReactNode;
  noun: { one: string; other: string };
}) {
  const { navigate, pending } = useListNavigation();
  const [q, setQ] = useState(state.q);
  useEffect(() => setQ(state.q), [state.q]);
  const pages = Math.max(1, Math.ceil(total / state.size));
  const first = total ? (state.page - 1) * state.size + 1 : 0;
  const last = (state.page - 1) * state.size + rows.length;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="relative"
            onSubmit={(event) => {
              event.preventDefault();
              navigate({ q: q.trim() });
            }}
          >
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              value={q}
              onChange={(event) => setQ(event.target.value)}
              onBlur={() => q.trim() !== state.q && navigate({ q: q.trim() })}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="w-64 pl-8"
            />
          </form>
          {toolbar}
          {pending && <Spinner className="text-muted-foreground" />}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>

      {rows.length === 0 ? (
        <EmptyState title={`No ${noun.other}`}>
          {state.q ? "Nothing matches the search. Try fewer words." : undefined}
        </EmptyState>
      ) : (
        <div
          className={cn(
            "overflow-x-auto rounded-lg border transition-opacity",
            pending && "opacity-60",
          )}
        >
          <Table>
            <TableHeader>
              <TableRow>
                {columns.map((column) => {
                  const active = column.sort && state.sort.replace(/^-/, "") === column.sort;
                  const desc = state.sort.startsWith("-");
                  return (
                    <TableHead key={column.key} className={column.className}>
                      {column.sort ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 hover:text-foreground"
                          onClick={() =>
                            navigate({
                              sort: active && !desc ? `-${column.sort}` : (column.sort as string),
                            })
                          }
                        >
                          {column.header}
                          {active &&
                            (desc ? (
                              <ArrowDownIcon className="size-3.5" />
                            ) : (
                              <ArrowUpIcon className="size-3.5" />
                            ))}
                        </button>
                      ) : (
                        column.header
                      )}
                    </TableHead>
                  );
                })}
                {rowActions && (
                  <TableHead className="w-10">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={rowKey(row)}>
                  {columns.map((column) => (
                    <TableCell key={column.key} className={column.className}>
                      {column.cell(row)}
                    </TableCell>
                  ))}
                  {rowActions && (
                    <TableCell className="w-10 text-right">{rowActions(row)}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 text-muted-foreground text-sm">
        <span className="tabular-nums">
          {total === 0
            ? `No ${noun.other}`
            : `${numbers.format(first)}–${numbers.format(last)} of ${approximate ? "about " : ""}${numbers.format(total)} ${total === 1 ? noun.one : noun.other}`}
        </span>
        <div className="flex items-center gap-2">
          <span>Rows per page</span>
          <Select value={String(state.size)} onValueChange={(size) => navigate({ size })}>
            <SelectTrigger size="sm" className="w-20" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[25, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="tabular-nums">
            Page {numbers.format(state.page)} of {approximate ? "about " : ""}
            {numbers.format(pages)}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={state.page <= 1}
            onClick={() => navigate({ page: state.page - 1 }, false)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={state.page >= pages}
            onClick={() => navigate({ page: state.page + 1 }, false)}
          >
            <ChevronRightIcon />
          </Button>
        </div>
      </div>
    </div>
  );
}

/** A select filter in the table's toolbar, kept in the URL as `name`. */
export function ToolbarSelect({
  name,
  value,
  options,
  allLabel,
  label,
  className,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  allLabel: string;
  label: string;
  className?: string;
}) {
  const { navigate } = useListNavigation();
  return (
    <Select
      value={value || "all"}
      onValueChange={(next) => navigate({ [name]: next === "all" ? null : next })}
    >
      <SelectTrigger size="sm" className={cn("w-52", className)} aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
