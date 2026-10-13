-- Trigram indexes for case-insensitive substring search.
-- Text filters compile to UPPER(col) LIKE UPPER($1) (see src/lib/sql/text.ts), so each index is on
-- that exact expression; ILIKE would not use them.
-- pg_trgm lives in the shared `public` schema. On the shared database it is already installed (the
-- app may not create anything in `public`) and IF NOT EXISTS returns before checking privileges;
-- a local database gets it here.
CREATE EXTENSION IF NOT EXISTS pg_trgm SCHEMA public;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS recipient_name_trgm ON "grantledger"."recipient" USING gin ((UPPER("name"::text)) public.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS recipient_display_trgm ON "grantledger"."recipient" USING gin ((UPPER("display_name"::text)) public.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS program_name_trgm ON "grantledger"."program" USING gin ((UPPER("name"::text)) public.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS ministry_name_trgm ON "grantledger"."ministry" USING gin ((UPPER("name"::text)) public.gin_trgm_ops);
