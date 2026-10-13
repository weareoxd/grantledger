/**
 * The constrained, structured flexible-query tool plus the schema-description tool.
 *
 * `query` is a read-only query builder: it validates the model, every field, operator and
 * aggregation against the schema allowlist before building any SQL. There is no raw SQL input,
 * and no path to write data or to reach the user, session or OAuth tables.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { AGGREGATION_FUNCTIONS_LIST } from "@/lib/mcp/aggregations";
import {
  clampLimit,
  type Filter,
  filterCondition,
  type McpDeps,
  resolveGroupedOrdering,
  resolveOrdering,
  selectList,
  sortedNames,
  whereClause,
} from "@/lib/mcp/queries";
import { type ToolData, ToolError } from "@/lib/mcp/result";
import {
  describeSchema,
  type FieldDef,
  type FieldMap,
  MODEL_NAMES,
  MODELS,
  type ModelName,
  NUMERIC_TYPES,
} from "@/lib/mcp/schema";
import { args, register } from "./register";

/** Long free-text fields left out of plain rows unless asked for via `fields`. */
const HEAVY_FIELDS: Partial<Record<ModelName, Set<string>>> = { award: new Set(["description"]) };

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Validate aggregation specs and return [alias, SQL] pairs. */
export function buildAggregations(
  aggregations: Array<Record<string, unknown>>,
  fields: FieldMap,
): Array<[string, SQL]> {
  return aggregations.map((spec) => {
    if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
      throw new ToolError("Each aggregation must be an object with func, field and optional alias");
    }
    const func = spec.func;
    const field = spec.field ?? "id";
    const alias = spec.alias || `${String(func)}_${String(field)}`;
    if (
      typeof func !== "string" ||
      !(AGGREGATION_FUNCTIONS_LIST as readonly string[]).includes(func)
    ) {
      throw new ToolError(
        `Invalid aggregation func '${String(func)}'. Allowed: ${sortedNames(AGGREGATION_FUNCTIONS_LIST)}`,
      );
    }
    if (typeof field !== "string" || !Object.hasOwn(fields, field)) {
      throw new ToolError(
        `Cannot aggregate field '${String(field)}'. Allowed: ${sortedNames(Object.keys(fields))}`,
      );
    }
    if (typeof alias !== "string" || !IDENTIFIER.test(alias) || Object.hasOwn(fields, alias)) {
      throw new ToolError(
        `Alias '${String(alias)}' must be an identifier that is not a field name`,
      );
    }
    const def = fields[field] as FieldDef;
    if ((func === "sum" || func === "avg") && !NUMERIC_TYPES.has(def.type)) {
      throw new ToolError(`${func} requires a numeric field; '${field}' is ${def.type}`);
    }
    if (def.type === "fiscal_year") {
      throw new ToolError("Aggregate fiscal_year by grouping on it instead");
    }
    // Sums and averages come back as JSON numbers (the Python server's Decimal -> float);
    // min/max keep the column's type (money as float).
    let expr: SQL;
    if (func === "count") expr = sql`COUNT(${def.sql})`;
    else if (func === "sum") expr = sql`(SUM(${def.sql}))::float8`;
    else if (func === "avg") expr = sql`(AVG(${def.sql}))::float8`;
    else {
      const fn = sql.raw(func.toUpperCase());
      expr = def.type === "decimal" ? sql`(${fn}(${def.sql}))::float8` : sql`${fn}(${def.sql})`;
    }
    return [alias, expr];
  });
}

function aggregationList(aggregations: Array<[string, SQL]>): SQL {
  return sql.join(
    aggregations.map(([alias, expr]) => sql`${expr} AS ${sql.identifier(alias)}`),
    sql`, `,
  );
}

export function registerFlexibleTools(server: McpServer, deps: McpDeps) {
  register(
    server,
    "query",
    `Flexible read-only query over an allowed model (organization, ministry, program, recipient, award, fiscal_year).

- filters: [{"field","op","value"}] validated against the model's fields.
- aggregations: [{"func","field","alias?"}] with func in count/sum/avg/min/max.
- group_by: field names -> grouped rows of those fields plus the aggregations.
- With aggregations and no group_by, returns a single totals object.
- Without aggregations, returns rows; \`fields\` picks columns (award rows omit description unless requested).
- current_only (award only, default true) hides superseded federal amendments.

Call describe_schema for fields and conventions. Group or filter by organization or record_kind before summing award values: federal agreement totals and Alberta payments are different measures. Rows are capped by the server's MCP_MAX_ROWS.`,
    {
      model: z.string(),
      filters: args.filters(),
      combine: args.combine(),
      group_by: z.array(z.string()).nullish(),
      aggregations: z.array(z.record(z.string(), z.unknown())).nullish(),
      order_by: z.array(z.string()).nullish(),
      fields: args.fields(),
      current_only: z.boolean().default(true),
      limit: args.limit(100),
    },
    async (a): Promise<ToolData> => {
      if (!(MODEL_NAMES as readonly string[]).includes(a.model)) {
        throw new ToolError(
          `Unknown or disallowed model '${a.model}'. Allowed: ${sortedNames(MODEL_NAMES)}`,
        );
      }
      const model = MODELS[a.model as ModelName];
      const fields = model.fields;
      const limit = clampLimit(a.limit, 100);

      const where = whereClause([
        a.model === "award" && a.current_only ? sql`a.is_current = true` : undefined,
        filterCondition(a.filters as Filter[] | null, model, a.combine),
      ]);
      let aggregations =
        a.aggregations && a.aggregations.length > 0
          ? buildAggregations(a.aggregations, fields)
          : [];

      // Grouped aggregation: one row per group, the group fields plus the aggregations.
      if (a.group_by && a.group_by.length > 0) {
        const invalid = a.group_by.filter((g) => !Object.hasOwn(fields, g));
        if (invalid.length > 0) {
          throw new ToolError(
            `Cannot group by ${invalid.join(", ")}. Allowed: ${sortedNames(Object.keys(fields))}`,
          );
        }
        const groups = [...new Set(a.group_by)];
        if (aggregations.length === 0) aggregations = [["count", sql`COUNT(${model.id})`]];
        // Order only by selected group keys or aggregation aliases: anything else would have
        // to join the GROUP BY and fragment the groups.
        const ordering = resolveGroupedOrdering(a.order_by, [
          ...groups,
          ...aggregations.map(([alias]) => alias),
        ]);
        const positions = sql.raw(groups.map((_, i) => String(i + 1)).join(", "));
        const rows = await deps.query(
          sql`SELECT ${selectList(fields, groups)}, ${aggregationList(aggregations)}
              FROM ${model.from}${where}
              GROUP BY ${positions}
              ORDER BY ${ordering.length > 0 ? sql`${sql.join(ordering, sql`, `)}, ` : sql``}${positions}
              LIMIT ${limit}`,
        );
        return { model: a.model, group_by: a.group_by, data: rows };
      }

      if (aggregations.length > 0) {
        const [totals] = await deps.query(
          sql`SELECT ${aggregationList(aggregations)} FROM ${model.from}${where}`,
        );
        return { model: a.model, data: totals ?? {} };
      }

      // Plain rows
      let names: string[];
      if (a.fields && a.fields.length > 0) {
        const invalid = a.fields.filter((f) => !Object.hasOwn(fields, f));
        if (invalid.length > 0) {
          throw new ToolError(
            `Unknown field(s) ${invalid.join(", ")}. Allowed: ${sortedNames(Object.keys(fields))}`,
          );
        }
        names = [...new Set(a.fields)];
      } else {
        const heavy = HEAVY_FIELDS[a.model as ModelName] ?? new Set<string>();
        names = Object.keys(fields).filter((f) => !heavy.has(f));
      }
      const ordering =
        a.order_by && a.order_by.length > 0 ? resolveOrdering(a.order_by, model) : [];
      const rows = await deps.query(
        sql`SELECT ${selectList(fields, names)} FROM ${model.from}${where}
            ORDER BY ${sql.join([...ordering, sql`${model.id} ASC`], sql`, `)}
            LIMIT ${limit}`,
      );
      return { model: a.model, data: rows };
    },
  );

  register(
    server,
    "describe_schema",
    "Describe the models, fields, relationships, conventions (fiscal years, record kinds, amendments, placeholders, name matching, attribution), code tables and the available filter operators / aggregation functions. Call this first.",
    {},
    async () => describeSchema(),
    // A fixed description: no query, so no transaction
    { database: false },
  );
}
