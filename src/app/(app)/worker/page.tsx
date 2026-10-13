import type { Metadata } from "next";
import { PageHeader, PageShell } from "@/components/page-parts";
import { RunsTable } from "@/components/worker/runs-table";
import { SchedulePanel } from "@/components/worker/schedule-panel";
import { WorkerLive } from "@/components/worker/worker-live";
import { requireAdmin } from "@/lib/auth/session";
import { getSchedules, listImportRuns } from "@/lib/queries/worker";
import { getSetting } from "@/lib/settings";

export const metadata: Metadata = { title: "Worker" };
export const dynamic = "force-dynamic";

/** Admins only: anyone else goes back to the home page. */
export default async function WorkerPage() {
  await requireAdmin("/worker");
  const [schedules, runs, paused] = await Promise.all([
    getSchedules(),
    listImportRuns(500),
    getSetting("paused"),
  ]);

  return (
    <PageShell>
      <PageHeader
        title="Worker"
        description="The background process that downloads the governments' open data and imports it: what it is doing, what is waiting, and every file it has handled."
      />
      <WorkerLive />
      <SchedulePanel schedules={schedules} paused={paused} />
      <section className="space-y-3">
        <div>
          <h2 className="font-semibold text-lg tracking-tight">History</h2>
          <p className="text-muted-foreground text-sm">
            Every file downloaded. An unchanged file is skipped; a changed one replaces its earlier
            rows.
          </p>
        </div>
        <RunsTable runs={runs} />
      </section>
    </PageShell>
  );
}
