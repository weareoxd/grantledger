import { RecipientOverview } from "@/features/landing/overviews";
import { scopeParams } from "@/features/lists/page-params";

/** A recipient's own page: its lists, with what's in them */
export default async function Page({
  params,
}: {
  params: Promise<{ organization_id: string; recipient_id: string }>;
}) {
  const { organization_id, recipient_id } = await scopeParams(params);
  return <RecipientOverview organizationId={organization_id} recipientId={recipient_id} />;
}
