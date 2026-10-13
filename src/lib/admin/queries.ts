/**
 * Reads for the admin section: a page of each kind of record, with a search box and a filter or
 * two, sorted and counted on the server (there are millions of awards).
 *
 * Name searches use the trigram indexes (UPPER(col) LIKE UPPER('%q%')); counts of each record's
 * awards come from the rollup (current awards, all years).
 */
import { type SQL, sql } from "drizzle-orm";
import type { RecordKind } from "@/lib/domain";
import { normalizeName } from "@/lib/grants/normalize";
import { rows, withStatementTimeout } from "@/lib/rest/db";
import { and, containsText, or } from "@/lib/sql/conditions";

export const PAGE_SIZES = [25, 50, 100] as const;

export interface AdminListParams {
  q: string;
  page: number;
  size: number;
  sort: string;
}

/** The page's list params from its search params, clamped to what the tables offer. */
export function adminParams(
  searchParams: Record<string, string | string[] | undefined>,
  sorts: readonly string[],
): AdminListParams {
  const one = (key: string) => {
    const value = searchParams[key];
    return (Array.isArray(value) ? value[0] : value) ?? "";
  };
  const page = Number.parseInt(one("page"), 10);
  const size = Number.parseInt(one("size"), 10);
  const sort = one("sort");
  return {
    q: one("q").trim().slice(0, 200),
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    size: (PAGE_SIZES as readonly number[]).includes(size) ? size : 25,
    sort: sorts.includes(sort) ? sort : (sorts[0] as string),
  };
}

export interface Page<T> {
  rows: T[];
  total: number;
  /** The total is Postgres's estimate (an unfiltered count of millions of rows). */
  approximate: boolean;
}

const where = (conditions: (SQL | undefined)[]) => {
  const all = conditions.filter((c): c is SQL => Boolean(c));
  return all.length ? sql` WHERE ${and(all)}` : sql``;
};

function orderBy(sort: string, columns: Record<string, string>, tiebreak: string) {
  const desc = sort.startsWith("-");
  const column = columns[sort.replace(/^-/, "")] ?? tiebreak;
  const dir = desc ? "DESC" : "ASC";
  // Default null placement, so a descending sort can read an index backwards
  return sql.raw(`${column} ${dir}, ${tiebreak} ${dir}`);
}

async function paged<T>(
  select: SQL,
  from: SQL,
  conditions: (SQL | undefined)[],
  order: SQL,
  params: AdminListParams,
): Promise<Page<T>> {
  const filter = where(conditions);
  const [count] = await rows<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM ${from}${filter}`);
  const offset = (params.page - 1) * params.size;
  const data = await rows<T>(
    sql`SELECT ${select} FROM ${from}${filter} ORDER BY ${order} LIMIT ${params.size} OFFSET ${offset}`,
  );
  return { rows: data, total: count?.n ?? 0, approximate: false };
}

// ---------------------------------------------------------------------------

export interface OrganizationAdminRow {
  id: number;
  key: string;
  name: string;
  ministries: number;
  awards: number;
}

export async function listOrganizations(): Promise<OrganizationAdminRow[]> {
  return rows(sql`
    SELECT o.id, o.key, o.name,
           (SELECT COUNT(*)::int FROM ministry m WHERE m.organization_id = o.id) AS ministries,
           COALESCE((SELECT SUM(n_awards)::int FROM award_rollup ru WHERE ru.organization_id = o.id AND ru.fiscal_year = 0), 0) AS awards
      FROM organization o ORDER BY o.name`);
}

export const MINISTRY_SORTS = ["name", "-name", "-awards", "awards", "organization"] as const;

export interface MinistryAdminRow {
  id: number;
  name: string;
  organizationId: number;
  organization: string;
  programs: number;
  awards: number;
}

export function listMinistries(params: AdminListParams & { organizationId?: number }) {
  return paged<MinistryAdminRow>(
    sql.raw(`m.id, m.name, m.organization_id AS "organizationId", o.name AS organization,
      (SELECT COUNT(*)::int FROM program p WHERE p.ministry_id = m.id) AS programs,
      COALESCE((SELECT SUM(n_awards)::int FROM award_rollup ru WHERE ru.ministry_id = m.id AND ru.fiscal_year = 0), 0) AS awards`),
    sql.raw("ministry m JOIN organization o ON o.id = m.organization_id"),
    [
      params.q ? containsText(sql.raw("m.name"), params.q) : undefined,
      params.organizationId ? sql`m.organization_id = ${params.organizationId}` : undefined,
    ],
    orderBy(params.sort, { name: "m.name", awards: "awards", organization: "o.name" }, "m.id"),
    params,
  );
}

export const PROGRAM_SORTS = ["name", "-name", "-awards", "awards"] as const;

export interface ProgramAdminRow {
  id: number;
  name: string;
  ministryId: number;
  ministry: string;
  organization: string;
  awards: number;
}

export function listPrograms(
  params: AdminListParams & { organizationId?: number; ministryId?: number },
) {
  return paged<ProgramAdminRow>(
    sql.raw(`p.id, p.name, p.ministry_id AS "ministryId", m.name AS ministry, o.name AS organization,
      COALESCE((SELECT SUM(n_awards)::int FROM award_rollup ru WHERE ru.program_id = p.id AND ru.fiscal_year = 0), 0) AS awards`),
    sql.raw(
      "program p JOIN ministry m ON m.id = p.ministry_id JOIN organization o ON o.id = m.organization_id",
    ),
    [
      params.q ? containsText(sql.raw("p.name"), params.q) : undefined,
      params.ministryId ? sql`p.ministry_id = ${params.ministryId}` : undefined,
      params.organizationId ? sql`m.organization_id = ${params.organizationId}` : undefined,
    ],
    orderBy(params.sort, { name: "p.name", awards: "awards" }, "p.id"),
    params,
  );
}

export const RECIPIENT_SORTS = ["name", "-name", "-awards", "awards"] as const;

export interface RecipientAdminRow {
  id: number;
  name: string;
  displayName: string;
  isPlaceholder: boolean;
  awards: number;
}

export function listRecipients(params: AdminListParams & { placeholders?: "only" | "hide" }) {
  const key = params.q ? normalizeName(params.q) || params.q : "";
  return paged<RecipientAdminRow>(
    sql.raw(`r.id, r.name, r.display_name AS "displayName", r.is_placeholder AS "isPlaceholder",
      COALESCE((SELECT SUM(n_awards)::int FROM award_rollup ru WHERE ru.recipient_id = r.id AND ru.fiscal_year = 0), 0) AS awards`),
    sql.raw("recipient r"),
    [
      params.q
        ? or([
            containsText(sql.raw("r.name"), key),
            containsText(sql.raw("r.display_name"), params.q),
          ])
        : undefined,
      params.placeholders === "only" ? sql.raw("r.is_placeholder") : undefined,
      params.placeholders === "hide" ? sql.raw("NOT r.is_placeholder") : undefined,
    ],
    orderBy(params.sort, { name: "r.name", awards: "awards" }, "r.id"),
    params,
  );
}

export const AWARD_SORTS = [
  "-start_date",
  "start_date",
  "-value",
  "value",
  "reference",
  "-id",
] as const;

export interface AwardAdminRow {
  id: number;
  recordKind: RecordKind;
  reference: string;
  agreementNumber: string | null;
  agreementKey: string | null;
  amendmentNumber: number;
  amendmentDate: string | null;
  isCurrent: boolean;
  agreementType: string | null;
  recipientType: string | null;
  recipientProvince: string | null;
  recipientCity: string | null;
  value: string | null;
  startDate: string;
  startDateEstimated: boolean;
  endDate: string | null;
  title: string | null;
  description: string | null;
  naics: string | null;
  businessUnit: string | null;
  lotteryFund: boolean | null;
  sourceFile: string | null;
  importDate: string | null;
  ministryId: number;
  ministry: string;
  organizationId: number;
  organization: string;
  programId: number | null;
  program: string | null;
  recipientId: number;
  recipient: string;
}

export interface AwardFilters {
  organizationId?: number;
  ministryId?: number;
  recipientId?: number;
  programId?: number;
  current?: "yes" | "no";
}

const AWARD_SELECT =
  sql.raw(`a.id, a.record_kind AS "recordKind", a.reference, a.agreement_number AS "agreementNumber",
  a.agreement_key AS "agreementKey", a.amendment_number AS "amendmentNumber", a.amendment_date AS "amendmentDate",
  a.is_current AS "isCurrent", a.agreement_type AS "agreementType", a.recipient_type AS "recipientType",
  a.recipient_province AS "recipientProvince", a.recipient_city AS "recipientCity", a.value, a.start_date AS "startDate",
  a.start_date_estimated AS "startDateEstimated", a.end_date AS "endDate", a.title, a.description, a.naics,
  a.business_unit AS "businessUnit", a.lottery_fund AS "lotteryFund", a.source_file AS "sourceFile",
  a.import_date AS "importDate", a.ministry_id AS "ministryId", m.name AS ministry,
  m.organization_id AS "organizationId", o.name AS organization, a.program_id AS "programId", p.name AS program,
  a.recipient_id AS "recipientId", r.display_name AS recipient`);

const AWARD_FROM = sql.raw(
  "award a JOIN ministry m ON m.id = a.ministry_id JOIN organization o ON o.id = m.organization_id LEFT JOIN program p ON p.id = a.program_id JOIN recipient r ON r.id = a.recipient_id",
);

export async function listAwards(
  params: AdminListParams & AwardFilters,
): Promise<Page<AwardAdminRow>> {
  // A search is a reference (exact or its start), or a recipient's name
  const q = params.q;
  const search = q
    ? or([
        sql`a.reference = ${q}`,
        sql`a.reference LIKE ${`${q.replace(/[\\%_]/g, "\\$&")}%`}`,
        sql`a.recipient_id IN (SELECT id FROM recipient WHERE ${containsText(sql.raw("name"), normalizeName(q) || q)})`,
      ])
    : undefined;
  const conditions = [
    search,
    params.organizationId ? sql`m.organization_id = ${params.organizationId}` : undefined,
    params.ministryId ? sql`a.ministry_id = ${params.ministryId}` : undefined,
    params.recipientId ? sql`a.recipient_id = ${params.recipientId}` : undefined,
    params.programId ? sql`a.program_id = ${params.programId}` : undefined,
    params.current === "yes" ? sql.raw("a.is_current") : undefined,
    params.current === "no" ? sql.raw("NOT a.is_current") : undefined,
  ];
  const filtered = conditions.some(Boolean);
  const order = orderBy(
    params.sort,
    { start_date: "a.start_date", value: "a.value", reference: "a.reference", id: "a.id" },
    "a.id",
  );
  const offset = (params.page - 1) * params.size;
  const data = await rows<AwardAdminRow>(
    sql`SELECT ${AWARD_SELECT} FROM ${AWARD_FROM}${where(conditions)} ORDER BY ${order} LIMIT ${params.size} OFFSET ${offset}`,
  );
  if (!filtered) {
    // Counting millions of rows on every page view isn't worth it: Postgres's estimate will do
    const [estimate] = await rows<{ n: number }>(
      sql`SELECT reltuples::bigint AS n FROM pg_class WHERE oid = 'award'::regclass`,
    );
    return {
      rows: data,
      total: Math.max(estimate?.n ?? 0, offset + data.length),
      approximate: true,
    };
  }
  // An exact count when it comes quickly; otherwise (n = -1) the estimate below
  const [count] = await withStatementTimeout(
    () =>
      rows<{ n: number }>(sql`SELECT COUNT(*)::int AS n FROM ${AWARD_FROM}${where(conditions)}`),
    10_000,
  ).catch(() => [{ n: -1 }]);
  const total = count?.n ?? 0;
  return total < 0
    ? {
        rows: data,
        total: offset + data.length + (data.length === params.size ? params.size : 0),
        approximate: true,
      }
    : { rows: data, total, approximate: false };
}

export async function getAward(id: number): Promise<AwardAdminRow | null> {
  const [row] = await rows<AwardAdminRow>(
    sql`SELECT ${AWARD_SELECT} FROM ${AWARD_FROM} WHERE a.id = ${id}`,
  );
  return row ?? null;
}

export interface FiscalYearAdminRow {
  id: number;
  year: number;
  startDate: string;
  endDate: string;
}

export function listFiscalYears(): Promise<FiscalYearAdminRow[]> {
  return rows(
    sql`SELECT id, year, start_date AS "startDate", end_date AS "endDate" FROM fiscal_year ORDER BY year DESC`,
  );
}

// ---------------------------------------------------------------------------
// Options for the forms' pickers
// ---------------------------------------------------------------------------

export interface Option {
  value: string;
  label: string;
  hint?: string;
}

export async function organizationOptions(): Promise<Option[]> {
  const found = await rows<{ id: number; name: string }>(
    sql`SELECT id, name FROM organization ORDER BY name`,
  );
  return found.map((row) => ({ value: String(row.id), label: row.name }));
}

export async function ministryOptions(): Promise<(Option & { organizationId: number })[]> {
  const found = await rows<{
    id: number;
    name: string;
    organization_id: number;
    organization: string;
  }>(
    sql`SELECT m.id, m.name, m.organization_id, o.name AS organization
          FROM ministry m JOIN organization o ON o.id = m.organization_id ORDER BY o.name, m.name`,
  );
  return found.map((row) => ({
    value: String(row.id),
    label: row.name,
    hint: row.organization,
    organizationId: row.organization_id,
  }));
}

export async function programOptions(ministryId: number, q: string): Promise<Option[]> {
  const found = await rows<{ id: number; name: string }>(
    sql`SELECT id, name FROM program WHERE ministry_id = ${ministryId}${q ? sql` AND ${containsText(sql.raw("name"), q)}` : sql``}
         ORDER BY name LIMIT 50`,
  );
  return found.map((row) => ({ value: String(row.id), label: row.name }));
}

export async function recipientOptions(q: string): Promise<Option[]> {
  if (!q.trim()) return [];
  const key = normalizeName(q) || q;
  const found = await rows<{ id: number; name: string; display_name: string }>(
    sql`SELECT id, name, display_name FROM recipient
         WHERE ${or([containsText(sql.raw("name"), key), containsText(sql.raw("display_name"), q)])}
         ORDER BY (name = ${key}) DESC, length(name), name LIMIT 30`,
  );
  return found.map((row) => ({ value: String(row.id), label: row.display_name, hint: row.name }));
}
