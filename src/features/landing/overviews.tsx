"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileTextIcon, LandmarkIcon, LayersIcon, UsersIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

import { ErrorState } from "@/components/ErrorState";
import { NotFound } from "@/components/NotFound";
import { ministriesList, ministryProgramsList, recipientsList } from "@/features/lists/configs";
import { rememberName, rememberNames } from "@/features/lists/names";
import {
  organizationsQueryOptions,
  recordKind,
  useOrganization,
} from "@/features/lists/organizations";
import type { LinkTarget, ListRow, ScopeParams } from "@/features/lists/types";
import { PLACEHOLDER_HELP } from "@/features/table/cells";
import { isApiError } from "@/lib/api/errors";
import type { RecordKind } from "@/lib/record-kind";

import { OverviewAnalytics } from "./analytics/OverviewAnalytics";
import { ministryNouns, recordNouns } from "./analytics/shared";
import { LandingPage, SummaryCard } from "./LandingPage";
import { entityRowQueryOptions } from "./queries";

/** A count, as a number (the API's may be missing) */
const count = (row: ListRow | undefined, field: string) =>
  row ? Number(row[field] ?? 0) : undefined;

/** The list a card leads to, unless there's nothing in it */
const linkIf = (n: number | undefined, target: LinkTarget) => (n ? target : null);

const capitalize = (text: string) => text[0]!.toUpperCase() + text.slice(1);

/** "Agreements" or "Payments", for a card */
const awardsTitle = (kind: RecordKind | undefined) => recordNouns(kind).title;
const ministriesTitle = (kind: RecordKind | undefined) => capitalize(ministryNouns(kind).many);

export function OrganizationOverview({ organizationId }: { organizationId: string }) {
  const organizations = useQuery(organizationsQueryOptions);
  const organization = organizations.data?.find(({ id }) => String(id) === organizationId);
  const kind = recordKind(organization);
  const params = { organization_id: organizationId };

  if (organizations.isError) {
    return <ErrorState error={organizations.error} onRetry={() => organizations.refetch()} />;
  }
  // Not an organization there is
  if (organizations.isSuccess && !organization) return <NotFound />;
  return (
    <LandingPage
      kind="Organization"
      name={organization?.name}
      description={
        organization?.source &&
        (organization.source_url ? (
          <>
            From the{" "}
            <a href={organization.source_url} target="_blank" rel="noreferrer" className="link">
              {organization.source}
            </a>
          </>
        ) : (
          `From the ${organization.source}`
        ))
      }
      analytics={<OverviewAnalytics scope={{ organizationId }} kind={kind} />}
    >
      <SummaryCard
        title={awardsTitle(kind)}
        icon={FileTextIcon}
        figure={organization?.award_count ?? undefined}
        detail={organization ? { amount: organization.award_value ?? 0 } : "loading"}
        link={linkIf(organization?.award_count ?? undefined, {
          to: "/organization/$organization_id/award",
          params,
        })}
      />
      <SummaryCard
        title={ministriesTitle(kind)}
        icon={LandmarkIcon}
        figure={organization?.ministry_count ?? undefined}
        link={linkIf(organization?.ministry_count ?? undefined, {
          to: "/organization/$organization_id/ministry",
          params,
        })}
      />
      <SummaryCard
        title="Recipients"
        icon={UsersIcon}
        figure={organization?.recipient_count ?? undefined}
        link={linkIf(organization?.recipient_count ?? undefined, {
          to: "/organization/$organization_id/recipient",
          params,
        })}
      />
    </LandingPage>
  );
}

export function MinistryOverview({
  organizationId,
  ministryId,
}: {
  organizationId: string;
  ministryId: string;
}) {
  const params = useMemo(
    () => ({ organization_id: organizationId, ministry_id: ministryId }),
    [organizationId, ministryId],
  );
  const { kind } = useOrganization(organizationId);
  const { row, query } = useEntityRow(
    "ministry",
    ministriesList.endpoint(params),
    ministryId,
    params,
  );

  const missing = useOrganizationMissing(organizationId);

  // Not an organization there is, or not one of its
  if (missing || isApiError(query.error, 404)) return <NotFound />;
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }
  // Gone since the page last loaded it (the data was loaded again)
  if (query.isSuccess && !row) return <NotFound />;
  const awards = count(row, "award_count");
  const programs = count(row, "program_count");
  const recipients = count(row, "recipient_count");
  return (
    <LandingPage
      kind={capitalize(ministryNouns(kind).one)}
      name={row && String(row.name)}
      analytics={<OverviewAnalytics scope={{ organizationId, ministryId }} kind={kind} />}
    >
      <SummaryCard
        title={awardsTitle(kind)}
        icon={FileTextIcon}
        figure={awards}
        detail={row ? { amount: Number(row.award_value ?? 0) } : "loading"}
        link={linkIf(awards, {
          to: "/organization/$organization_id/ministry/$ministry_id/award",
          params,
        })}
      />
      <SummaryCard
        title="Programs"
        icon={LayersIcon}
        figure={programs}
        link={linkIf(programs, {
          to: "/organization/$organization_id/ministry/$ministry_id/program",
          params,
        })}
      />
      <SummaryCard
        title="Recipients"
        icon={UsersIcon}
        figure={recipients}
        link={linkIf(recipients, {
          to: "/organization/$organization_id/ministry/$ministry_id/recipient",
          params,
        })}
      />
    </LandingPage>
  );
}

export function ProgramOverview({
  organizationId,
  ministryId,
  programId,
}: {
  organizationId: string;
  ministryId: string;
  programId: string;
}) {
  const params = useMemo(
    () => ({
      organization_id: organizationId,
      ministry_id: ministryId,
      program_id: programId,
    }),
    [organizationId, ministryId, programId],
  );
  const { kind } = useOrganization(organizationId);
  const { row, query } = useEntityRow(
    "program",
    ministryProgramsList.endpoint(params),
    programId,
    params,
  );

  const missing = useOrganizationMissing(organizationId);

  // Not an organization there is, or not one of its
  if (missing || isApiError(query.error, 404)) return <NotFound />;
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }
  if (query.isSuccess && !row) return <NotFound />;
  const awards = count(row, "award_count");
  const recipients = count(row, "recipient_count");
  return (
    <LandingPage
      kind="Program"
      name={row && String(row.name)}
      analytics={
        <OverviewAnalytics scope={{ organizationId, ministryId, programId }} kind={kind} />
      }
    >
      <SummaryCard
        title={awardsTitle(kind)}
        icon={FileTextIcon}
        figure={awards}
        detail={row ? { amount: Number(row.award_value ?? 0) } : "loading"}
        link={linkIf(awards, {
          to: "/organization/$organization_id/ministry/$ministry_id/program/$program_id/award",
          params,
        })}
      />
      <SummaryCard
        title="Recipients"
        icon={UsersIcon}
        figure={recipients}
        link={linkIf(recipients, {
          to: "/organization/$organization_id/ministry/$ministry_id/program/$program_id/recipient",
          params,
        })}
      />
    </LandingPage>
  );
}

export function RecipientOverview({
  organizationId,
  recipientId,
}: {
  organizationId: string;
  recipientId: string;
}) {
  const params = useMemo(
    () => ({ organization_id: organizationId, recipient_id: recipientId }),
    [organizationId, recipientId],
  );
  const { kind } = useOrganization(organizationId);
  const { row, query } = useEntityRow(
    "recipient",
    recipientsList.endpoint(params),
    recipientId,
    params,
  );

  const missing = useOrganizationMissing(organizationId);

  // Not an organization there is, or not one of its
  if (missing || isApiError(query.error, 404)) return <NotFound />;
  if (query.isError) {
    return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  }
  if (query.isSuccess && !row) return <NotFound />;
  const awards = count(row, "award_count");
  const ministries = count(row, "ministry_count");
  return (
    <LandingPage
      kind="Recipient"
      name={row && String(row.name)}
      description={row?.is_placeholder === true ? PLACEHOLDER_HELP : undefined}
      analytics={<OverviewAnalytics scope={{ organizationId, recipientId }} kind={kind} />}
    >
      <SummaryCard
        title={awardsTitle(kind)}
        icon={FileTextIcon}
        figure={awards}
        detail={row ? { amount: Number(row.award_value ?? 0) } : "loading"}
        link={linkIf(awards, {
          to: "/organization/$organization_id/recipient/$recipient_id/awards",
          params,
        })}
      />
      <SummaryCard
        title={ministriesTitle(kind)}
        icon={LandmarkIcon}
        figure={ministries}
        link={linkIf(ministries, {
          to: "/organization/$organization_id/recipient/$recipient_id/ministries",
          params,
        })}
      />
    </LandingPage>
  );
}

/**
 * A ministry's, program's or recipient's row of its list, its name (and
 * those of the list's own scope: a program's ministry) remembered for the
 * breadcrumbs and navigation
 */
function useEntityRow(
  kind: "ministry" | "program" | "recipient",
  path: string,
  id: string,
  params: ScopeParams,
) {
  const queryClient = useQueryClient();
  const query = useQuery(entityRowQueryOptions(path, id));
  const row = query.data?.data[0];
  const name = row ? String(row.name) : undefined;
  useEffect(() => {
    if (name) rememberName(queryClient, kind, id, name);
  }, [queryClient, kind, id, name]);
  useEffect(() => {
    if (query.data) rememberNames(queryClient, params, query.data);
  }, [queryClient, params, query.data]);
  return { row, query };
}

/** Whether the organizations have loaded, without this one */
function useOrganizationMissing(organizationId: string) {
  const { data } = useQuery(organizationsQueryOptions);
  return data !== undefined && !data.some(({ id }) => String(id) === organizationId);
}
