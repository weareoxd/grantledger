import { OrganizationOverview } from "@/features/landing/overviews";
import { scopeParams } from "@/features/lists/page-params";

/** An organization's own page: its lists, with what's in them */
export default async function Page({ params }: { params: Promise<{ organization_id: string }> }) {
  const { organization_id } = await scopeParams(params);
  return <OrganizationOverview organizationId={organization_id} />;
}
