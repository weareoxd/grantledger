import { pgSchema } from "drizzle-orm/pg-core";

/**
 * The Postgres schema that holds everything the app stores: its tables and enums, Better Auth's,
 * the Drizzle migrations journal and pg-boss's job tables. On the shared database each app owns
 * one schema (named after it) and can't create anything in `public`, which only lends the shared
 * extensions (pg_trgm). Connections search this schema, then `public` (src/lib/db/index.ts).
 *
 * It is fixed rather than configurable because the SQL migrations name it.
 */
export const DB_SCHEMA = "grantledger";

/**
 * Tables and enums are declared on this (`dbSchema.table`, `dbSchema.enum`) so their SQL names
 * the schema. Kept out of schema.ts on purpose: drizzle-kit would generate a CREATE SCHEMA for an
 * exported schema object, which fails where the schema already exists (it always does: the
 * platform creates it, and locally the migrator does, for its journal).
 */
export const dbSchema = pgSchema(DB_SCHEMA);
