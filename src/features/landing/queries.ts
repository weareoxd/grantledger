import { queryOptions } from "@tanstack/react-query";

import { listQueryOptions } from "@/features/lists/query";
import { toApiParams } from "@/features/table/state/api-params";
import { getJson } from "@/lib/api/client";
import type { OverviewSummary as Summary } from "@/lib/api/types";

/**
 * One row of a list: a ministry's, program's or recipient's figures, from
 * the list they're in (there's no detail endpoint). Under the list's key, so
 * it's refreshed with the lists; never shown with another row's figures
 */
export function entityRowQueryOptions(path: string, id: string) {
  const params = toApiParams({
    page: 1,
    size: 10,
    sort: undefined,
    filters: {
      id: {
        operator: "and",
        constraints: [{ matchMode: "equals", value: id }],
      },
    },
    fiscalYear: undefined,
    hidePlaceholders: false,
    includeSuperseded: false,
  });
  params.set("page_size", "1");
  return {
    ...listQueryOptions(path, params),
    placeholderData: undefined,
  };
}

export type OverviewSummary = Summary;

/** Which overview: an organization's, or one of its ministries', programs'
 * or recipients' */
export type OverviewScope = {
  organizationId: string;
  ministryId?: string;
  programId?: string;
  recipientId?: string;
};

/**
 * An overview's figures: this year to date against the last, by fiscal
 * year, what's new and who moved most
 */
export function summaryQueryOptions({
  organizationId,
  ministryId,
  programId,
  recipientId,
}: OverviewScope) {
  return queryOptions({
    queryKey: [
      "summary",
      organizationId,
      ministryId ?? null,
      programId ?? null,
      recipientId ?? null,
    ],
    queryFn: ({ signal }) =>
      getJson<OverviewSummary>(
        `${scopePath({ organizationId, ministryId, programId, recipientId })}/summary`,
        undefined,
        signal,
      ),
    staleTime: 5 * 60_000,
  });
}

/** The API path of an overview's scope: its organization's, ministry's, program's or recipient's */
function scopePath({ organizationId, ministryId, programId, recipientId }: OverviewScope) {
  const organization = `/api/organization/${organizationId}`;
  if (ministryId && programId) return `${organization}/ministry/${ministryId}/program/${programId}`;
  if (ministryId) return `${organization}/ministry/${ministryId}`;
  if (recipientId) return `${organization}/recipient/${recipientId}`;
  return organization;
}
