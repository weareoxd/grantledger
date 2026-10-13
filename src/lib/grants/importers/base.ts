/**
 * The import driver shared by the two importers: streaming rows from a source file, batched
 * lookups for ministries / programs / recipients, batched inserts, and the post-import
 * bookkeeping (amendment flags, fiscal years, the data version).
 *
 * One file is one transaction on a dedicated connection: rows previously imported from a file
 * with the same name are deleted first, so re-importing a file replaces it.
 */
import { basename } from "node:path";
import type pg from "pg";
import { inTransaction } from "@/lib/db";
import type { RecordKind } from "@/lib/domain";
import { ORGANIZATIONS, type OrganizationKey } from "@/lib/grants/constants";
import { todayLocal } from "@/lib/grants/fiscal";
import { NOT_DISCLOSED, PLACEHOLDER_NAMES, WITHHELD_INDIVIDUAL } from "@/lib/grants/normalize";
import { bumpDataVersion } from "@/lib/grants/version";
import { createLogger } from "@/lib/server/logger";
import { type CsvRow, decodedLines, MALFORMED, readRows } from "./csv";
import { ensureFiscalYears, refreshCurrentFlags } from "./maintenance";

const log = createLogger("grants_import");

/** The award columns a parser may set (defaults as the table's). */
export interface AwardFields {
  record_kind: RecordKind;
  reference: string;
  agreement_number?: string | null;
  agreement_key?: string | null;
  amendment_number?: number;
  amendment_date?: string | null;
  is_current?: boolean;
  agreement_type?: string | null;
  recipient_type?: string | null;
  recipient_province?: string | null;
  recipient_city?: string | null;
  value?: string | null;
  start_date: string;
  start_date_estimated?: boolean;
  end_date?: string | null;
  title?: string | null;
  description?: string | null;
  naics?: string | null;
  business_unit?: string | null;
  lottery_fund?: boolean | null;
}

/** One source row, resolved to names; ids are filled in per batch. */
export interface ParsedAward {
  ministry: string;
  program: string | null;
  recipientKey: string;
  recipientDisplay: string;
  fields: AwardFields;
}

export interface ImportStats {
  read: number;
  imported: number;
  skipped: number;
  withheld_individuals: number;
  not_disclosed: number;
  estimated_dates: number;
  malformed: number;
  replaced: number;
}

export type RowParser = (row: CsvRow, lineNo: number) => ParsedAward | null;

export interface ImportProgress {
  rowsRead: number;
  rowsImported: number;
  bytesRead: number;
  bytesTotal: number | null;
}

export interface ImportOptions {
  limit?: number | null;
  batchSize?: number;
  onProgress?: (progress: ImportProgress) => void;
  signal?: AbortSignal;
  /** The file's name in the database (`source_file`); defaults to the path's basename. */
  sourceFile?: string;
}

function emptyStats(): ImportStats {
  return {
    read: 0,
    imported: 0,
    skipped: 0,
    withheld_individuals: 0,
    not_disclosed: 0,
    estimated_dates: 0,
    malformed: 0,
    replaced: 0,
  };
}

export function formatStats(stats: ImportStats) {
  return Object.entries(stats)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

/** Name -> id caches that create missing ministries / programs / recipients per batch. */
export class Lookups {
  ministries = new Map<string, number>();
  programs = new Map<string, number>(); // `${ministryId}\u0000${name}`
  recipients = new Map<string, number>();

  constructor(
    private client: pg.ClientBase,
    private organizationId: number,
  ) {}

  static programKey(ministryId: number, name: string) {
    return `${ministryId}\u0000${name}`;
  }

  async load() {
    const ministries = await this.client.query<{ id: number; name: string }>(
      "SELECT id, name FROM ministry WHERE organization_id = $1",
      [this.organizationId],
    );
    for (const row of ministries.rows) this.ministries.set(row.name, row.id);
    const programs = await this.client.query<{ id: number; ministry_id: number; name: string }>(
      `SELECT p.id, p.ministry_id, p.name FROM program p
         JOIN ministry m ON m.id = p.ministry_id WHERE m.organization_id = $1`,
      [this.organizationId],
    );
    for (const row of programs.rows) {
      this.programs.set(Lookups.programKey(row.ministry_id, row.name), row.id);
    }
    const recipients = await this.client.query<{ id: number; name: string }>(
      "SELECT id, name FROM recipient",
    );
    for (const row of recipients.rows) this.recipients.set(row.name, row.id);
  }

  async resolve(batch: ParsedAward[]) {
    await this.ensureMinistries(new Set(batch.map((p) => p.ministry)));
    const programs = new Map<string, [number, string]>();
    for (const p of batch) {
      if (!p.program) continue;
      const ministryId = this.ministries.get(p.ministry) as number;
      programs.set(Lookups.programKey(ministryId, p.program), [ministryId, p.program]);
    }
    await this.ensurePrograms(programs);
    const recipients = new Map<string, string>();
    for (const p of batch) {
      if (!recipients.has(p.recipientKey)) recipients.set(p.recipientKey, p.recipientDisplay);
    }
    await this.ensureRecipients(recipients);
  }

  private async ensureMinistries(names: Set<string>) {
    const missing = [...names].filter((name) => !this.ministries.has(name));
    if (!missing.length) return;
    await this.client.query(
      `INSERT INTO ministry (organization_id, name)
       SELECT $1, name FROM unnest($2::text[]) AS t(name)
       ON CONFLICT DO NOTHING`,
      [this.organizationId, missing],
    );
    const rows = await this.client.query<{ id: number; name: string }>(
      "SELECT id, name FROM ministry WHERE organization_id = $1 AND name = ANY($2::text[])",
      [this.organizationId, missing],
    );
    for (const row of rows.rows) this.ministries.set(row.name, row.id);
  }

  private async ensurePrograms(keys: Map<string, [number, string]>) {
    const missing = [...keys.entries()].filter(([key]) => !this.programs.has(key));
    if (!missing.length) return;
    const ministryIds = missing.map(([, [m]]) => m);
    const names = missing.map(([, [, n]]) => n);
    await this.client.query(
      `INSERT INTO program (ministry_id, name)
       SELECT * FROM unnest($1::int[], $2::text[]) ON CONFLICT DO NOTHING`,
      [ministryIds, names],
    );
    const rows = await this.client.query<{ id: number; ministry_id: number; name: string }>(
      `SELECT p.id, p.ministry_id, p.name FROM program p
         JOIN unnest($1::int[], $2::text[]) AS t(ministry_id, name)
           ON p.ministry_id = t.ministry_id AND p.name = t.name`,
      [ministryIds, names],
    );
    for (const row of rows.rows) {
      this.programs.set(Lookups.programKey(row.ministry_id, row.name), row.id);
    }
  }

  private async ensureRecipients(displayByKey: Map<string, string>) {
    const missing = [...displayByKey.keys()].filter((key) => !this.recipients.has(key));
    if (!missing.length) return;
    await this.client.query(
      `INSERT INTO recipient (name, display_name, is_placeholder)
       SELECT * FROM unnest($1::text[], $2::text[], $3::bool[]) ON CONFLICT DO NOTHING`,
      [
        missing,
        missing.map((key) => displayByKey.get(key) || key),
        missing.map((key) => PLACEHOLDER_NAMES.includes(key)),
      ],
    );
    for (let start = 0; start < missing.length; start += 1000) {
      const chunk = missing.slice(start, start + 1000);
      const rows = await this.client.query<{ id: number; name: string }>(
        "SELECT id, name FROM recipient WHERE name = ANY($1::text[])",
        [chunk],
      );
      for (const row of rows.rows) this.recipients.set(row.name, row.id);
    }
  }
}

// The award columns written per row, with their Postgres array types
const COLUMNS: [string, string][] = [
  ["ministry_id", "int"],
  ["program_id", "int"],
  ["recipient_id", "int"],
  ["record_kind", "text"],
  ["reference", "text"],
  ["agreement_number", "text"],
  ["agreement_key", "text"],
  ["amendment_number", "int"],
  ["amendment_date", "date"],
  ["is_current", "bool"],
  ["agreement_type", "text"],
  ["recipient_type", "text"],
  ["recipient_province", "text"],
  ["recipient_city", "text"],
  ["value", "numeric"],
  ["start_date", "date"],
  ["start_date_estimated", "bool"],
  ["end_date", "date"],
  ["title", "text"],
  ["description", "text"],
  ["naics", "text"],
  ["business_unit", "text"],
  ["lottery_fund", "bool"],
  ["source_file", "text"],
  ["import_date", "date"],
];

// One array parameter per column: a multi-row VALUES list would pass Postgres's 65,535
// parameter limit at 5,000 rows.
const INSERT_AWARDS = `INSERT INTO award (${COLUMNS.map(([c]) => c).join(", ")})
SELECT * FROM unnest(${COLUMNS.map(([, type], i) => `$${i + 1}::${type}[]`).join(", ")})`;

async function insertAwards(
  client: pg.ClientBase,
  lookups: Lookups,
  batch: ParsedAward[],
  sourceFile: string,
  importDate: string,
) {
  const columns: unknown[][] = COLUMNS.map(() => new Array(batch.length));
  batch.forEach((parsed, i) => {
    const ministryId = lookups.ministries.get(parsed.ministry) as number;
    const f = parsed.fields;
    const values: unknown[] = [
      ministryId,
      parsed.program
        ? (lookups.programs.get(Lookups.programKey(ministryId, parsed.program)) ?? null)
        : null,
      lookups.recipients.get(parsed.recipientKey) as number,
      f.record_kind,
      f.reference,
      f.agreement_number ?? null,
      f.agreement_key ?? null,
      f.amendment_number ?? 0,
      f.amendment_date ?? null,
      f.is_current ?? true,
      f.agreement_type ?? null,
      f.recipient_type ?? null,
      f.recipient_province ?? null,
      f.recipient_city ?? null,
      f.value ?? null,
      f.start_date,
      f.start_date_estimated ?? false,
      f.end_date ?? null,
      f.title ?? null,
      f.description ?? null,
      f.naics ?? null,
      f.business_unit ?? null,
      f.lottery_fund ?? null,
      sourceFile,
      importDate,
    ];
    values.forEach((value, c) => {
      (columns[c] as unknown[])[i] = value;
    });
  });
  await client.query(INSERT_AWARDS, columns);
}

export async function getOrganizationId(client: pg.ClientBase, key: OrganizationKey) {
  const meta = ORGANIZATIONS[key];
  await client.query(
    "INSERT INTO organization (key, name) VALUES ($1, $2) ON CONFLICT (key) DO NOTHING",
    [key, meta.name],
  );
  const rows = await client.query<{ id: number }>("SELECT id FROM organization WHERE key = $1", [
    key,
  ]);
  return (rows.rows[0] as { id: number }).id;
}

export class ImportCancelled extends Error {
  constructor() {
    super("The import was cancelled");
    this.name = "ImportCancelled";
  }
}

/**
 * Import one file: `parseRow(row, lineNo)` returns a ParsedAward or null (skipped).
 *
 * The file name is the unit of replacement: rows previously imported from a file with the same
 * name are deleted first, inside the same transaction.
 */
export async function runImport(
  path: string,
  orgKey: OrganizationKey,
  parseRow: RowParser,
  options: ImportOptions = {},
): Promise<ImportStats> {
  const { limit = null, batchSize = 5000, onProgress, signal } = options;
  const sourceFile = options.sourceFile ?? basename(path);
  const stats = emptyStats();
  const importDate = todayLocal();
  const { size } = await import("node:fs/promises").then((fs) => fs.stat(path));
  let bytesRead = 0;

  await inTransaction(async (client) => {
    const organizationId = await getOrganizationId(client, orgKey);
    const replaced = await client.query(
      `DELETE FROM award a USING ministry m
        WHERE m.id = a.ministry_id AND m.organization_id = $1 AND a.source_file = $2`,
      [organizationId, sourceFile],
    );
    stats.replaced = replaced.rowCount ?? 0;
    const lookups = new Lookups(client, organizationId);
    await lookups.load();
    const batch: ParsedAward[] = [];

    const report = () =>
      onProgress?.({
        rowsRead: stats.read,
        rowsImported: stats.imported,
        bytesRead,
        bytesTotal: size,
      });

    const flush = async () => {
      if (!batch.length) return;
      if (signal?.aborted) throw new ImportCancelled();
      await lookups.resolve(batch);
      await insertAwards(client, lookups, batch, sourceFile, importDate);
      stats.imported += batch.length;
      batch.length = 0;
      if (stats.imported % (batchSize * 20) === 0) {
        log.info("rows imported", { sourceFile, imported: stats.imported });
      }
      report();
    };

    let lineNo = 0;
    const lines = decodedLines(path, (bytes) => {
      bytesRead = bytes;
    });
    for await (const row of readRows(lines)) {
      lineNo += 1;
      if (limit !== null && stats.read >= limit) break;
      stats.read += 1;
      if (row[MALFORMED]) {
        stats.malformed += 1;
        continue;
      }
      const parsed = parseRow(row, lineNo);
      if (parsed === null) {
        stats.skipped += 1;
        continue;
      }
      if (parsed.recipientKey === WITHHELD_INDIVIDUAL) stats.withheld_individuals += 1;
      else if (parsed.recipientKey === NOT_DISCLOSED) stats.not_disclosed += 1;
      if (parsed.fields.start_date_estimated) stats.estimated_dates += 1;
      batch.push(parsed);
      if (batch.length >= batchSize) await flush();
    }
    await flush();
    if (orgKey === "federal") await refreshCurrentFlags(client, organizationId);
    if (signal?.aborted) throw new ImportCancelled();
  });
  await ensureFiscalYears();
  await bumpDataVersion();
  log.info("imported", { sourceFile, ...stats });
  return stats;
}
