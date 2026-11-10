/**
 * Allowlist and schema description for the read-only MCP server.
 *
 * This module is the single security boundary that decides which tables and columns an LLM may
 * read. It references ONLY the grants tables, never the user, session or OAuth tables. Adding a
 * model or field here is the only way to make it reachable from any MCP tool: the flexible
 * `query` tool, every filter, sort and aggregation validates against the maps below. The web
 * API's award columns are taken from AWARD_FIELDS too.
 *
 * Each model reads from a fixed FROM clause with aliased tables; relations are LEFT JOINs on
 * primary keys, which Postgres drops when a query uses none of their columns.
 */
import { type SQL, sql } from "drizzle-orm";
import {
  AGREEMENT_TYPES,
  ORGANIZATIONS,
  RECIPIENT_TYPES,
  RECORD_KINDS,
} from "@/lib/grants/constants";
import { fiscalYearSql } from "@/lib/grants/fiscal";
import { NOT_DISCLOSED, WITHHELD_INDIVIDUAL } from "@/lib/grants/normalize";
import { AGGREGATION_FUNCTIONS_LIST } from "@/lib/mcp/aggregations";
import { FILTER_OPERATORS, type FieldType, QueryError } from "@/lib/sql/conditions";

export interface FieldDef {
  /** The column's SQL over the model's FROM clause. */
  sql: SQL;
  type: FieldType;
}

export type FieldMap = Record<string, FieldDef>;

export interface ModelDef {
  name: ModelName;
  /** `FROM ...` without the keyword. */
  from: SQL;
  fields: FieldMap;
  /** The row's start date (fiscal-year filters translate to it), for awards. */
  startDate?: SQL;
  /** The order a list falls back to (Django's Meta.ordering), plus the id. */
  defaultOrder: SQL;
  /** The primary key, as a tiebreak. */
  id: SQL;
}

export const MODEL_NAMES = [
  "organization",
  "ministry",
  "program",
  "recipient",
  "award",
  "fiscal_year",
] as const;
export type ModelName = (typeof MODEL_NAMES)[number];

const f = (expr: string, type: FieldType): FieldDef => ({ sql: sql.raw(expr), type });

// ---------------------------------------------------------------------------
// Field maps: LLM-facing name -> (SQL, type). Relations only ever reach toward the allowed
// tables. Types: int, str, decimal, date, bool, fiscal_year.
// ---------------------------------------------------------------------------
export const ORGANIZATION_FIELDS: FieldMap = {
  id: f("o.id", "int"),
  name: f("o.name", "str"),
};

export const MINISTRY_FIELDS: FieldMap = {
  id: f("m.id", "int"),
  name: f("m.name", "str"),
  organization_id: f("m.organization_id", "int"),
  organization: f("o.name", "str"),
};

export const PROGRAM_FIELDS: FieldMap = {
  id: f("p.id", "int"),
  name: f("p.name", "str"),
  ministry_id: f("p.ministry_id", "int"),
  ministry: f("m.name", "str"),
  organization_id: f("m.organization_id", "int"),
  organization: f("o.name", "str"),
};

export const RECIPIENT_FIELDS: FieldMap = {
  id: f("r.id", "int"),
  name: f("r.name", "str"),
  display_name: f("r.display_name", "str"),
  is_placeholder: f("r.is_placeholder", "bool"),
};

export const AWARD_START_DATE = sql.raw("a.start_date");

export const AWARD_FIELDS: FieldMap = {
  id: f("a.id", "int"),
  reference: f("a.reference", "str"),
  agreement_number: f("a.agreement_number", "str"),
  record_kind: f("a.record_kind", "str"),
  amendment_number: f("a.amendment_number", "int"),
  amendment_date: f("a.amendment_date", "date"),
  is_current: f("a.is_current", "bool"),
  agreement_type: f("a.agreement_type", "str"),
  recipient_type: f("a.recipient_type", "str"),
  recipient_province: f("a.recipient_province", "str"),
  recipient_city: f("a.recipient_city", "str"),
  value: f("a.value", "decimal"),
  start_date: f("a.start_date", "date"),
  start_date_estimated: f("a.start_date_estimated", "bool"),
  end_date: f("a.end_date", "date"),
  fiscal_year: { sql: fiscalYearSql(AWARD_START_DATE), type: "fiscal_year" },
  title: f("a.title", "str"),
  description: f("a.description", "str"),
  naics: f("a.naics", "str"),
  business_unit: f("a.business_unit", "str"),
  lottery_fund: f("a.lottery_fund", "bool"),
  source_file: f("a.source_file", "str"),
  import_date: f("a.import_date", "date"),
  // Relations (toward allowed tables only)
  ministry_id: f("a.ministry_id", "int"),
  ministry: f("m.name", "str"),
  organization_id: f("m.organization_id", "int"),
  organization: f("o.name", "str"),
  program_id: f("a.program_id", "int"),
  program: f("p.name", "str"),
  recipient_id: f("a.recipient_id", "int"),
  recipient: f("r.name", "str"),
  recipient_display_name: f("r.display_name", "str"),
  recipient_is_placeholder: f("r.is_placeholder", "bool"),
};

export const FISCAL_YEAR_FIELDS: FieldMap = {
  id: f("fy.id", "int"),
  year: f("fy.year", "int"),
  start_date: f("fy.start_date", "date"),
  end_date: f("fy.end_date", "date"),
};

export const AWARD_FROM = sql.raw(
  "award a LEFT JOIN ministry m ON m.id = a.ministry_id LEFT JOIN organization o ON o.id = m.organization_id LEFT JOIN program p ON p.id = a.program_id LEFT JOIN recipient r ON r.id = a.recipient_id",
);

export const MODELS: Record<ModelName, ModelDef> = {
  organization: {
    name: "organization",
    from: sql.raw("organization o"),
    fields: ORGANIZATION_FIELDS,
    defaultOrder: sql.raw("o.name, o.id"),
    id: sql.raw("o.id"),
  },
  ministry: {
    name: "ministry",
    from: sql.raw("ministry m LEFT JOIN organization o ON o.id = m.organization_id"),
    fields: MINISTRY_FIELDS,
    defaultOrder: sql.raw("m.name, m.id"),
    id: sql.raw("m.id"),
  },
  program: {
    name: "program",
    from: sql.raw(
      "program p LEFT JOIN ministry m ON m.id = p.ministry_id LEFT JOIN organization o ON o.id = m.organization_id",
    ),
    fields: PROGRAM_FIELDS,
    defaultOrder: sql.raw("p.name, p.id"),
    id: sql.raw("p.id"),
  },
  recipient: {
    name: "recipient",
    from: sql.raw("recipient r"),
    fields: RECIPIENT_FIELDS,
    defaultOrder: sql.raw("r.name, r.id"),
    id: sql.raw("r.id"),
  },
  award: {
    name: "award",
    from: AWARD_FROM,
    fields: AWARD_FIELDS,
    startDate: AWARD_START_DATE,
    defaultOrder: sql.raw("a.id"),
    id: sql.raw("a.id"),
  },
  fiscal_year: {
    name: "fiscal_year",
    from: sql.raw("fiscal_year fy"),
    fields: FISCAL_YEAR_FIELDS,
    defaultOrder: sql.raw("fy.year DESC, fy.id"),
    id: sql.raw("fy.id"),
  },
};

export const FIELD_MAPS: Record<ModelName, FieldMap> = Object.fromEntries(
  MODEL_NAMES.map((name) => [name, MODELS[name].fields]),
) as Record<ModelName, FieldMap>;

/** Fields that may be the target of sum/avg (numeric only). */
export const NUMERIC_TYPES = new Set<FieldType>(["int", "decimal"]);

export { FILTER_OPERATORS };
export const AGGREGATION_FUNCTIONS = AGGREGATION_FUNCTIONS_LIST;

export const ATTRIBUTION: Record<string, string> = Object.fromEntries(
  Object.values(ORGANIZATIONS).map((meta) => [meta.name, meta.attribution]),
);

export const CONVENTIONS = {
  fiscal_year:
    "Both governments use an April-March fiscal year. FY2024 = Apr 1 2024 - Mar 31 2025. An award's fiscal_year is derived from start_date (a month before April belongs to the previous fiscal year). Filtering on fiscal_year is translated to a start_date range.",
  record_kinds: RECORD_KINDS,
  do_not_mix:
    "Government of Canada rows are agreements (total committed value, possibly spanning several years). Government of Alberta rows are cash payments on a date. Report them separately; a combined total of the two is not a meaningful measure of funding.",
  amendments:
    "Federal agreements are disclosed once per amendment and each amendment restates the full value. Some departments file amendments under new reference numbers, so versions are grouped by department, agreement number, recipient and start date. Only is_current=true rows carry the latest value. Award tools and the query tool default to current_only=true; pass current_only=false only to inspect amendment history.",
  placeholders: `'${WITHHELD_INDIVIDUAL}' aggregates rows for individuals (federal recipient_type P, or a name that looks like a person's); their names are not stored. '${NOT_DISCLOSED}' holds rows the publisher released without a recipient; for Alberta these are large annual aggregates (e.g. physician fee-for-service, income support), about a quarter of all Alberta dollars. Both are counted in ministry/program totals but are not real recipients: exclude them (recipient_is_placeholder=false) when ranking recipients.`,
  estimated_dates:
    "start_date_estimated=true means the source gave no payment date and start_date is the first day of the disclosed fiscal year. Avoid month-level analysis of those rows.",
  names:
    "Recipient.name is a normalised, upper-cased matching key (accents removed, '&' -> AND, legal forms unified: LIMITED -> LTD, INCORPORATED -> INC). display_name keeps the first spelling seen. The same organization can still appear under several names (e.g. 'GOVERNORS OF THE UNIVERSITY OF CALGARY' vs 'UNIVERSITY OF CALGARY'); search with contains and review the variants before totalling.",
  ministries:
    "Alberta reports each payment under the ministry of the day, so reorganisations show up as separate ministries (e.g. Children's Services until 2023, then Children and Family Services). For multi-year trends by portfolio, look up the predecessor names with list_ministries and combine them, or group by program instead.",
  money:
    "value is CAD. Alberta includes negative payments (reversals and recoveries) that net out in sums. Federal values are agreement totals, not amounts paid to date.",
  attribution:
    "Data from the Government of Canada and the Government of Alberta under their Open Government Licences. Include the attribution line for each organization whose data appears in an answer.",
};

/** The field map for an allowed model name, or a QueryError. */
export function getFieldMap(modelName: string): FieldMap {
  if (!(MODEL_NAMES as readonly string[]).includes(modelName)) {
    throw new QueryError(
      `Unknown or disallowed model '${modelName}'. Allowed models: ${[...MODEL_NAMES].sort().join(", ")}`,
    );
  }
  return FIELD_MAPS[modelName as ModelName];
}

export function getModel(modelName: string): ModelDef {
  getFieldMap(modelName);
  return MODELS[modelName as ModelName];
}

/** A machine-readable description of everything the MCP server exposes. */
export function describeSchema() {
  const fields = (model: ModelName) =>
    Object.entries(FIELD_MAPS[model]).map(([name, meta]) => ({ name, type: meta.type }));
  return {
    description:
      "Read-only access to Canadian public grant disclosures: Government of Canada grants and contributions (agreements) and Government of Alberta grant payments. Exposes organizations, ministries, programs, recipients, awards and fiscal years. User accounts are not accessible.",
    conventions: CONVENTIONS,
    organizations: Object.values(ORGANIZATIONS).map((meta) => ({
      name: meta.name,
      record_kind: meta.record_kind,
      source: meta.source,
      source_url: meta.source_url,
      licence: meta.licence,
      attribution: meta.attribution,
    })),
    models: {
      organization: {
        fields: fields("organization"),
        relations: { ministries: "ministry (many)" },
      },
      ministry: {
        fields: fields("ministry"),
        relations: {
          organization: "organization (one)",
          programs: "program (many)",
          awards: "award (many)",
        },
      },
      program: {
        fields: fields("program"),
        relations: { ministry: "ministry (one)", awards: "award (many)" },
      },
      recipient: { fields: fields("recipient"), relations: { awards: "award (many)" } },
      award: {
        fields: fields("award"),
        relations: {
          ministry: "ministry (one)",
          program: "program (one, optional)",
          recipient: "recipient (one)",
        },
      },
      fiscal_year: { fields: fields("fiscal_year"), relations: {} },
    },
    agreement_types: AGREEMENT_TYPES,
    recipient_types: RECIPIENT_TYPES,
    filter_operators: [...FILTER_OPERATORS],
    aggregation_functions: [...AGGREGATION_FUNCTIONS],
  };
}
