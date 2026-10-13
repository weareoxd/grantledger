import { NamedListPage } from "@/features/lists/ListPage";
import { scopeParams } from "@/features/lists/page-params";

export default async function Page({
  params,
}: {
  params: Promise<{ organization_id: string; ministry_id: string }>;
}) {
  await scopeParams(params);
  return <NamedListPage list="ministryProgramsList" />;
}
