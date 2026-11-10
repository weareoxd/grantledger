import { z } from "zod";
import { DB_SCHEMA } from "@/lib/db/schema-name";

// Blank values in .env files (e.g. `TRUSTED_PROXIES=`) are treated as unset.
const blankAsUnset = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** A true/false setting: true, 1 or yes; false, 0 or no; blank or unset is `fallback`. */
const booleanSetting = (fallback: boolean) =>
  z.preprocess(
    blankAsUnset,
    z
      .enum(["true", "false", "1", "0", "yes", "no"])
      .transform((value) => value === "true" || value === "1" || value === "yes")
      .optional()
      .default(fallback),
  );

const intString = (fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.preprocess(
    blankAsUnset,
    z.coerce.number().int().min(min).max(max).optional().default(fallback),
  );

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value?.trim() ? value.trim() : undefined));

const stringDefault = (fallback: string) =>
  z.preprocess(blankAsUnset, z.string().optional().default(fallback));

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /^postgres(ql)?:$/.test(url.protocol) && url.hostname !== "" && url.hash === "";
  } catch {
    return false;
  }
}

const ALBERTA_ARCHIVE_BASE =
  "https://open.alberta.ca/dataset/faef5592-9ea0-4b60-92db-79a8a9673fe5/resource";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).optional().default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required").refine(isPostgresUrl, {
    message:
      "DATABASE_URL must be a postgres:// URL; URL-encode special characters in the password",
  }),
  /**
   * The schema the database host made for the app, if it says. The app's tables are always in
   * "grantledger" (src/lib/db/schema-name.ts); a different one is refused rather than ignored.
   */
  DATABASE_SCHEMA: optionalString.refine((value) => !value || value === DB_SCHEMA, {
    message: `DATABASE_SCHEMA must be "${DB_SCHEMA}": the migrations create the tables there`,
  }),
  /**
   * The database server's CA bundle, base64-encoded PEM. Set, the
   * connection uses TLS and checks the server's certificate against it.
   */
  DATABASE_PGSSLCA_BASE64: optionalString,

  // Web UI sign-in (Better Auth)
  BETTER_AUTH_SECRET: optionalString,
  BETTER_AUTH_URL: optionalString,
  /**
   * The admin's Google email. Their account is created (as an admin) on startup when it doesn't
   * exist yet. Anyone else who signs in with Google is a user until an admin promotes them.
   */
  ADMIN_EMAIL: optionalString,
  /** Comma-separated reverse-proxy IPs/CIDRs whose X-Forwarded-For is trusted. */
  TRUSTED_PROXIES: optionalString,

  // MCP server
  /** Static bearer token for programmatic MCP clients (Claude Code, Claude Desktop). */
  MCP_API_KEY: optionalString,
  /** Cap on rows returned by one tool call; blank, "none", "null" or 0 for unlimited. */
  MCP_MAX_ROWS: z.string().optional().default("500"),
  /** This server's public https origin. Set to turn on the OAuth authorization server. */
  MCP_PUBLIC_URL: optionalString,
  /** Optional space-separated allowlist of Google email domains. */
  MCP_ALLOWED_EMAIL_DOMAINS: optionalString,
  /** Signs the OAuth access and refresh tokens (HS256). */
  MCP_JWT_SECRET: optionalString,
  /** Longest one tool call's query may run, in ms (the database is shared); 0 for no limit. */
  MCP_STATEMENT_TIMEOUT_MS: intString(60_000, 0),
  MCP_ACCESS_TOKEN_TTL: intString(3600, 60),
  MCP_REFRESH_TOKEN_TTL_DAYS: intString(30, 1),
  GOOGLE_OAUTH2_CLIENT_ID: optionalString,
  GOOGLE_OAUTH2_CLIENT_SECRET: optionalString,

  // JSON API limits
  API_EXPORT_MAX_ROWS: intString(1_048_575, 1),
  API_STATEMENT_TIMEOUT_MS: intString(15_000, 0),
  API_WORK_MEM: stringDefault("32MB"),
  API_SUMMARY_TIMEOUT_MS: intString(60_000, 0),

  // Worker
  /** Where the worker keeps downloaded files. */
  DATA_DIR: stringDefault("./data"),
  /**
   * The web server's result cache (pages, totals, summaries), in MB of memory. It shares the
   * container's memory (512 MiB is enough for both) with the worker, so keep it well below that.
   */
  CACHE_MAX_MB: intString(64, 1),
  ALBERTA_LIVE_URL: stringDefault(
    "https://grants.dataservices.alberta.ca/GrantsDataService.svc/file.exportcsv",
  ),
  ALBERTA_ARCHIVE_BASE: stringDefault(ALBERTA_ARCHIVE_BASE),
  FEDERAL_GRANTS_URL: stringDefault(
    "https://open.canada.ca/data/dataset/432527ab-7aac-45b5-81d6-7597107a7013/resource/1d15a62f-5656-49ad-8c88-f40ce689d831/download/grants.csv",
  ),
  /** Keep individuals' names (they are withheld by default). */
  IMPORT_INCLUDE_INDIVIDUALS: booleanSetting(false),
  ALBERTA_LIVE_CRON: stringDefault("0 6 * * *"),
  /**
   * Download and import the federal file (about 2.3 GB) at all: on its schedule and when an admin
   * asks. Off by default. Federal rows already imported stay, and `npm run import -- federal
   * <file>` still imports a file on disk.
   */
  FEDERAL_IMPORTS_ENABLED: booleanSetting(false),
  FEDERAL_CRON: stringDefault("0 3 * * 1"),

  TZ: stringDefault("America/Edmonton"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional().default("info"),
  RUN_MIGRATIONS: booleanSetting(true),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validated environment. Call inside handlers/functions, never at module scope, so importing a
 * module never requires a fully configured environment.
 */
export function getEnv(): Env {
  if (!cached) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");
      throw new Error(`Invalid environment: ${issues}`);
    }
    cached = result.data;
  }
  return cached;
}

/** Forget the parsed environment (tests change process.env between cases). */
export function resetEnvCache() {
  cached = undefined;
}

/** The auth settings are only required by the web server, not by every script. */
export function getAuthEnv() {
  const env = getEnv();
  const missing = (["BETTER_AUTH_SECRET", "BETTER_AUTH_URL"] as const).filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  const secret = env.BETTER_AUTH_SECRET as string;
  if (secret.length < 32) throw new Error("BETTER_AUTH_SECRET must be at least 32 characters");
  const google =
    env.GOOGLE_OAUTH2_CLIENT_ID && env.GOOGLE_OAUTH2_CLIENT_SECRET
      ? { clientId: env.GOOGLE_OAUTH2_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH2_CLIENT_SECRET }
      : null;
  return { secret, baseURL: z.url().parse(env.BETTER_AUTH_URL), google };
}

/** The admin to create on startup (ADMIN_EMAIL), if set. */
export function getAdminSeed() {
  const { ADMIN_EMAIL } = getEnv();
  if (!ADMIN_EMAIL) return null;
  const email = z.email("ADMIN_EMAIL must be an email address").parse(ADMIN_EMAIL.toLowerCase());
  return { email };
}

/** Load a local .env for CLI scripts and the worker (Next.js and Docker provide env themselves). */
export function loadDotEnv(path = ".env") {
  try {
    process.loadEnvFile(path);
  } catch {
    // No .env file: rely on the process environment.
  }
}

/** TLS settings for the database connections: verified against DATABASE_PGSSLCA_BASE64 when set. */
export function databaseSsl(): { ca: string; rejectUnauthorized: true } | undefined {
  const bundle = getEnv().DATABASE_PGSSLCA_BASE64;
  if (!bundle) return undefined;
  return { ca: Buffer.from(bundle, "base64").toString("utf8"), rejectUnauthorized: true };
}

/** TRUSTED_PROXIES as a list of IPs/CIDRs, or undefined when none are set. */
export function trustedProxies(): string[] | undefined {
  const list = getEnv()
    .TRUSTED_PROXIES?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return list?.length ? list : undefined;
}
