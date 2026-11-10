import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "@/app-shell/AppShell";
import { WorkerIndicator } from "@/components/worker/worker-indicator";
import { WorkerStatusProvider } from "@/components/worker/worker-status-provider";
import { requireUser } from "@/lib/auth/session";
import { getWorkerSnapshot } from "@/lib/queries/worker";

export const dynamic = "force-dynamic";

/**
 * Layout for every page in the app's shell (status pages stand alone). Only for whoever is signed
 * in: anyone else signs in first. The pages load their data in the browser, from /api; the
 * worker's status (admins only, like the Worker page) comes with the page and is kept fresh by
 * polling (WorkerStatusProvider).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  // An admin is checked against the database, so a demotion hides the admin links and the worker
  // at once, as the admin pages' own checks do. Anyone else's cached role can only be "user"
  // (a promotion shows in the nav within five minutes; the admin pages work at once).
  const cached = await requireUser();
  const user = cached.role === "admin" ? await requireUser(undefined, { fresh: true }) : cached;
  // The sidebar remembers whether it was collapsed in this cookie
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  const shell = (extras?: ReactNode) => (
    <AppShell
      user={{ email: user.email, name: user.name, image: user.image, role: user.role }}
      defaultSidebarOpen={sidebarOpen}
      headerExtras={extras}
    >
      {children}
    </AppShell>
  );
  if (user.role !== "admin") return shell();
  return (
    <WorkerStatusProvider initial={await getWorkerSnapshot()}>
      {shell(<WorkerIndicator />)}
    </WorkerStatusProvider>
  );
}
