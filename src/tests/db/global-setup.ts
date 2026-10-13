// Migrates the test database once before the database tests run.
import pg from "pg";

export default async function setup() {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) {
    throw new Error("Set DATABASE_URL_TEST to a database the tests may empty (see .env.example).");
  }
  if (!/test/i.test(new URL(url).pathname)) {
    throw new Error("DATABASE_URL_TEST must name a test database (its name must contain 'test').");
  }
  // Create the database when it is missing
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    const exists = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (exists.rowCount === 0) await client.query(`create database "${name.replace(/"/g, '""')}"`);
  } finally {
    await client.end();
  }
  process.env.DATABASE_URL = url;
  const { runMigrations } = await import("@/lib/db/migrate");
  const { closeDb } = await import("@/lib/db");
  await runMigrations();
  await closeDb();
}
