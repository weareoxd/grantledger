import type { Metadata } from "next";
import { MinistriesAdmin } from "@/components/admin/entities";
import {
  adminParams,
  listMinistries,
  MINISTRY_SORTS,
  organizationOptions,
} from "@/lib/admin/queries";

export const metadata: Metadata = { title: "Ministries · Admin" };

export default async function MinistriesAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const params = adminParams(search, MINISTRY_SORTS);
  const organizationId = Number(search.organization);
  const organization =
    Number.isSafeInteger(organizationId) && organizationId > 0 ? organizationId : undefined;
  const [page, organizations] = await Promise.all([
    listMinistries({ ...params, organizationId: organization }),
    organizationOptions(),
  ]);
  return (
    <MinistriesAdmin
      rows={page.rows}
      total={page.total}
      state={params}
      organizations={organizations}
      organization={organization ? String(organization) : ""}
    />
  );
}
