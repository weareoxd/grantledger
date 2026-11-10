// Value sets shared by the database schema, the server and the browser. No database imports
// here, so client components can use them.

export const RECORD_KINDS = ["agreement", "payment"] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export const AGREEMENT_TYPE_CODES = ["G", "C", "O"] as const;
export type AgreementTypeCode = (typeof AGREEMENT_TYPE_CODES)[number];

export const RECIPIENT_TYPE_CODES = ["F", "N", "S", "A", "G", "I", "P", "O"] as const;
export type RecipientTypeCode = (typeof RECIPIENT_TYPE_CODES)[number];

/** What the worker imports: each source is one pg-boss queue and one row in the schedule. */
export const IMPORT_SOURCES = ["alberta_live", "alberta_archive", "federal"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export const IMPORT_SOURCE_LABELS: Record<ImportSource, string> = {
  alberta_live: "Alberta (current year)",
  alberta_archive: "Alberta (yearly archives)",
  federal: "Government of Canada",
};

export const RUN_TRIGGERS = ["schedule", "manual"] as const;
export type RunTrigger = (typeof RUN_TRIGGERS)[number];

/** An import run's lifecycle: queued, then one phase after another, then a terminal status. */
export const RUN_STATUSES = [
  "queued",
  "downloading",
  "importing",
  "pruning",
  "rollup",
  "succeeded",
  "failed",
  "skipped",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const ACTIVE_RUN_STATUSES = [
  "queued",
  "downloading",
  "importing",
  "pruning",
  "rollup",
] as const satisfies readonly RunStatus[];

export const TERMINAL_RUN_STATUSES = [
  "succeeded",
  "failed",
  "skipped",
] as const satisfies readonly RunStatus[];

export const WORKER_STATES = [
  "idle",
  "downloading",
  "importing",
  "pruning",
  "rollup",
  "stopped",
] as const;
export type WorkerState = (typeof WORKER_STATES)[number];

export const USER_ROLES = ["user", "admin"] as const;
export type UserRole = (typeof USER_ROLES)[number];
