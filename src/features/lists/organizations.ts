"use client";

import { queryOptions, useQuery } from "@tanstack/react-query";

import { getJson } from "@/lib/api/client";
import type { OrganizationList, Organization as OrganizationRow } from "@/lib/api/types";
import { isRecordKind, type RecordKind } from "@/lib/record-kind";

export type Organization = OrganizationRow;

/** Both organizations, with what they publish and how: their names, kinds of
 * record, fiscal years and licences */
export const organizationsQueryOptions = queryOptions({
  queryKey: ["organizations"],
  queryFn: async ({ signal }) =>
    (
      await getJson<OrganizationList>(
        "/api/organization",
        new URLSearchParams({ sort: "name", page_size: "100" }),
        signal,
      )
    ).data,
  staleTime: 5 * 60_000,
});

/**
 * The organization, once the organizations have loaded. Its kind of record
 * decides columns, titles and the overviews' wording.
 */
export function useOrganization(organizationId: string | undefined) {
  const { data, isPending } = useQuery({
    ...organizationsQueryOptions,
    enabled: Boolean(organizationId),
  });
  if (!organizationId) {
    return { organization: undefined, kind: undefined, isLoading: false };
  }
  const organization = data?.find(({ id }) => String(id) === organizationId);
  return {
    organization,
    kind: recordKind(organization),
    // Not after a failure: the list shows the columns both kinds have
    isLoading: isPending,
  };
}

export function recordKind(organization: Organization | undefined): RecordKind | undefined {
  return isRecordKind(organization?.record_kind) ? organization.record_kind : undefined;
}
