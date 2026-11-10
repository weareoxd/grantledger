// Apply pending migrations: `npm run db:migrate` (dev) or `node dist/scripts/migrate.mjs` (image).
import { closeDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { loadDotEnv } from "@/lib/env";

loadDotEnv();

try {
  await runMigrations();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
