/**
 * Curated record-listing and lookup tools (organizations, ministries, programs, recipients,
 * awards, fiscal years). Read-only; all filtering goes through the schema allowlist.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { organizationMeta } from "@/lib/grants/constants";
import { normalizeName } from "@/lib/grants/normalize";
import {
  clampLimit,
  clampOffset,
  type Filter,
  filterCondition,
  type McpDeps,
  type Row,
  resolveOrdering,
  selectList,
  sortedNames,
  statementIdentity,
  whereClause,
} from "@/lib/mcp/queries";
import { notFound, type ToolData, ToolError } from "@/lib/mcp/result";
import { type FieldMap, MODELS, type ModelDef } from "@/lib/mcp/schema";
import { cached } from "@/lib/server/cache";
import { containsText, or } from "@/lib/sql/conditions";
import { args, register } from "./register";

export const LIST_DESCRIPTION_CHARS = 300;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function project(row: Row, fields: string[] | null | undefined, available: string[]): Row {
  if (!fields || fields.length === 0) return row;
  const invalid = fields.filter((field) => !available.includes(field));
  if (invalid.length > 0) {
    throw new ToolError(
      `Unknown field(s) ${invalid.join(", ")}. Available: ${sortedNames(available)}`,
    );
  }
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

const ORGANIZATION_KEYS = [
  "id",
  "name",
  "record_kind",
  "source",
  "source_url",
  "licence",
  "attribution",
];

function organizationDict(row: Row): Row {
  const meta = organizationMeta(row.key as string);
  return {
    id: row.id,
    name: row.name,
    record_kind: meta?.record_kind ?? null,
    source: meta?.source ?? null,
    source_url: meta?.source_url ?? null,
    licence: meta?.licence ?? null,
    attribution: meta?.attribution ?? null,
  };
}

/** Trim to 300 characters (code points, as Python slices) plus an ellipsis. */
export function truncateDescription(description: unknown): unknown {
  if (typeof description !== "string") return description;
  const chars = Array.from(description);
  if (chars.length <= LIST_DESCRIPTION_CHARS) return description;
  return `${chars.slice(0, LIST_DESCRIPTION_CHARS).join("").trimEnd()}…`;
}

/** Every field of the model's field map, in order: the serialized record. */
function recordSelect(fields: FieldMap): SQL {
  return selectList(fields, Object.keys(fields));
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

interface PageQuery {
  model: ModelDef;
  select: SQL;
  conditions: Array<SQL | undefined>;
  ordering: SQL[];
  serialize: (row: Row) => Row;
  available: string[];
  fields?: string[] | null;
  limit: unknown;
  offset: unknown;
}

async function paginate(deps: McpDeps, page: PageQuery): Promise<ToolData> {
  const limit = clampLimit(page.limit);
  const offset = clampOffset(page.offset);
  const where = whereClause(page.conditions);
  // The COUNT over a large filtered set is the expensive half of a list call and identical
  // across pages: key it on the ordering-less SQL so offset walks and sort permutations share
  // one entry. The data version in the cache key invalidates it.
  const countStatement = sql`SELECT COUNT(*) AS n FROM ${page.model.from}${where}`;
  const total = await cached("mcp_count", statementIdentity(countStatement), async () => {
    const rows = await deps.query(countStatement);
    return Number(rows[0]?.n ?? 0);
  });
  const rows = await deps.query(
    sql`SELECT ${page.select} FROM ${page.model.from}${where} ORDER BY ${sql.join(
      [...page.ordering, sql`${page.model.id} ASC`],
      sql`, `,
    )} LIMIT ${limit} OFFSET ${offset}`,
  );
  const data = rows.map((row) => project(page.serialize(row), page.fields, page.available));
  return { count: total, limit, offset, data };
}

function ordering(sort: string[] | null | undefined, model: ModelDef, fallback: SQL): SQL[] {
  const resolved = resolveOrdering(sort, model);
  return resolved.length > 0 ? resolved : [fallback];
}

async function getOne(deps: McpDeps, model: ModelDef, select: SQL, id: number, label: string) {
  const rows = await deps.query(
    sql`SELECT ${select} FROM ${model.from} WHERE ${model.id} = ${id} LIMIT 1`,
  );
  const row = rows[0];
  if (!row) throw notFound(label);
  return row;
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function registerRecordTools(server: McpServer, deps: McpDeps) {
  const organizationSelect = sql`o.id AS id, o.name AS name, o.key AS key`;

  register(
    server,
    "list_organizations",
    "List the publishing governments, with each one's source dataset, licence and attribution line.",
    { limit: args.limit(50), offset: args.offset() },
    async ({ limit, offset }) =>
      paginate(deps, {
        model: MODELS.organization,
        select: organizationSelect,
        conditions: [],
        ordering: [sql`o.name ASC`],
        serialize: organizationDict,
        available: ORGANIZATION_KEYS,
        limit,
        offset,
      }),
  );

  register(
    server,
    "get_organization",
    "Get one organization (publishing government) by id.",
    { id: z.number().int() },
    async ({ id }) =>
      organizationDict(
        await getOne(deps, MODELS.organization, organizationSelect, id, "Organization"),
      ),
  );

  const ministry = MODELS.ministry;
  register(
    server,
    "list_ministries",
    "List ministries / federal departments, optionally scoped to an organization or name search.",
    {
      organization_id: args.optionalInt(),
      search: args.optionalString(),
      filters: args.filters(),
      combine: args.combine(),
      fields: args.fields(),
      sort: args.sort(),
      limit: args.limit(50),
      offset: args.offset(),
    },
    async (a) =>
      paginate(deps, {
        model: ministry,
        select: recordSelect(ministry.fields),
        conditions: [
          a.organization_id != null ? sql`m.organization_id = ${a.organization_id}` : undefined,
          a.search ? containsText(sql`m.name`, a.search) : undefined,
          filterCondition(a.filters as Filter[] | null, ministry, a.combine),
        ],
        ordering: ordering(a.sort, ministry, sql`m.name ASC`),
        serialize: (row) => row,
        available: Object.keys(ministry.fields),
        fields: a.fields,
        limit: a.limit,
        offset: a.offset,
      }),
  );

  register(
    server,
    "get_ministry",
    "Get one ministry / federal department by id.",
    { id: z.number().int() },
    async ({ id }) => getOne(deps, ministry, recordSelect(ministry.fields), id, "Ministry"),
  );

  const program = MODELS.program;
  register(
    server,
    "list_programs",
    "List funding programs, optionally scoped to a ministry or organization, or by name search.",
    {
      ministry_id: args.optionalInt(),
      organization_id: args.optionalInt(),
      search: args.optionalString(),
      filters: args.filters(),
      combine: args.combine(),
      fields: args.fields(),
      sort: args.sort(),
      limit: args.limit(50),
      offset: args.offset(),
    },
    async (a) =>
      paginate(deps, {
        model: program,
        select: recordSelect(program.fields),
        conditions: [
          a.ministry_id != null ? sql`p.ministry_id = ${a.ministry_id}` : undefined,
          a.organization_id != null ? sql`m.organization_id = ${a.organization_id}` : undefined,
          a.search ? containsText(sql`p.name`, a.search) : undefined,
          filterCondition(a.filters as Filter[] | null, program, a.combine),
        ],
        ordering: ordering(a.sort, program, sql`p.name ASC`),
        serialize: (row) => row,
        available: Object.keys(program.fields),
        fields: a.fields,
        limit: a.limit,
        offset: a.offset,
      }),
  );

  register(
    server,
    "get_program",
    "Get one program by id.",
    { id: z.number().int() },
    async ({ id }) => getOne(deps, program, recordSelect(program.fields), id, "Program"),
  );

  const recipient = MODELS.recipient;
  register(
    server,
    "list_recipients",
    "List funding recipients. `search` is matched against the normalised name and the original spelling, case- and accent-insensitively. Placeholder recipients (withheld individuals, undisclosed) are excluded unless include_placeholders=true. Several entries can be the same organization under different names: review them.",
    {
      search: args.optionalString(),
      include_placeholders: z.boolean().default(false),
      filters: args.filters(),
      combine: args.combine(),
      fields: args.fields(),
      sort: args.sort(),
      limit: args.limit(50),
      offset: args.offset(),
    },
    async (a) =>
      paginate(deps, {
        model: recipient,
        select: recordSelect(recipient.fields),
        conditions: [
          a.include_placeholders ? undefined : sql`r.is_placeholder = false`,
          a.search
            ? or([
                containsText(sql`r.name`, normalizeName(a.search) || a.search),
                containsText(sql`r.display_name`, a.search),
              ])
            : undefined,
          filterCondition(a.filters as Filter[] | null, recipient, a.combine),
        ],
        ordering: ordering(a.sort, recipient, sql`r.name ASC`),
        serialize: (row) => row,
        available: Object.keys(recipient.fields),
        fields: a.fields,
        limit: a.limit,
        offset: a.offset,
      }),
  );

  register(
    server,
    "get_recipient",
    "Get one recipient by id.",
    { id: z.number().int() },
    async ({ id }) => getOne(deps, recipient, recordSelect(recipient.fields), id, "Recipient"),
  );

  const award = MODELS.award;
  const awardSelect = recordSelect(award.fields);
  register(
    server,
    "list_awards",
    "List awards (federal agreements and Alberta payments) with structured filters, newest start_date first. Filterable fields include organization, ministry, program, recipient, value, fiscal_year, record_kind, agreement_type and recipient_type (see describe_schema). current_only=true (default) hides superseded federal amendments. Descriptions are cut to 300 characters here; get_award returns the full text. Pass `fields` to keep responses small.",
    {
      filters: args.filters(),
      combine: args.combine(),
      fields: args.fields(),
      sort: args.sort(),
      current_only: z.boolean().default(true),
      limit: args.limit(50),
      offset: args.offset(),
    },
    async (a) =>
      paginate(deps, {
        model: award,
        select: awardSelect,
        conditions: [
          a.current_only ? sql`a.is_current = true` : undefined,
          filterCondition(a.filters as Filter[] | null, award, a.combine),
        ],
        // The trailing id keeps offset pagination deterministic when the sort column ties.
        ordering: ordering(a.sort, award, sql`a.start_date DESC`),
        serialize: (row) => ({ ...row, description: truncateDescription(row.description) }),
        available: Object.keys(award.fields),
        fields: a.fields,
        limit: a.limit,
        offset: a.offset,
      }),
  );

  register(
    server,
    "get_award",
    "Get one award by id with full text. For a federal agreement, `amendments` lists every disclosed version of it (value restated on each).",
    { id: z.number().int() },
    async ({ id }) => {
      const row = await getOne(
        deps,
        award,
        sql`${awardSelect}, a.agreement_key AS _agreement_key`,
        id,
        "Award",
      );
      const { _agreement_key: agreementKey, ...data } = row;
      if (data.record_kind !== "agreement") return data;
      // Every disclosed version of the same agreement (see award.agreement_key).
      const sameAgreement = agreementKey
        ? sql`a.agreement_key = ${agreementKey}`
        : sql`a.reference = ${data.reference}`;
      const versions = await deps.query(
        sql`SELECT a.id, a.reference, a.amendment_number, a.amendment_date, a.value::float8 AS value, a.is_current
            FROM award a
            WHERE a.ministry_id = ${data.ministry_id} AND a.record_kind = 'agreement' AND ${sameAgreement}
            ORDER BY a.amendment_number, a.id`,
      );
      return { ...data, amendments: versions };
    },
  );

  register(
    server,
    "list_fiscal_years",
    "List the fiscal years covered (year, start_date, end_date). FY2024 = Apr 2024 - Mar 2025.",
    {},
    async () => {
      const model = MODELS.fiscal_year;
      const rows = await deps.query(
        sql`SELECT ${recordSelect(model.fields)} FROM ${model.from} ORDER BY ${model.defaultOrder}`,
      );
      return { count: rows.length, data: rows };
    },
  );
}
