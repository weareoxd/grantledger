import type { Metadata } from "next";
import { FiscalYearsAdmin } from "@/components/admin/entities";
import { listFiscalYears } from "@/lib/admin/queries";

export const metadata: Metadata = { title: "Fiscal years · Admin" };

export default async function FiscalYearsAdminPage() {
  return <FiscalYearsAdmin rows={await listFiscalYears()} />;
}
