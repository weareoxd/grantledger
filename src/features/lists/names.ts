"use client";

import { type QueryClient, skipToken, useQuery } from "@tanstack/react-query";

import type { ListEnvelope, ScopeParams } from "./types";

type Kind = "ministry" | "program" | "recipient";

const nameKey = (kind: Kind, id: string | undefined) => ["entity-name", kind, id] as const;

/** Remember a ministry's, program's or recipient's name, e.g. from its row */
export function rememberName(queryClient: QueryClient, kind: Kind, id: string, name: string) {
  queryClient.setQueryData(nameKey(kind, id), name);
}

/**
 * Ministry, program and recipient names for breadcrumbs and navigation,
 * remembered from the list responses that carry them (there's no detail
 * endpoint)
 */
export function rememberNames(
  queryClient: QueryClient,
  params: ScopeParams,
  envelope: Pick<ListEnvelope, "ministry" | "program" | "recipient">,
) {
  if (params.ministry_id && envelope.ministry) {
    rememberName(queryClient, "ministry", params.ministry_id, envelope.ministry);
  }
  if (params.program_id && envelope.program) {
    rememberName(queryClient, "program", params.program_id, envelope.program);
  }
  if (params.recipient_id && envelope.recipient) {
    rememberName(queryClient, "recipient", params.recipient_id, envelope.recipient);
  }
}

export function useEntityName(kind: Kind, id: string | undefined) {
  const { data } = useQuery<string>({
    queryKey: nameKey(kind, id),
    queryFn: skipToken,
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return id ? data : undefined;
}
