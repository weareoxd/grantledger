// Rebuild (or verify) the award rollup behind the web UI's aggregated lists.
//
//   npm run rollup [-- --check | --if-empty]
import { parseArgs } from "node:util";
import { closeDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { loadDotEnv } from "@/lib/env";
import { checkRollup, refreshRollup, rollupIsEmpty } from "@/lib/grants/rollup";

loadDotEnv();

const { values } = parseArgs({
  options: { check: { type: "boolean" }, "if-empty": { type: "boolean" } },
});

try {
  await runMigrations();
  if (values.check) {
    const problems = await checkRollup();
    if (problems.length) {
      for (const line of problems.slice(0, 50)) console.error(line);
      throw new Error(`${problems.length} rollup mismatches`);
    }
    console.log("Rollup matches live award aggregates.");
  } else if (values["if-empty"] && !(await rollupIsEmpty())) {
    console.log("Rollup already populated; skipped.");
  } else {
    const started = Date.now();
    const written = await refreshRollup();
    console.log(
      `Rollup rebuilt: ${written.toLocaleString("en-US")} rows in ${((Date.now() - started) / 1000).toFixed(1)}s.`,
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
