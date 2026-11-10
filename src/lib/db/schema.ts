/**
 * Unified data model over two grant disclosures.
 *
 * organization -> ministry -> program -> award, plus recipients. The federal source discloses
 * *agreements* (with amendments); Alberta discloses *payments*. Both land in `award` with
 * `record_kind` saying which, because the questions people ask ("who got money from whom, when,
 * for what") are the same shape.
 *
 * Everything lives in the app's own Postgres schema (`dbSchema`, src/lib/db/schema-name.ts).
 *
 * Money columns are `numeric` and come back from the driver as strings: sums run to hundreds of
 * billions with cents, past what a double holds exactly.
 */
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import {
  IMPORT_SOURCES,
  RECORD_KINDS,
  RUN_STATUSES,
  RUN_TRIGGERS,
  WORKER_STATES,
} from "@/lib/domain";
import { dbSchema } from "./schema-name";

export const importSource = dbSchema.enum("import_source", IMPORT_SOURCES);
export const runTrigger = dbSchema.enum("run_trigger", RUN_TRIGGERS);
export const runStatus = dbSchema.enum("run_status", RUN_STATUSES);
export const workerState = dbSchema.enum("worker_state", WORKER_STATES);

const instant = (name: string) => timestamp(name, { withTimezone: true });

const timestamps = {
  createdAt: instant("created_at").notNull().defaultNow(),
  updatedAt: instant("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

export const organization = dbSchema.table("organization", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: varchar("name", { length: 255 }).notNull().unique(),
  /** Importer key ("federal", "alberta"); see src/lib/grants/constants.ts. */
  key: varchar("key", { length: 32 }).notNull().unique(),
});

export const ministry = dbSchema.table(
  "ministry",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    organizationId: integer("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 255 }).notNull(),
  },
  (t) => [uniqueIndex("ministry_org_name_uniq").on(t.organizationId, t.name)],
);

export const program = dbSchema.table(
  "program",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    ministryId: integer("ministry_id")
      .notNull()
      .references(() => ministry.id, { onDelete: "cascade" }),
    name: varchar("name", { length: 500 }).notNull(),
  },
  (t) => [uniqueIndex("program_ministry_name_uniq").on(t.ministryId, t.name)],
);

/**
 * A funding recipient. `name` is the canonical, normalised (upper-cased) form used for matching
 * across sources; `display_name` is the first raw spelling seen.
 */
export const recipient = dbSchema.table("recipient", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: varchar("name", { length: 500 }).notNull().unique(),
  displayName: varchar("display_name", { length: 500 }).notNull(),
  /**
   * True for the aggregate stand-ins ("INDIVIDUAL RECIPIENT (NAME WITHHELD)", "RECIPIENT NOT
   * DISCLOSED"). Excluded from "top recipient" rankings.
   */
  isPlaceholder: boolean("is_placeholder").notNull().default(false),
});

/** A normalised raw name variant resolved to its canonical recipient. */
export const recipientAlias = dbSchema.table("recipient_alias", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  name: varchar("name", { length: 500 }).notNull().unique(),
  recipientId: integer("recipient_id")
    .notNull()
    .references(() => recipient.id, { onDelete: "cascade" }),
});

export const award = dbSchema.table(
  "award",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    ministryId: integer("ministry_id")
      .notNull()
      .references(() => ministry.id, { onDelete: "cascade" }),
    programId: integer("program_id").references(() => program.id, { onDelete: "set null" }),
    recipientId: integer("recipient_id")
      .notNull()
      .references(() => recipient.id, { onDelete: "cascade" }),

    recordKind: varchar("record_kind", { length: 16, enum: RECORD_KINDS }).notNull(),
    reference: varchar("reference", { length: 255 }).notNull(),
    /**
     * The department's own agreement id (federal only; not unique on its own: some departments
     * reuse program codes such as "RGPIN" across many recipients).
     */
    agreementNumber: varchar("agreement_number", { length: 128 }),
    /**
     * Groups every disclosed version of one agreement (see importers/federal.ts). Some
     * departments file each amendment under a new reference number, so the reference alone does
     * not identify an agreement.
     */
    agreementKey: varchar("agreement_key", { length: 64 }),
    amendmentNumber: integer("amendment_number").notNull().default(0),
    amendmentDate: date("amendment_date"),
    /**
     * For agreements: true on the latest amendment of each agreement. Always true for payments.
     * Totals should only ever sum current rows.
     */
    isCurrent: boolean("is_current").notNull().default(true),

    agreementType: varchar("agreement_type", { length: 1 }),
    recipientType: varchar("recipient_type", { length: 1 }),
    recipientProvince: varchar("recipient_province", { length: 64 }),
    recipientCity: varchar("recipient_city", { length: 255 }),

    value: numeric("value", { precision: 18, scale: 2 }),
    startDate: date("start_date").notNull(),
    /**
     * True when the source gave no date and start_date is the first day of the disclosed fiscal
     * year (Alberta's undisclosed aggregate rows).
     */
    startDateEstimated: boolean("start_date_estimated").notNull().default(false),
    endDate: date("end_date"),

    title: varchar("title", { length: 1000 }),
    description: text("description"),
    naics: varchar("naics", { length: 16 }),

    // Alberta-only attributes
    businessUnit: varchar("business_unit", { length: 255 }),
    lotteryFund: boolean("lottery_fund"),

    sourceFile: varchar("source_file", { length: 255 }),
    importDate: date("import_date"),
  },
  (t) => [
    index("award_start_idx").on(t.startDate),
    index("award_value_idx").on(t.value),
    index("award_min_ref_idx").on(t.ministryId, t.reference),
    index("award_recip_start_idx").on(t.recipientId, t.startDate),
    index("award_current_idx").on(t.isCurrent),
    index("award_source_idx").on(t.sourceFile),
    index("award_prog_start_idx").on(t.programId, t.startDate),
    index("award_min_agreement_idx").on(t.ministryId, t.agreementKey),
  ],
);

export const fiscalYear = dbSchema.table("fiscal_year", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  /** Fiscal year start, e.g. 2024 = Apr 2024 - Mar 2025. */
  year: integer("year").notNull().unique(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
});

/**
 * Pre-aggregated current awards, by (organization, ministry, program, recipient, fiscal year).
 *
 * Rebuilt from `award` after every import (src/lib/grants/rollup.ts) so the web UI's aggregated
 * lists read a narrow table instead of grouping millions of award rows per request.
 * `fiscal_year` 0 holds the all-years totals. Only `is_current` awards are counted.
 *
 * The ids carry no foreign keys: pruneOrphans deletes recipients, programs and ministries with
 * raw SQL before the rollup is rebuilt.
 */
export const awardRollup = dbSchema.table(
  "award_rollup",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    organizationId: integer("organization_id").notNull(),
    ministryId: integer("ministry_id").notNull(),
    programId: integer("program_id"),
    recipientId: integer("recipient_id").notNull(),
    fiscalYear: integer("fiscal_year").notNull(),
    nAwards: integer("n_awards").notNull(),
    totalValue: numeric("total_value", { precision: 20, scale: 2 }),
  },
  (t) => [
    index("rollup_org_fy_idx").on(t.organizationId, t.fiscalYear),
    index("rollup_min_fy_idx").on(t.ministryId, t.fiscalYear),
    index("rollup_prog_fy_idx").on(t.programId, t.fiscalYear),
    index("rollup_recip_fy_idx").on(t.recipientId, t.fiscalYear),
  ],
);

export const ALL_YEARS = 0;

// ---------------------------------------------------------------------------
// MCP OAuth 2.1 authorization server
// ---------------------------------------------------------------------------

/**
 * A person who signed in to the MCP connector through Google. Kept apart from the web UI's
 * users: these identities only bind OAuth tokens to someone and are never exposed to tools.
 */
export const mcpUser = dbSchema.table("mcp_user", {
  id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  firstName: varchar("first_name", { length: 30 }).notNull().default(""),
  lastName: varchar("last_name", { length: 30 }).notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  ...timestamps,
});

/** A client registered via Dynamic Client Registration (e.g. claude.ai, ChatGPT). */
export const oauthClient = dbSchema.table("oauth_client", {
  clientId: varchar("client_id", { length: 255 }).primaryKey(),
  /** The full OAuthClientInformationFull payload. */
  data: jsonb("data").notNull(),
  createdAt: instant("created_at").notNull().defaultNow(),
});

/**
 * One authorization request, spanning the Google federation round-trip: created at /authorize
 * (holding the client's PKCE challenge and our Google code verifier), completed by the Google
 * callback, which binds the user and issues the one-time authorization `code`.
 */
export const oauthAuthorizationRequest = dbSchema.table(
  "oauth_authorization_request",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: varchar("client_id", { length: 255 }).notNull(),
    redirectUri: text("redirect_uri").notNull(),
    redirectUriProvidedExplicitly: boolean("redirect_uri_provided_explicitly")
      .notNull()
      .default(true),
    codeChallenge: text("code_challenge"),
    scopes: jsonb("scopes").$type<string[]>().notNull().default([]),
    resource: text("resource"),
    mcpState: text("mcp_state"),
    googleState: varchar("google_state", { length: 255 }).notNull(),
    googleCodeVerifier: text("google_code_verifier").notNull(),
    userId: integer("user_id"),
    code: varchar("code", { length: 255 }),
    used: boolean("used").notNull().default(false),
    createdAt: instant("created_at").notNull().defaultNow(),
    expiresAt: instant("expires_at").notNull(),
  },
  (t) => [
    index("oauth_request_google_state_idx").on(t.googleState),
    index("oauth_request_code_idx").on(t.code),
  ],
);

/** Denylist of revoked or rotated token ids (jti) until their natural expiry. */
export const oauthRevokedToken = dbSchema.table("oauth_revoked_token", {
  jti: varchar("jti", { length: 255 }).primaryKey(),
  expiresAt: instant("expires_at").notNull(),
});

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

/** One file downloaded and imported by the worker (or skipped because it had not changed). */
export const importRun = dbSchema.table(
  "import_run",
  {
    id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
    source: importSource("source").notNull(),
    trigger: runTrigger("trigger").notNull().default("schedule"),
    status: runStatus("status").notNull().default("queued"),
    /** Shared by the runs of one job (the archive job imports a file per fiscal year). */
    batchId: uuid("batch_id"),
    jobId: text("job_id"),
    sourceFile: varchar("source_file", { length: 255 }),
    url: text("url"),
    startedAt: instant("started_at"),
    finishedAt: instant("finished_at"),
    bytesDownloaded: bigint("bytes_downloaded", { mode: "number" }),
    bytesTotal: bigint("bytes_total", { mode: "number" }),
    etag: text("etag"),
    lastModified: text("last_modified"),
    rowsRead: integer("rows_read"),
    rowsImported: integer("rows_imported"),
    rowsSkipped: integer("rows_skipped"),
    rowsWithheld: integer("rows_withheld"),
    rowsNotDisclosed: integer("rows_not_disclosed"),
    rowsEstimatedDates: integer("rows_estimated_dates"),
    rowsMalformed: integer("rows_malformed"),
    rowsReplaced: integer("rows_replaced"),
    /** What pruneOrphans deleted after the job: { recipients, programs, ministries }. */
    pruned: jsonb("pruned").$type<Record<string, number>>(),
    rollupRows: integer("rollup_rows"),
    /** The failure, or a note on a run that finished (e.g. a rollup check mismatch). */
    error: text("error"),
    ...timestamps,
  },
  (t) => [
    index("import_run_created_idx").on(t.createdAt),
    index("import_run_status_idx").on(t.status),
  ],
);

/** The worker's live state: one row, rewritten on every step and every heartbeat. */
export const workerStatus = dbSchema.table("worker_status", {
  id: varchar("id", { length: 16 }).primaryKey().default("worker"),
  /** hostname:pid of the process that last wrote the row. */
  instance: text("instance").notNull(),
  startedAt: instant("started_at").notNull(),
  heartbeatAt: instant("heartbeat_at").notNull(),
  state: workerState("state").notNull().default("idle"),
  source: importSource("source"),
  runId: integer("run_id").references(() => importRun.id, { onDelete: "set null" }),
  /** What it is doing, e.g. "Reading tbf-grants-disclosure-2026-27.csv". */
  message: text("message"),
  progressCurrent: bigint("progress_current", { mode: "number" }),
  progressTotal: bigint("progress_total", { mode: "number" }),
  bytesDone: bigint("bytes_done", { mode: "number" }),
  bytesTotal: bigint("bytes_total", { mode: "number" }),
  updatedAt: instant("updated_at").notNull().defaultNow(),
});

/** Key/value settings: data_version, paused, and each source's last ETag and size. */
export const appSetting = dbSchema.table("app_setting", {
  key: varchar("key", { length: 64 }).primaryKey(),
  value: jsonb("value").notNull(),
  ...timestamps,
});

export type OrganizationRow = typeof organization.$inferSelect;
export type MinistryRow = typeof ministry.$inferSelect;
export type ProgramRow = typeof program.$inferSelect;
export type RecipientRow = typeof recipient.$inferSelect;
export type AwardRecord = typeof award.$inferSelect;
export type FiscalYearRow = typeof fiscalYear.$inferSelect;
export type ImportRunRow = typeof importRun.$inferSelect;
export type WorkerStatusRow = typeof workerStatus.$inferSelect;
