import { defineConfig } from "drizzle-kit";
import { DB_SCHEMA } from "./src/lib/db/schema-name";

try {
  process.loadEnvFile(".env");
} catch {
  // Rely on the process environment.
}

export default defineConfig({
  dialect: "postgresql",
  schema: ["./src/lib/db/schema.ts", "./src/lib/db/auth-schema.ts"],
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "",
  },
  // Only the app's own schema (see src/lib/db/schema-name.ts); its journal lives there too.
  schemaFilter: [DB_SCHEMA],
  migrations: { schema: DB_SCHEMA },
  strict: true,
  verbose: true,
});
