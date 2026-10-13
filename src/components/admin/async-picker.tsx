"use client";

import { cn } from "cn";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Option } from "@/lib/admin/queries";

/**
 * A searchable picker over a server search (recipients, programs: too many for a select). The
 * search runs as the user types, a moment after they stop.
 */
export function AsyncPicker({
  id,
  value,
  selectedLabel,
  onChange,
  search,
  placeholder,
  emptyText = "Nothing found.",
  noneLabel,
  disabled,
  invalid,
}: {
  id?: string;
  value: string;
  selectedLabel: string | null;
  onChange: (value: string, label: string | null) => void;
  search: (q: string) => Promise<Option[]>;
  placeholder: string;
  emptyText?: string;
  /** Offer clearing the value, with this label. */
  noneLabel?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const found = await search(q);
        if (!cancelled) setOptions(found);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, q, search]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-invalid={invalid}
          disabled={disabled}
          className="w-full justify-between font-normal"
        >
          <span className={cn("truncate", !selectedLabel && "text-muted-foreground")}>
            {selectedLabel ?? placeholder}
          </span>
          <ChevronsUpDownIcon className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput placeholder="Type to search…" value={q} onValueChange={setQ} />
          <CommandList>
            <CommandEmpty>{loading ? "Searching…" : emptyText}</CommandEmpty>
            <CommandGroup>
              {noneLabel && value && (
                <CommandItem
                  value="__none__"
                  onSelect={() => {
                    onChange("", null);
                    setOpen(false);
                  }}
                >
                  {noneLabel}
                </CommandItem>
              )}
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => {
                    onChange(option.value, option.label);
                    setOpen(false);
                  }}
                >
                  <CheckIcon
                    className={cn("size-4", option.value === value ? "opacity-100" : "opacity-0")}
                  />
                  <div className="min-w-0">
                    <div className="truncate">{option.label}</div>
                    {option.hint && option.hint !== option.label && (
                      <div className="truncate text-muted-foreground text-xs">{option.hint}</div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
