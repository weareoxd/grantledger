import type { Metadata } from "next";
import { RecipientsAdmin } from "@/components/admin/entities";
import { adminParams, listRecipients, RECIPIENT_SORTS } from "@/lib/admin/queries";

export const metadata: Metadata = { title: "Recipients · Admin" };

export default async function RecipientsAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const search = await searchParams;
  const params = adminParams(search, RECIPIENT_SORTS);
  const placeholders =
    search.placeholders === "only" || search.placeholders === "hide"
      ? search.placeholders
      : undefined;
  const page = await listRecipients({ ...params, placeholders });
  return (
    <RecipientsAdmin
      rows={page.rows}
      total={page.total}
      state={params}
      placeholders={placeholders ?? ""}
    />
  );
}
