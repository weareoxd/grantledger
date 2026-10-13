import { sql } from "drizzle-orm";
import type { Metadata } from "next";
import { AwardsAdmin } from "@/components/admin/awards";
import {
  AWARD_SORTS,
  type AwardFilters,
  adminParams,
  listAwards,
  ministryOptions,
  organizationOptions,
} from "@/lib/admin/queries";
import { getDb } from "@/lib/db";

export const metadata: Metadata = { title: "Awards · Admin" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const positive = (value: unknown) => {
  const number = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
};

export default async function AwardsAdminPage({ searchParams }: { searchParams: Search }) {
  const search = await searchParams;
  const params = adminParams(search, AWARD_SORTS);
  const current = search.current === "yes" ? "yes" : search.current === "no" ? "no" : undefined;
  const filters: AwardFilters = {
    organizationId: positive(search.organization),
    ministryId: positive(search.ministry),
    recipientId: positive(search.recipient),
    programId: positive(search.program),
    current,
  };
  const [page, ministries, organizations] = await Promise.all([
    listAwards({ ...params, ...filters }),
    ministryOptions(),
    organizationOptions(),
  ]);
  // A recipient or program from a link: name it in the toolbar
  let filterLabel: string | null = null;
  if (filters.recipientId || filters.programId) {
    const { rows } = await getDb().execute<{ name: string }>(
      filters.recipientId
        ? sql`SELECT display_name AS name FROM recipient WHERE id = ${filters.recipientId}`
        : sql`SELECT name FROM program WHERE id = ${filters.programId ?? 0}`,
    );
    filterLabel = `${filters.recipientId ? "Recipient" : "Program"}: ${rows[0]?.name ?? "not found"}`;
  }
  return (
    <AwardsAdmin
      rows={page.rows}
      total={page.total}
      approximate={page.approximate}
      state={params}
      ministries={ministries}
      organizations={organizations}
      filters={{
        organization: filters.organizationId ? String(filters.organizationId) : "",
        ministry: filters.ministryId ? String(filters.ministryId) : "",
        current: current ?? "",
      }}
      filterLabel={filterLabel}
    />
  );
}
