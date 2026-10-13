import { MinistryOverview } from "@/features/landing/overviews";
import { scopeParams } from "@/features/lists/page-params";

/** A ministry's own page: its lists, with what's in them */
export default async function Page({
  params,
}: {
  params: Promise<{ organization_id: string; ministry_id: string }>;
}) {
  const { organization_id, ministry_id } = await scopeParams(params);
  return <MinistryOverview organizationId={organization_id} ministryId={ministry_id} />;
}
