"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

import { type TableSearch, tableSearchSchema } from "./state/schema";
import { parseSearch, stringifySearch } from "./state/search";

type Update = (search: TableSearch) => TableSearch;

/** The table state a query string holds; invalid values (a hand-edited link's) are dropped */
export function readTableSearch(searchStr: string): TableSearch {
  const parsed = tableSearchSchema.safeParse(parseSearch(searchStr));
  return parsed.success ? parsed.data : {};
}

/**
 * The current page's table state from the URL, and a way to change it. Each
 * change is a history entry, so Back undoes it.
 */
export function useTableSearch(adjust?: (search: TableSearch) => TableSearch) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const searchStr = searchParams?.toString() ?? "";
  const search = useMemo(() => readTableSearch(searchStr), [searchStr]);

  const setSearch = useCallback(
    (update: Update, options?: { replace?: boolean }) => {
      const next = update(search);
      const url = pathname + stringifySearch(adjust ? adjust(next) : next);
      if (options?.replace) router.replace(url, { scroll: false });
      else router.push(url, { scroll: false });
    },
    [search, pathname, router, adjust],
  );
  return [search, setSearch] as const;
}
