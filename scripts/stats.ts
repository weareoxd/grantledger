// Print the dataset statistics the experiment notes quote: npm run stats
import { closeDb } from "@/lib/db";
import { loadDotEnv } from "@/lib/env";
import { datasetStats } from "@/lib/grants/stats";

loadDotEnv();

try {
  console.log(await datasetStats());
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
