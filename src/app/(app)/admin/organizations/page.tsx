import type { Metadata } from "next";
import { OrganizationsAdmin } from "@/components/admin/entities";
import { listOrganizations } from "@/lib/admin/queries";

export const metadata: Metadata = { title: "Governments · Admin" };

export default async function OrganizationsAdminPage() {
  return <OrganizationsAdmin rows={await listOrganizations()} />;
}
