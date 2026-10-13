/**
 * Curated aggregation tools for the questions people ask most: totals by a dimension, one
 * recipient's funding across governments, one ministry's funding, and recipients funded by both
 * governments.
 *
 * Every money total is reported three ways: `agreement_value` (federal agreement totals),
 * `payment_value` (Alberta cash payments) and their arithmetic sum `total_value`. The split is
 * always present so a combined figure is never mistaken for a like-for-like measure.
 *
 * Results are pure functions of their arguments and the data, so they are cached under the data
 * version (src/lib/server/cache.ts): an import or edit makes every earlier entry unreachable.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { fiscalYearSql } from "@/lib/grants/fiscal";
import { normalizeName } from "@/lib/grants/normalize";
import {
  clampLimit,
  type Filter,
  filterCondition,
  fiscalRange,
  type McpDeps,
  type Row,
  sortedNames,
  whereClause,
} from "@/lib/mcp/queries";
import { notFound, ToolError } from "@/lib/mcp/result";
import { AWARD_FROM, AWARD_START_DATE, MODELS } from "@/lib/mcp/schema";
import { cached } from "@/lib/server/cache";
import { containsText } from "@/lib/sql/conditions";
import { args, register } from "./register";

const FY = fiscalYearSql(AWARD_START_DATE);

/** group_by name -> [(SQL, output name)]. The first column is the group label. */
const GROUP_BY: Record<string, Array<[SQL, string]>> = {
  organization: [
    [sql`o.name`, "group"],
    [sql`m.organization_id`, "group_id"],
  ],
  ministry: [
    [sql`m.name`, "group"],
    [sql`a.ministry_id`, "group_id"],
    [sql`o.name`, "organization"],
  ],
  program: [
    [sql`p.name`, "group"],
    [sql`a.program_id`, "group_id"],
    [sql`m.name`, "ministry"],
    [sql`o.name`, "organization"],
  ],
  recipient: [
    [sql`r.name`, "group"],
    [sql`a.recipient_id`, "group_id"],
    [sql`r.display_name`, "display_name"],
    [sql`r.is_placeholder`, "is_placeholder"],
  ],
  record_kind: [[sql`a.record_kind`, "group"]],
  agreement_type: [[sql`a.agreement_type`, "group"]],
  recipient_type: [[sql`a.recipient_type`, "group"]],
  recipient_province: [[sql`a.recipient_province`, "group"]],
  fiscal_year: [[FY, "group"]],
};

/** award_count, total_value, agreement_value, payment_value (money as float, as the Python sent it). */
const SUMS = sql`COUNT(a.id) AS award_count,
  SUM(a.value)::float8 AS total_value,
  (SUM(a.value) FILTER (WHERE a.record_kind = 'agreement'))::float8 AS agreement_value,
  (SUM(a.value) FILTER (WHERE a.record_kind = 'payment'))::float8 AS payment_value`;

const BY_TOTAL = sql`total_value DESC NULLS LAST`;

function money(row: Row) {
  return {
    award_count: Number(row.award_count ?? 0),
    agreement_value: row.agreement_value ?? null,
    payment_value: row.payment_value ?? null,
    total_value: row.total_value ?? null,
  };
}

function columns(cols: Array<[SQL, string]>): SQL {
  return sql.join(
    cols.map(([expr, name]) => sql`${expr} AS ${sql.identifier(name)}`),
    sql`, `,
  );
}

/** `1, 2, ...`: GROUP BY / ORDER BY the first n selected columns. */
function ordinals(n: number): SQL {
  return sql.raw(Array.from({ length: n }, (_, i) => String(i + 1)).join(", "));
}

/** Current awards (unless current_only is false) matching the conditions. */
function awardWhere(conditions: Array<SQL | undefined>, currentOnly = true): SQL {
  return whereClause([currentOnly ? sql`a.is_current = true` : undefined, ...conditions]);
}

/** A stable cache identity for a tool call: the tool name and its (defaulted) arguments. */
function identity(tool: string, values: Record<string, unknown>): string {
  const canonical = Object.keys(values)
    .sort()
    .map((key) => [key, values[key] ?? null]);
  return `${tool}:${JSON.stringify(canonical)}`;
}

async function byOrganization(deps: McpDeps, where: SQL) {
  const rows = await deps.query(
    sql`SELECT o.name AS organization, ${SUMS} FROM ${AWARD_FROM}${where} GROUP BY 1 ORDER BY 1`,
  );
  return rows.map((r) => ({ organization: r.organization, ...money(r) }));
}

async function byFiscalYearAndOrganization(deps: McpDeps, where: SQL) {
  const rows = await deps.query(
    sql`SELECT ${FY} AS fiscal_year, o.name AS organization, ${SUMS}
        FROM ${AWARD_FROM}${where} GROUP BY 1, 2 ORDER BY 1, 2`,
  );
  return rows.map((r) => ({
    fiscal_year: r.fiscal_year,
    organization: r.organization,
    ...money(r),
  }));
}

async function resolveRecipient(
  deps: McpDeps,
  recipientId: number | null | undefined,
  recipientName: string | null | undefined,
): Promise<Row> {
  const select = sql`SELECT r.id, r.name, r.display_name, r.is_placeholder FROM recipient r`;
  if (recipientId !== null && recipientId !== undefined) {
    const rows = await deps.query(sql`${select} WHERE r.id = ${recipientId}`);
    if (!rows[0]) throw notFound("Recipient");
    return rows[0];
  }
  if (!recipientName) throw new ToolError("Provide recipient_id or recipient_name");
  const key = normalizeName(recipientName);
  const exact = await deps.query(
    sql`${select} WHERE r.name = ${key} ORDER BY r.name, r.id LIMIT 1`,
  );
  if (exact[0]) return exact[0];
  const close = await deps.query(
    sql`SELECT r.name FROM recipient r
        WHERE ${containsText(sql`r.name`, key)} AND r.is_placeholder = false
        ORDER BY r.name LIMIT 10`,
  );
  const names = close.map((r) => r.name as string);
  throw new ToolError(
    `No recipient named '${recipientName}' (matching key '${key}'). Names containing it: ${names.length > 0 ? names.join(", ") : "none"}. Use list_recipients(search=...) to find the id.`,
  );
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

export function registerAggregateTools(server: McpServer, deps: McpDeps) {
  register(
    server,
    "award_totals",
    "Award count and value grouped by one dimension, highest total first.\n\n`group_by` is one of: organization, ministry, program, recipient, record_kind, agreement_type, recipient_type, recipient_province, fiscal_year. `filters` use the same structured format as list_awards. Placeholder recipients are excluded when grouping by recipient and included otherwise, unless include_placeholders says so. Each group reports agreement_value (federal), payment_value (Alberta) and total_value.",
    {
      group_by: z.string(),
      filters: args.filters(),
      combine: args.combine(),
      current_only: z.boolean().default(true),
      include_placeholders: args.optionalBool(),
      limit: args.limit(50),
    },
    async (a) =>
      cached("mcp", identity("award_totals", a), async () => {
        const cols = GROUP_BY[a.group_by];
        if (!Object.hasOwn(GROUP_BY, a.group_by) || !cols) {
          throw new ToolError(
            `Invalid group_by '${a.group_by}'. Allowed: ${sortedNames(Object.keys(GROUP_BY))}`,
          );
        }
        const includePlaceholders = a.include_placeholders ?? a.group_by !== "recipient";
        const where = awardWhere(
          [
            filterCondition(a.filters as Filter[] | null, MODELS.award, a.combine),
            includePlaceholders ? undefined : sql`r.is_placeholder = false`,
          ],
          a.current_only,
        );
        const rows = await deps.query(
          sql`SELECT ${columns(cols)}, ${SUMS} FROM ${AWARD_FROM}${where}
              GROUP BY ${ordinals(cols.length)}
              ORDER BY ${BY_TOTAL}, ${ordinals(cols.length)}
              LIMIT ${clampLimit(a.limit)}`,
        );
        const data = rows.map((r) => ({
          ...Object.fromEntries(cols.map(([, name]) => [name, r[name]])),
          ...money(r),
        }));
        return { group_by: a.group_by, current_only: a.current_only, data };
      }),
  );

  register(
    server,
    "recipient_funding",
    "Funding summary for one recipient across both governments: totals per organization, per fiscal year, the top programs, and other recipient names that contain this one (possible variants of the same organization, which are NOT included in the totals). Identify the recipient by id or exact name (case, accents and legal-form spelling are normalised). Current amendments only.",
    {
      recipient_id: args.optionalInt(),
      recipient_name: args.optionalString(),
      fiscal_year_from: args.optionalInt(),
      fiscal_year_to: args.optionalInt(),
      top_programs: args.limit(10),
    },
    async (a) =>
      cached("mcp", identity("recipient_funding", a), async () => {
        const recipient = await resolveRecipient(deps, a.recipient_id, a.recipient_name);
        const where = awardWhere([
          sql`a.recipient_id = ${recipient.id}`,
          fiscalRange(AWARD_START_DATE, a.fiscal_year_from, a.fiscal_year_to),
        ]);
        const programs = await deps.query(
          sql`SELECT p.name AS program, m.name AS ministry, o.name AS organization, ${SUMS}
              FROM ${AWARD_FROM}${where}
              GROUP BY 1, 2, 3 ORDER BY ${BY_TOTAL}, 1, 2, 3
              LIMIT ${clampLimit(a.top_programs)}`,
        );
        const variants = await deps.query(
          sql`SELECT r.id, r.name FROM recipient r
              WHERE ${containsText(sql`r.name`, String(recipient.name))}
                AND r.is_placeholder = false AND r.id <> ${recipient.id}
              ORDER BY r.name, r.id LIMIT 10`,
        );
        return {
          recipient: {
            id: recipient.id,
            name: recipient.name,
            display_name: recipient.display_name,
            is_placeholder: recipient.is_placeholder,
          },
          fiscal_year_from: a.fiscal_year_from ?? null,
          fiscal_year_to: a.fiscal_year_to ?? null,
          by_organization: await byOrganization(deps, where),
          by_fiscal_year: await byFiscalYearAndOrganization(deps, where),
          top_programs: programs.map((r) => ({
            program: r.program,
            ministry: r.ministry,
            organization: r.organization,
            ...money(r),
          })),
          possible_variants: variants,
        };
      }),
  );

  register(
    server,
    "ministry_funding",
    "Funding summary for one ministry / federal department: totals, by fiscal year, top programs, and top recipients (placeholders excluded from the ranking but reported separately in placeholder_totals). Current amendments only.",
    {
      ministry_id: z.number().int(),
      fiscal_year_from: args.optionalInt(),
      fiscal_year_to: args.optionalInt(),
      top_recipients: args.limit(10),
      top_programs: args.limit(10),
    },
    async (a) =>
      cached("mcp", identity("ministry_funding", a), async () => {
        const found = await deps.query(
          sql`SELECT m.id, m.name, o.name AS organization
              FROM ministry m LEFT JOIN organization o ON o.id = m.organization_id
              WHERE m.id = ${a.ministry_id}`,
        );
        const ministry = found[0];
        if (!ministry) throw notFound("Ministry");
        const scope = [
          sql`a.ministry_id = ${ministry.id}`,
          fiscalRange(AWARD_START_DATE, a.fiscal_year_from, a.fiscal_year_to),
        ];
        const where = awardWhere(scope);
        const [totals] = await deps.query(
          sql`SELECT ${SUMS}, COUNT(DISTINCT a.recipient_id) AS recipient_count
              FROM ${AWARD_FROM}${where}`,
        );
        const recipients = await deps.query(
          sql`SELECT a.recipient_id, r.name AS recipient, ${SUMS}
              FROM ${AWARD_FROM}${awardWhere([...scope, sql`r.is_placeholder = false`])}
              GROUP BY 1, 2 ORDER BY ${BY_TOTAL}, 2, 1
              LIMIT ${clampLimit(a.top_recipients)}`,
        );
        const placeholders = await deps.query(
          sql`SELECT r.name AS recipient, ${SUMS}
              FROM ${AWARD_FROM}${awardWhere([...scope, sql`r.is_placeholder = true`])}
              GROUP BY 1 ORDER BY 1`,
        );
        const programs = await deps.query(
          sql`SELECT a.program_id, p.name AS program, ${SUMS}
              FROM ${AWARD_FROM}${where}
              GROUP BY 1, 2 ORDER BY ${BY_TOTAL}, 2, 1
              LIMIT ${clampLimit(a.top_programs)}`,
        );
        const byYear = await deps.query(
          sql`SELECT ${FY} AS fiscal_year, ${SUMS} FROM ${AWARD_FROM}${where} GROUP BY 1 ORDER BY 1`,
        );
        return {
          ministry: { id: ministry.id, name: ministry.name, organization: ministry.organization },
          fiscal_year_from: a.fiscal_year_from ?? null,
          fiscal_year_to: a.fiscal_year_to ?? null,
          totals: money(totals ?? {}),
          recipient_count: Number(totals?.recipient_count ?? 0),
          by_fiscal_year: byYear.map((r) => ({ fiscal_year: r.fiscal_year, ...money(r) })),
          top_programs: programs.map((r) => ({
            program_id: r.program_id,
            program: r.program,
            ...money(r),
          })),
          top_recipients: recipients.map((r) => ({
            recipient_id: r.recipient_id,
            recipient: r.recipient,
            ...money(r),
          })),
          placeholder_totals: placeholders.map((r) => ({ recipient: r.recipient, ...money(r) })),
        };
      }),
  );

  register(
    server,
    "shared_recipients",
    'Recipients funded by more than one government in the period, with each government\'s amount side by side. `order_by` is "combined" (arithmetic sum, default) or an organization name such as "Government of Alberta". `min_value_each` keeps recipients whose amount from every funder is at least that value. `search` keeps recipients whose name contains it (e.g. "FIRST NATION"). Placeholders are excluded. Exact-name matches only: an organization spelled differently in the two sources will not appear (see list_recipients).',
    {
      fiscal_year_from: args.optionalInt(),
      fiscal_year_to: args.optionalInt(),
      search: args.optionalString(),
      order_by: z.string().default("combined"),
      min_value_each: z.number().nullish(),
      limit: args.limit(50),
    },
    async (a) =>
      cached("mcp", identity("shared_recipients", a), async () => {
        const orgs = (await deps.query(
          sql`SELECT o.id, o.name FROM organization o ORDER BY o.name, o.id`,
        )) as Array<{ id: number; name: string }>;

        let ordering: SQL;
        if (a.order_by === "combined") {
          ordering = BY_TOTAL;
        } else {
          const match = orgs.find((o) => o.name.toLowerCase() === a.order_by.toLowerCase());
          if (!match) {
            throw new ToolError(
              `order_by must be 'combined' or one of ${orgs.map((o) => o.name).join(", ")}`,
            );
          }
          ordering = sql`${sql.identifier(`v${match.id}`)} DESC NULLS LAST`;
        }

        const perOrg = orgs.map(
          (org) =>
            sql`(SUM(a.value) FILTER (WHERE m.organization_id = ${org.id}))::float8 AS ${sql.identifier(`v${org.id}`)},
                COUNT(a.id) FILTER (WHERE m.organization_id = ${org.id}) AS ${sql.identifier(`n${org.id}`)}`,
        );
        const having: SQL[] = [sql`COUNT(DISTINCT m.organization_id) >= 2`];
        if (a.min_value_each !== null && a.min_value_each !== undefined) {
          for (const org of orgs) {
            having.push(
              sql`SUM(a.value) FILTER (WHERE m.organization_id = ${org.id}) >= ${a.min_value_each}`,
            );
          }
        }
        const where = awardWhere([
          sql`r.is_placeholder = false`,
          fiscalRange(AWARD_START_DATE, a.fiscal_year_from, a.fiscal_year_to),
          a.search ? containsText(sql`r.name`, normalizeName(a.search) || a.search) : undefined,
        ]);
        const grouped = sql`SELECT a.recipient_id, r.name AS recipient,
            COUNT(DISTINCT m.organization_id) AS funder_count,
            SUM(a.value)::float8 AS total_value
            ${perOrg.length > 0 ? sql`, ${sql.join(perOrg, sql`, `)}` : sql``}
          FROM ${AWARD_FROM}${where}
          GROUP BY a.recipient_id, r.name
          HAVING ${sql.join(having, sql` AND `)}`;

        const [counted] = await deps.query(sql`SELECT COUNT(*) AS n FROM (${grouped}) shared`);
        const rows = await deps.query(
          sql`${grouped} ORDER BY ${ordering}, recipient, recipient_id LIMIT ${clampLimit(a.limit)}`,
        );
        return {
          fiscal_year_from: a.fiscal_year_from ?? null,
          fiscal_year_to: a.fiscal_year_to ?? null,
          recipient_count: Number(counted?.n ?? 0),
          data: rows.map((r) => ({
            recipient_id: r.recipient_id,
            recipient: r.recipient,
            funding: orgs.map((org) => ({
              organization: org.name,
              value: r[`v${org.id}`] ?? null,
              award_count: Number(r[`n${org.id}`] ?? 0),
            })),
            combined_value: r.total_value ?? null,
          })),
        };
      }),
  );
}
