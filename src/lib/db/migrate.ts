import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createLogger } from "@/lib/server/logger";
import { getDb, getPool } from "./index";
import { DB_SCHEMA } from "./schema-name";

const log = createLogger("migrate");

/** Folder with drizzle-kit's SQL migrations; /app/drizzle in the Docker image. */
export function migrationsFolder() {
  return process.env.MIGRATIONS_DIR ?? path.resolve(process.cwd(), "drizzle");
}

/**
 * Applies the pending migrations. The web server and the worker both do this on start, in the
 * same container: an advisory lock (named for the app, since the database is shared) lets one
 * apply them while the other waits, then finds nothing left to do.
 */
export async function runMigrations() {
  const folder = migrationsFolder();
  const started = Date.now();
  const lock = await getPool().connect();
  let failed = false;
  try {
    await lock.query("SELECT pg_advisory_lock(hashtext($1))", [`${DB_SCHEMA}:migrations`]);
    log.info("applying migrations", { folder });
    // The journal lives in the app's schema too, not in a shared `drizzle` schema
    await migrate(getDb(), { migrationsFolder: folder, migrationsSchema: DB_SCHEMA });
    log.info("migrations up to date", { ms: Date.now() - started });
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    // After a failure the connection may be broken: close it rather than hand it back to the
    // pool (closing the session also releases the lock)
    if (!failed) {
      await lock
        .query("SELECT pg_advisory_unlock(hashtext($1))", [`${DB_SCHEMA}:migrations`])
        .catch(() => {
          failed = true;
        });
    }
    lock.release(failed);
  }
}
