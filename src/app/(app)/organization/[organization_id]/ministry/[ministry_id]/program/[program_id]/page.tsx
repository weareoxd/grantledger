import { ProgramOverview } from "@/features/landing/overviews";
import { scopeParams } from "@/features/lists/page-params";

/** A program's own page: its lists, with what's in them */
export default async function Page({
  params,
}: {
  params: Promise<{ organization_id: string; ministry_id: string; program_id: string }>;
}) {
  const { organization_id, ministry_id, program_id } = await scopeParams(params);
  return (
    <ProgramOverview
      organizationId={organization_id}
      ministryId={ministry_id}
      programId={program_id}
    />
  );
}
