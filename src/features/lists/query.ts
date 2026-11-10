import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import { getJson } from "@/lib/api/client";

import type { ListEnvelope } from "./types";

/**
 * One page of a list endpoint. The query string is in the key, so every
 * page/sort/filter combination is cached separately; while the next one
 * loads, the previous page stays on screen.
 */
export function listQueryOptions(path: string, params: URLSearchParams) {
  const query = params.toString();
  return queryOptions({
    queryKey: ["list", path, query],
    queryFn: ({ signal }) => fetchList(path, query, signal),
    placeholderData: keepPreviousData,
  });
}

export function fetchList(path: string, query: string, signal?: AbortSignal) {
  return getJson<ListEnvelope>(path, new URLSearchParams(query), signal);
}
