// Import source files directly (without the worker), then prune and rebuild the rollup.
//
//   npm run import -- alberta data/alberta/tbf-grants-disclosure-*.csv
//   npm run import -- federal data/federal/grants.csv [--limit N] [--include-individuals]
import { parseArgs } from "node:util";
import { closeDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { getEnv, loadDotEnv } from "@/lib/env";
import { importAlberta } from "@/lib/grants/importers/alberta";
import { formatStats } from "@/lib/grants/importers/base";
import { importFederal } from "@/lib/grants/importers/federal";
import { pruneOrphans } from "@/lib/grants/importers/maintenance";
import { refreshRollup } from "@/lib/grants/rollup";

loadDotEnv();

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    limit: { type: "string" },
    "batch-size": { type: "string", default: "5000" },
    "include-individuals": { type: "boolean" },
  },
});

const [source, ...paths] = positionals;
try {
  if ((source !== "alberta" && source !== "federal") || paths.length === 0) {
    throw new Error(
      "Usage: import.ts <alberta|federal> <path...> [--limit N] [--batch-size N] [--include-individuals]",
    );
  }
  await runMigrations();
  const options = {
    limit: values.limit ? Number(values.limit) : null,
    batchSize: Number(values["batch-size"]),
    includeIndividuals: values["include-individuals"] ?? getEnv().IMPORT_INCLUDE_INDIVIDUALS,
  };
  for (const path of paths) {
    const started = Date.now();
    const stats =
      source === "federal"
        ? await importFederal(path, options)
        : await importAlberta(path, options);
    console.log(`${path}: ${formatStats(stats)} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  }
  console.log("Pruned records with no awards:", await pruneOrphans());
  const started = Date.now();
  const written = await refreshRollup();
  console.log(
    `Rollup rebuilt: ${written.toLocaleString("en-US")} rows in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
