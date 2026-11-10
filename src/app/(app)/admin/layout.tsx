import type { ReactNode } from "react";
import { AdminTabs } from "@/components/admin/admin-tabs";
import { PageHeader, PageShell } from "@/components/page-parts";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

/** The admin section: only for admins (the actions check again, each time). */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  await requireAdmin("/admin");
  return (
    <PageShell>
      <PageHeader
        title="Admin"
        description="Edit the grants data and people's roles. Edits show in the lists and overviews at once; the next import of a file replaces its rows with the file's."
      />
      <AdminTabs />
      {children}
    </PageShell>
  );
}
