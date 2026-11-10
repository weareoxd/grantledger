"use client";

import { cn } from "cn";
import { CheckIcon, Columns3Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ListColumn } from "@/features/lists/types";

type ColumnPickerProps = {
  columns: ListColumn[];
  visible: string[];
  onChange: (visible: string[]) => void;
  onReset: () => void;
};

/** Choose the table's columns; they keep their place in the table */
export function ColumnPicker({ columns, visible, onChange, onReset }: ColumnPickerProps) {
  const shown = new Set(visible);
  const groups = new Map<string, ListColumn[]>();
  for (const column of columns) {
    const group = column.group ?? "Columns";
    groups.set(group, [...(groups.get(group) ?? []), column]);
  }

  const toggle = (id: string) => {
    if (shown.has(id)) {
      // Always keep one column
      if (shown.size > 1) onChange(visible.filter((column) => column !== id));
    } else {
      onChange(
        columns.map((column) => column.id).filter((column) => shown.has(column) || column === id),
      );
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3Icon />
          Columns
          <span className="text-muted-foreground tabular-nums">
            {shown.size}/{columns.length}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Find a column…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No columns match.</CommandEmpty>
            {[...groups].map(([group, groupColumns]) => (
              <CommandGroup key={group} heading={group}>
                {groupColumns.map((column) => (
                  <CommandItem
                    key={column.id}
                    value={`${column.header} ${column.id}`}
                    onSelect={() => toggle(column.id)}
                    data-checked={shown.has(column.id)}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-sm border",
                        shown.has(column.id) && "border-primary bg-primary text-primary-foreground",
                      )}
                    >
                      {shown.has(column.id) && <CheckIcon className="size-3" />}
                    </span>
                    <span className="truncate">{column.header}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
          <CommandSeparator />
          <div className="p-1">
            <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onReset}>
              Reset to default columns
            </Button>
          </div>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
