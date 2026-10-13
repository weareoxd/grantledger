import type { Metadata } from "next";
import { ProgramsAdmin } from "@/components/admin/entities";
import { adminParams, listPrograms, ministryOptions, PROGRAM_SORTS } from "@/lib/admin/queries";

export const metadata: Metadata = { title: "Programs · Admin" };

export default async function ProgramsAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const params = adminParams(search, PROGRAM_SORTS);
  const ministryId = Number(search.ministry);
  const ministry = Number.isSafeInteger(ministryId) && ministryId > 0 ? ministryId : undefined;
  const [page, ministries] = await Promise.all([
    listPrograms({ ...params, ministryId: ministry }),
    ministryOptions(),
  ]);
  return (
    <ProgramsAdmin
      rows={page.rows}
      total={page.total}
      state={params}
      ministries={ministries.map((m) => ({ value: m.value, label: `${m.label} (${m.hint})` }))}
      ministry={ministry ? String(ministry) : ""}
    />
  );
}
