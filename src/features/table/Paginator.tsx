"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatNumber } from "@/lib/format";

import { PAGE_SIZES, type PageSize } from "./state/schema";

type PaginatorProps = {
  page: number;
  size: PageSize;
  count: number;
  noun: { one: string; other: string };
  onPageChange: (page: number) => void;
  onSizeChange: (size: PageSize) => void;
};

export function Paginator({ page, size, count, noun, onPageChange, onSizeChange }: PaginatorProps) {
  const pages = Math.max(1, Math.ceil(count / size));
  const first = count === 0 ? 0 : (page - 1) * size + 1;
  const last = Math.min(page * size, count);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-muted-foreground text-sm"
    >
      <p aria-live="polite">
        {count === 0
          ? `No ${noun.other}`
          : `${formatNumber(first)}–${formatNumber(last)} of ${formatNumber(count)} ${count === 1 ? noun.one : noun.other}`}
      </p>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span id="rows-per-page">Rows per page</span>
          <Select
            value={String(size)}
            onValueChange={(value) => onSizeChange(Number(value) as PageSize)}
          >
            <SelectTrigger size="sm" className="w-18" aria-labelledby="rows-per-page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="tabular-nums">
          Page {formatNumber(page)} of {formatNumber(pages)}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="First page"
            disabled={page <= 1}
            onClick={() => onPageChange(1)}
          >
            <ChevronsLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Next page"
            disabled={page >= pages}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRightIcon />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Last page"
            disabled={page >= pages}
            onClick={() => onPageChange(pages)}
          >
            <ChevronsRightIcon />
          </Button>
        </div>
      </div>
    </nav>
  );
}
