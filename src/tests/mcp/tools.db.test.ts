/**
 * The read-only MCP tools, driven through a real MCP client over an in-memory transport. They
 * focus on what matters for an LLM-facing surface: correct numbers under the data conventions,
 * the allowlist as a hard boundary, the row cap, and caching.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "@/lib/db";
import { award } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import { NOT_DISCLOSED, WITHHELD_INDIVIDUAL } from "@/lib/grants/normalize";
import { bumpDataVersion } from "@/lib/grants/version";
import { defaultDeps, type McpDeps } from "@/lib/mcp/queries";
import { MODEL_NAMES } from "@/lib/mcp/schema";
import { createMcpServer } from "@/lib/mcp/server";
import { buildGrantsFixture, type GrantsFixture, resetDb } from "@/tests/db/helpers";

// biome-ignore lint/suspicious/noExplicitAny: tool results are untyped JSON
type Data = Record<string, any>;

const dialect = new PgDialect();
let statements: string[] = [];
const recordingDeps: McpDeps = {
  query: (statement: SQL) => {
    statements.push(dialect.sqlToQuery(statement).sql);
    return defaultDeps.query(statement);
  },
};

let client: Client;
let fx: GrantsFixture;

async function connect(deps: McpDeps = recordingDeps) {
  const server = createMcpServer(deps);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), mcp.connect(clientTransport)]);
  return mcp;
}

function text(result: CallToolResult) {
  return result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
}

async function call(name: string, args: Record<string, unknown> = {}): Promise<Data> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  if (result.isError) throw new Error(`${name} failed: ${text(result)}`);
  // The text block carries the same JSON as structuredContent.
  expect(JSON.parse(text(result))).toEqual(result.structuredContent);
  return result.structuredContent as Data;
}

async function callError(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  expect(result.isError, `${name} should fail`).toBe(true);
  return text(result);
}

const FED = { field: "organization", op: "eq", value: "Government of Canada" };

beforeEach(async () => {
  await resetDb();
  fx = await buildGrantsFixture();
  client = await connect();
  statements = [];
});

afterEach(async () => {
  await client.close();
  vi.unstubAllEnvs();
  resetEnvCache();
});

afterAll(async () => {
  await closeDb();
});

describe("server", () => {
  it("lists the 17 tools and the schema resource", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "award_totals",
        "describe_schema",
        "get_award",
        "get_ministry",
        "get_organization",
        "get_program",
        "get_recipient",
        "list_awards",
        "list_fiscal_years",
        "list_ministries",
        "list_organizations",
        "list_programs",
        "list_recipients",
        "ministry_funding",
        "query",
        "recipient_funding",
        "shared_recipients",
      ].sort(),
    );
    expect(tools.every((t) => t.annotations?.readOnlyHint)).toBe(true);
    expect(client.getServerVersion()?.name).toBe("grantledger");
    expect(client.getInstructions()).toContain("describe_schema");

    const resource = await client.readResource({ uri: "schema://grants" });
    const content = resource.contents[0];
    const described = JSON.parse(content && "text" in content ? content.text : "{}");
    expect(Object.keys(described.models)).toEqual([...MODEL_NAMES]);
  });
});

describe("records", () => {
  it("lists organizations with licence and attribution", async () => {
    const result = await call("list_organizations");
    const byName = Object.fromEntries(result.data.map((o: Data) => [o.name, o]));
    expect(byName["Government of Alberta"].record_kind).toBe("payment");
    expect(byName["Government of Canada"].attribution).toContain(
      "Open Government Licence – Canada",
    );
    expect(result.count).toBe(2);
    expect((await call("get_organization", { id: fx.ab.id })).name).toBe("Government of Alberta");
  });

  it("hides superseded amendments by default", async () => {
    const filters = [{ field: "reference", op: "eq", value: "F1" }];
    const current = await call("list_awards", { filters });
    expect(current.data.map((a: Data) => a.value)).toEqual([150]);
    const history = await call("list_awards", { filters, current_only: false });
    expect(history.count).toBe(2);
  });

  it("truncates descriptions in lists and projects fields", async () => {
    const result = await call("list_awards", { filters: [FED], limit: 1 });
    expect(result.data[0].description.length).toBeLessThan(400);
    expect(result.data[0].description.endsWith("…")).toBe(true);
    const projected = await call("list_awards", { fields: ["reference", "value"], limit: 1 });
    expect(Object.keys(projected.data[0]).sort()).toEqual(["reference", "value"]);
    expect(await callError("list_awards", { fields: ["email"] })).toContain(
      "Unknown field(s) email",
    );
  });

  it("serializes awards like the Python server", async () => {
    const [row] = (
      await call("list_awards", {
        filters: [{ field: "reference", op: "eq", value: "F2" }],
      })
    ).data;
    expect(row).toMatchObject({
      reference: "F2",
      record_kind: "agreement",
      value: 1000,
      start_date: "2025-02-01",
      fiscal_year: 2024,
      organization: "Government of Canada",
      recipient: "NATIONAL WIDGETS INC",
      recipient_display_name: "National Widgets Inc.",
      recipient_is_placeholder: false,
      program: "Community Program",
    });
  });

  it("returns the amendment history and full text in get_award", async () => {
    const [current] = (
      await call("list_awards", { filters: [{ field: "reference", op: "eq", value: "F1" }] })
    ).data;
    const result = await call("get_award", { id: current.id });
    expect(result.amendments.map((a: Data) => a.value)).toEqual([100, 150]);
    expect(result.amendments[0]).toEqual(
      expect.objectContaining({ reference: "F1", amendment_number: 0, is_current: false }),
    );
    expect(result.description).toHaveLength(1000);
    expect(result).not.toHaveProperty("_agreement_key");
  });

  it("reports an unknown id", async () => {
    expect(await callError("get_award", { id: 999_999 })).toBe(
      "Error executing tool get_award: Award matching query does not exist.",
    );
    expect(await callError("get_ministry", { id: 999_999 })).toContain(
      "Ministry matching query does not exist.",
    );
  });

  it("filters on fiscal_year", async () => {
    // Feb 2025 belongs to FY2024; nothing falls in FY2023.
    const result = await call("list_awards", {
      filters: [{ field: "fiscal_year", op: "eq", value: 2024 }],
    });
    expect(result.count).toBe(7);
    const none = await call("list_awards", {
      filters: [{ field: "fiscal_year", op: "eq", value: 2023 }],
    });
    expect(none.count).toBe(0);
  });

  it("normalises recipient search and hides placeholders", async () => {
    expect((await call("list_recipients", { search: "example société" })).count).toBe(0);
    const result = await call("list_recipients", { search: "Example Society" });
    expect(new Set(result.data.map((r: Data) => r.name))).toEqual(
      new Set(["EXAMPLE SOCIETY", "EXAMPLE SOCIETY OF CALGARY"]),
    );
    expect((await call("list_recipients", { include_placeholders: true })).count).toBe(5);
  });

  it("scopes ministries and programs", async () => {
    const ministries = await call("list_ministries", { organization_id: fx.ab.id });
    expect(ministries.data.map((m: Data) => m.name)).toEqual(["Culture", "Health"]);
    const programs = await call("list_programs", { search: "cfep" });
    expect(programs.data).toEqual([
      {
        id: fx.abProg.id,
        name: "CFEP",
        ministry_id: fx.culture.id,
        ministry: "Culture",
        organization_id: fx.ab.id,
        organization: "Government of Alberta",
      },
    ]);
    const sorted = await call("list_ministries", { sort: ["-name"], fields: ["name"] });
    expect(sorted.data.map((m: Data) => m.name)).toEqual([
      "Health",
      "Example Agency Canada",
      "Culture",
    ]);
  });

  it("lists fiscal years", async () => {
    expect(await call("list_fiscal_years")).toEqual({
      count: 1,
      data: [
        { id: expect.any(Number), year: 2024, start_date: "2024-04-01", end_date: "2025-03-31" },
      ],
    });
  });
});

describe("aggregates", () => {
  it("splits award_totals by organization into agreement and payment value", async () => {
    const result = await call("award_totals", { group_by: "organization" });
    const byOrg = Object.fromEntries(result.data.map((r: Data) => [r.group, r]));
    expect(byOrg["Government of Canada"].agreement_value).toBe(1170); // 150 + 1000 + 20
    expect(byOrg["Government of Canada"].payment_value).toBeNull();
    expect(byOrg["Government of Alberta"].payment_value).toBe(1_000_035);
    expect(byOrg["Government of Alberta"].group_id).toBe(fx.ab.id);
  });

  it("excludes placeholders when grouping by recipient", async () => {
    const result = await call("award_totals", { group_by: "recipient" });
    const names = result.data.map((r: Data) => r.group);
    expect(names).not.toContain(NOT_DISCLOSED);
    expect(names).not.toContain(WITHHELD_INDIVIDUAL);
    expect(names[0]).toBe("NATIONAL WIDGETS INC");
    const shared = result.data.find((r: Data) => r.group === "EXAMPLE SOCIETY");
    expect([shared.agreement_value, shared.payment_value]).toEqual([150, 30]);

    const withPlaceholders = await call("award_totals", {
      group_by: "recipient",
      include_placeholders: true,
    });
    expect(withPlaceholders.data[0].group).toBe(NOT_DISCLOSED);
  });

  it("groups award_totals by fiscal year", async () => {
    const result = await call("award_totals", { group_by: "fiscal_year", filters: [FED] });
    expect(result.data).toEqual([
      {
        group: 2024,
        award_count: 3,
        agreement_value: 1170,
        payment_value: null,
        total_value: 1170,
      },
    ]);
  });

  it("rejects an invalid group_by", async () => {
    expect(await callError("award_totals", { group_by: "email" })).toContain(
      "Invalid group_by 'email'",
    );
  });

  it("summarises one recipient by name, with variants", async () => {
    const result = await call("recipient_funding", { recipient_name: "Example Society" });
    const byOrg = Object.fromEntries(result.by_organization.map((r: Data) => [r.organization, r]));
    expect(byOrg["Government of Canada"].agreement_value).toBe(150);
    expect(byOrg["Government of Alberta"].payment_value).toBe(30);
    expect(result.possible_variants.map((v: Data) => v.name)).toEqual([
      "EXAMPLE SOCIETY OF CALGARY",
    ]);
    expect(result.recipient).toEqual({
      id: fx.shared.id,
      name: "EXAMPLE SOCIETY",
      display_name: "Example Society",
      is_placeholder: false,
    });
    expect(result.by_fiscal_year).toHaveLength(2);
    expect(result.top_programs[0]).toMatchObject({
      program: "Community Program",
      total_value: 150,
    });
  });

  it("suggests names for an unknown recipient", async () => {
    expect(
      await callError("recipient_funding", { recipient_name: "Society of Calgary" }),
    ).toContain("EXAMPLE SOCIETY OF CALGARY");
    expect(await callError("recipient_funding", {})).toContain(
      "Provide recipient_id or recipient_name",
    );
  });

  it("reports ministry placeholders separately", async () => {
    const result = await call("ministry_funding", { ministry_id: fx.health.id });
    expect(result.top_recipients).toEqual([]);
    expect(result.placeholder_totals[0].recipient).toBe(NOT_DISCLOSED);
    expect(result.totals.payment_value).toBe(1_000_000);
    expect(result.recipient_count).toBe(1);
    expect(result.ministry).toEqual({
      id: fx.health.id,
      name: "Health",
      organization: "Government of Alberta",
    });
  });

  it("finds recipients shared by both governments", async () => {
    const result = await call("shared_recipients");
    expect(result.recipient_count).toBe(1);
    const row = result.data[0];
    expect(row.recipient).toBe("EXAMPLE SOCIETY");
    const funding = Object.fromEntries(row.funding.map((f: Data) => [f.organization, f.value]));
    expect(funding).toEqual({ "Government of Alberta": 30, "Government of Canada": 150 });
    expect(row.combined_value).toBe(180);
    expect((await call("shared_recipients", { min_value_each: 50 })).recipient_count).toBe(0);
    expect((await call("shared_recipients", { search: "example soc" })).recipient_count).toBe(1);
    expect((await call("shared_recipients", { search: "widgets" })).recipient_count).toBe(0);
    expect(
      (await call("shared_recipients", { order_by: "government of alberta" })).recipient_count,
    ).toBe(1);
    expect(await callError("shared_recipients", { order_by: "nonsense" })).toContain(
      "order_by must be 'combined'",
    );
  });
});

describe("query", () => {
  it("sums by group over current amendments", async () => {
    const result = await call("query", {
      model: "award",
      group_by: ["organization", "record_kind"],
      aggregations: [{ func: "sum", field: "value", alias: "total" }],
      order_by: ["organization"],
    });
    const totals = Object.fromEntries(
      result.data.map((r: Data) => [`${r.organization}|${r.record_kind}`, r.total]),
    );
    expect(totals["Government of Canada|agreement"]).toBe(1170);
    const allVersions = await call("query", {
      model: "award",
      current_only: false,
      filters: [FED],
      aggregations: [{ func: "sum", field: "value", alias: "total" }],
    });
    expect(allVersions.data.total).toBe(1270);
  });

  it("groups by fiscal year without duplicate groups", async () => {
    const result = await call("query", {
      model: "award",
      group_by: ["fiscal_year"],
      aggregations: [{ func: "count", field: "id", alias: "n" }],
      order_by: ["fiscal_year"],
    });
    const years = result.data.map((r: Data) => r.fiscal_year);
    expect(years.length).toBe(new Set(years).size);
    expect(result.data).toEqual([{ fiscal_year: 2024, n: 7 }]);
  });

  it("defaults grouped aggregations to a count", async () => {
    const result = await call("query", { model: "ministry", group_by: ["organization"] });
    expect(result.data).toEqual([
      { organization: "Government of Alberta", count: 2 },
      { organization: "Government of Canada", count: 1 },
    ]);
  });

  it("omits award descriptions from plain rows unless requested", async () => {
    const [row] = (await call("query", { model: "award", limit: 1 })).data;
    expect(row).not.toHaveProperty("description");
    expect(row).toHaveProperty("organization");
    const [picked] = (
      await call("query", { model: "award", fields: ["reference", "description"], limit: 1 })
    ).data;
    expect(Object.keys(picked).sort()).toEqual(["description", "reference"]);
  });

  it("orders plain rows", async () => {
    const result = await call("query", {
      model: "award",
      fields: ["value"],
      order_by: ["-value"],
      limit: 2,
    });
    expect(result.data).toEqual([{ value: 1_000_000 }, { value: 1000 }]);
  });

  it("rejects ordering grouped results by a non-group field", async () => {
    expect(
      await callError("query", {
        model: "award",
        group_by: ["recipient"],
        aggregations: [{ func: "sum", field: "value", alias: "t" }],
        order_by: ["start_date"],
      }),
    ).toContain("Cannot order grouped results by 'start_date'");
  });

  it("returns totals without group_by", async () => {
    const result = await call("query", {
      model: "award",
      filters: [{ field: "record_kind", op: "eq", value: "payment" }],
      aggregations: [
        { func: "count", field: "id" },
        { func: "min", field: "value", alias: "smallest" },
        { func: "avg", field: "amendment_number", alias: "avg_amend" },
        { func: "max", field: "start_date", alias: "latest" },
      ],
    });
    expect(result.data).toEqual({ count_id: 4, smallest: -10, avg_amend: 0, latest: "2024-08-02" });
  });
});

describe("security boundary", () => {
  it("rejects disallowed models", async () => {
    for (const bad of [
      "user",
      "oauthclient",
      "oauth_client",
      "oauthrevokedtoken",
      "session",
      "recipientalias",
      "mcp_user",
    ]) {
      expect(await callError("query", { model: bad })).toContain(
        `Unknown or disallowed model '${bad}'`,
      );
    }
  });

  it("rejects relation traversal outside the allowlist", async () => {
    expect(
      await callError("query", {
        model: "award",
        filters: [
          { field: "recipient__awards__ministry__organization__name", op: "eq", value: "x" },
        ],
      }),
    ).toContain("is not filterable on this model");
  });

  it("rejects a bad operator, a non-numeric sum and a bad alias", async () => {
    expect(
      await callError("list_awards", { filters: [{ field: "value", op: "DROP", value: 1 }] }),
    ).toContain("Unknown filter operator 'DROP'");
    expect(
      await callError("query", {
        model: "award",
        aggregations: [{ func: "sum", field: "description" }],
      }),
    ).toContain("sum requires a numeric field");
    expect(
      await callError("query", {
        model: "award",
        aggregations: [{ func: "count", field: "id", alias: "x; DROP" }],
      }),
    ).toContain("must be an identifier");
    expect(
      await callError("query", {
        model: "award",
        aggregations: [{ func: "count", field: "id", alias: "value" }],
      }),
    ).toContain("must be an identifier");
  });

  it("keeps account and OAuth tables out of the allowlist", () => {
    for (const name of [
      "user",
      "oauthclient",
      "oauth_client",
      "oauthauthorizationrequest",
      "oauth_authorization_request",
      "oauthrevokedtoken",
      "mcp_user",
    ]) {
      expect(MODEL_NAMES as readonly string[]).not.toContain(name);
    }
  });

  it("maps bad filter values to a clear error", async () => {
    expect(
      await callError("list_awards", {
        filters: [{ field: "start_date", op: "gte", value: "not-a-date" }],
      }),
    ).toContain("Invalid value in the query");
    expect(
      await callError("query", {
        model: "award",
        filters: [{ field: "value", op: "gt", value: "lots" }],
      }),
    ).toContain("Invalid value in the query");
  });

  it("describes the conventions", async () => {
    const described = await call("describe_schema");
    for (const key of ["fiscal_year", "do_not_mix", "amendments", "placeholders", "attribution"]) {
      expect(described.conventions).toHaveProperty(key);
    }
  });
});

describe("row cap", () => {
  it("caps the limit", async () => {
    vi.stubEnv("MCP_MAX_ROWS", "2");
    resetEnvCache();
    const result = await call("list_awards", { limit: 10_000 });
    expect([result.limit, result.data.length, result.count]).toEqual([2, 2, 7]);
    expect((await call("query", { model: "award", limit: 10_000 })).data).toHaveLength(2);
  });

  it.each(["", "none", "null", "unlimited", "0"])(
    "is unlimited when MCP_MAX_ROWS=%j",
    async (raw) => {
      vi.stubEnv("MCP_MAX_ROWS", raw);
      resetEnvCache();
      const result = await call("list_awards", { limit: 10_000 });
      expect([result.limit, result.data.length]).toEqual([10_000, 7]);
    },
  );
});

describe("caching", () => {
  it("serves a repeated aggregate from the cache", async () => {
    const first = await call("award_totals", { group_by: "ministry" });
    statements = [];
    const second = await call("award_totals", { group_by: "ministry" });
    expect(second).toEqual(first);
    expect(statements).toEqual([]);
  });

  it("is invalidated by a data version bump", async () => {
    const first = await call("award_totals", { group_by: "organization" });
    await getDb().insert(award).values({
      ministryId: fx.culture.id,
      recipientId: fx.shared.id,
      recordKind: "payment",
      reference: "AB-new",
      value: "1",
      startDate: "2024-09-01",
    });
    await bumpDataVersion();
    const second = await call("award_totals", { group_by: "organization" });
    expect(second).not.toEqual(first);
  });

  it("shares one entry between defaulted and explicit arguments", async () => {
    await call("ministry_funding", { ministry_id: fx.health.id });
    statements = [];
    await call("ministry_funding", { ministry_id: fx.health.id, top_recipients: 10 });
    expect(statements).toEqual([]);
  });

  it("caches the list count across offsets", async () => {
    await call("list_awards", { limit: 1, offset: 0 });
    statements = [];
    await call("list_awards", { limit: 1, offset: 1 });
    expect(statements.filter((s) => s.toUpperCase().includes("COUNT("))).toEqual([]);
    expect(statements).toHaveLength(1);
  });

  it("walks offsets disjointly and exhaustively", async () => {
    const seen = new Set<number>();
    for (let offset = 0; offset < 7; offset++) {
      for (const row of (await call("list_awards", { limit: 1, offset })).data) seen.add(row.id);
    }
    expect(seen.size).toBe(7);
  });

  it("does not cache errors", async () => {
    await callError("recipient_funding", { recipient_name: "Nobody" });
    statements = [];
    await callError("recipient_funding", { recipient_name: "Nobody" });
    expect(statements.length).toBeGreaterThan(0);
  });
});
