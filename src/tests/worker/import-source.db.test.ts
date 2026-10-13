// The import job end to end: a local server stands in for the governments' sites.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getPool } from "@/lib/db";
import { resetEnvCache } from "@/lib/env";
import { checkRollup } from "@/lib/grants/rollup";
import { ALBERTA_ARCHIVE, albertaFileName } from "@/lib/grants/sources";
import { scheduledSources } from "@/lib/queue";
import { setSetting } from "@/lib/settings";
import { resetDb } from "@/tests/db/helpers";
import { importSource } from "@/worker/jobs/import-source";
import { startServer, type TestServer } from "./server";

const LIVE_HEADER =
  '"Ministry","BUName","Recipient","Program","Amount","PaymentDate","DisplayFiscalYear","LotteryFund",\r\n';
const liveRow = (recipient: string, amount: string) =>
  `"ADVANCED EDUCATION","ADVANCED EDUCATION","${recipient}","PSI OPER & PROG SUPPORT","${amount}","4/2/2026 12:00:00 AM","2026 - 2027","",\r\n`;

const FEDERAL = [
  "ref_number,amendment_number,agreement_type,recipient_type,recipient_legal_name,prog_name_en,agreement_value,agreement_start_date,owner_org_title",
  "R1,0,G,N,Example University,Research,1000,2026-05-01,Example Agency Canada | Agence",
  "R1,1,G,N,Example University,Research,1500,2026-05-01,Example Agency Canada | Agence",
].join("\n");

let server: TestServer;
let dataDir: string;

async function runs() {
  return (
    await getPool().query(
      "SELECT source, status, source_file, rows_imported, rows_replaced, error FROM import_run ORDER BY id",
    )
  ).rows;
}

beforeEach(async () => {
  await resetDb();
  server = await startServer();
  dataDir = mkdtempSync(join(tmpdir(), "worker-data-"));
  vi.stubEnv("DATA_DIR", dataDir);
  vi.stubEnv("ALBERTA_LIVE_URL", `${server.url}/export.csv`);
  vi.stubEnv("FEDERAL_GRANTS_URL", `${server.url}/grants.csv`);
  vi.stubEnv("ALBERTA_ARCHIVE_BASE", `${server.url}/archive`);
  vi.stubEnv("FEDERAL_IMPORTS_ENABLED", "true");
  resetEnvCache();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  resetEnvCache();
  await server.close();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("importSource", () => {
  it("imports the live export under its fiscal year, then skips it while unchanged", async () => {
    server.files.set(
      "/export.csv",
      Buffer.from(LIVE_HEADER + liveRow("EXAMPLE UNIVERSITY", "1036000.000")),
    );
    await importSource({ source: "alberta_live", trigger: "manual" });
    expect(await runs()).toEqual([
      {
        source: "alberta_live",
        status: "succeeded",
        source_file: "tbf-grants-disclosure-2026-27.csv",
        rows_imported: 1,
        rows_replaced: 0,
        error: null,
      },
    ]);
    expect(
      (
        await getPool().query(
          "SELECT SUM(n_awards)::int AS n FROM award_rollup WHERE fiscal_year = 0",
        )
      ).rows[0].n,
    ).toBe(1);
    expect(await checkRollup()).toEqual([]);

    // Unchanged: the server answers 304 to the stored ETag
    await importSource({ source: "alberta_live", trigger: "schedule" });
    expect((await runs())[1]).toMatchObject({
      status: "skipped",
      error: expect.stringContaining("Unchanged"),
    });

    // Changed: the new export replaces the file's rows
    server.files.set(
      "/export.csv",
      Buffer.from(
        LIVE_HEADER +
          liveRow("EXAMPLE UNIVERSITY", "5.000") +
          liveRow("OTHER COLLEGE SOCIETY", "7.000"),
      ),
    );
    await importSource({ source: "alberta_live", trigger: "manual" });
    expect((await runs())[2]).toMatchObject({
      status: "succeeded",
      rows_imported: 2,
      rows_replaced: 1,
    });
    expect((await getPool().query("SELECT SUM(value)::text AS v FROM award")).rows[0].v).toBe(
      "12.00",
    );
  });

  it("imports again when forced", async () => {
    server.files.set(
      "/export.csv",
      Buffer.from(LIVE_HEADER + liveRow("EXAMPLE UNIVERSITY", "1.000")),
    );
    await importSource({ source: "alberta_live", trigger: "manual" });
    await importSource({ source: "alberta_live", trigger: "manual", force: true });
    expect((await runs())[1]).toMatchObject({ status: "succeeded", rows_replaced: 1 });
  });

  it("imports the federal file and flags the current amendment", async () => {
    server.files.set("/grants.csv", Buffer.from(FEDERAL));
    await importSource({ source: "federal", trigger: "manual" });
    expect((await runs())[0]).toMatchObject({
      status: "succeeded",
      source_file: "grants.csv",
      rows_imported: 2,
    });
    const current = await getPool().query("SELECT value FROM award WHERE is_current");
    expect(current.rows).toEqual([{ value: "1500.00" }]);
  });

  it("downloads nothing federal while federal imports are turned off", async () => {
    vi.stubEnv("FEDERAL_IMPORTS_ENABLED", "");
    resetEnvCache();
    server.files.set("/grants.csv", Buffer.from(FEDERAL));
    await importSource({ source: "federal", trigger: "manual" });
    expect(await runs()).toMatchObject([
      {
        status: "skipped",
        error: "Federal imports are turned off. Set FEDERAL_IMPORTS_ENABLED=true to run them.",
      },
    ]);
    expect(server.requests).toEqual([]);
    const awards = await getPool().query("SELECT count(*)::int AS n FROM award");
    expect(awards.rows[0].n).toBe(0);
    expect(scheduledSources().map((s) => s.source)).toEqual(["alberta_live"]);
    vi.stubEnv("FEDERAL_IMPORTS_ENABLED", "true");
    resetEnvCache();
    expect(scheduledSources().map((s) => s.source)).toEqual(["alberta_live", "federal"]);
  });

  it("does nothing on schedule while paused", async () => {
    await setSetting("paused", true);
    server.files.set(
      "/export.csv",
      Buffer.from(LIVE_HEADER + liveRow("EXAMPLE UNIVERSITY", "1.000")),
    );
    await importSource({ source: "alberta_live", trigger: "schedule" });
    expect(await runs()).toEqual([
      expect.objectContaining({
        status: "skipped",
        error: "Imports are paused",
        rows_imported: null,
      }),
    ]);
    expect(server.requests).toEqual([]);
  });

  it("rebuilds the totals for the files imported before a later one fails", async () => {
    // The first yearly file is there (its rows in the live export's layout, which the importer
    // also reads); the second is missing on the server
    const [resource, fiscalYear] = ALBERTA_ARCHIVE[0] as [string, string];
    server.files.set(
      `/archive/${resource}/download/${albertaFileName(fiscalYear)}`,
      Buffer.from(LIVE_HEADER + liveRow("EXAMPLE UNIVERSITY", "1036000.000")),
    );
    await expect(importSource({ source: "alberta_archive", trigger: "manual" })).rejects.toThrow(
      /HTTP 404/,
    );
    const all = await runs();
    expect(all[0]).toMatchObject({
      status: "failed",
      rows_imported: 1,
      error: expect.stringContaining("Imported, but a later file in the same run failed"),
    });
    expect(all[1]).toMatchObject({ status: "failed", error: expect.stringContaining("HTTP 404") });
    // The imported file's rows are in the totals behind the lists
    const rollup = await getPool().query("SELECT count(*)::int AS n FROM award_rollup");
    expect(rollup.rows[0].n).toBeGreaterThan(0);
    expect(await checkRollup()).toEqual([]);
    // Its file counts as imported: the next run doesn't import it again
    await expect(importSource({ source: "alberta_archive", trigger: "manual" })).rejects.toThrow(
      /HTTP 404/,
    );
    expect((await runs())[12]).toMatchObject({
      status: "skipped",
      error: expect.stringContaining("Unchanged since the last import"),
    });
  });

  it("records a failed download and skips the rest of the batch", async () => {
    // The archive's first yearly file is missing on the server
    await expect(importSource({ source: "alberta_archive", trigger: "manual" })).rejects.toThrow(
      /HTTP 404/,
    );
    const all = await runs();
    expect(all).toHaveLength(12);
    expect(all[0]).toMatchObject({ status: "failed", error: expect.stringContaining("HTTP 404") });
    expect(all.slice(1).every((run) => run.status === "skipped")).toBe(true);
    expect((await getPool().query("SELECT COUNT(*)::int AS n FROM award")).rows[0].n).toBe(0);
  });
});
