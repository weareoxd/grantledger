// Create the admin account for ADMIN_EMAIL (if it does not exist yet); they sign in with Google.
//
//   npm run seed:admin
//   node dist/scripts/seed-admin.mjs
import { ensureAdminUser } from "@/lib/auth/users";
import { closeDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { loadDotEnv } from "@/lib/env";

loadDotEnv();

try {
  await runMigrations();
  const { created } = await ensureAdminUser();
  console.log(
    created ? "Admin user created." : "Admin user already exists (or is not configured).",
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
