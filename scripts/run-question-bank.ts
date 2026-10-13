// Run the experiment's question bank against the live MCP server over Streamable HTTP.
//
// Each question lists the tool calls a model would make to answer it. The runner makes those
// calls through a real MCP client session and records the call count, wall time and the raw
// results to QB_OUT (default docs/results/question-bank-results.json), which the write-up reads from.
//
//   npx tsx scripts/run-question-bank.ts            (MCP_URL, default http://localhost:3000/api/mcp)
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadDotEnv } from "@/lib/env";

loadDotEnv();

const URL_ = process.env.MCP_URL || "http://localhost:3000/api/mcp";
const OUT = process.env.QB_OUT || "docs/results/question-bank-results.json";

type Args = Record<string, unknown>;

const FED = { field: "organization", op: "eq", value: "Government of Canada" };
const AB = { field: "organization", op: "eq", value: "Government of Alberta" };
const fy = (year: number) => ({ field: "fiscal_year", op: "eq", value: year });

interface Question {
  id: string;
  persona: string;
  question: string;
  portal: string;
  portal_why: string;
  calls: Array<[string, Args]>;
}

const QUESTIONS: Question[] = [
  // --- Program analyst ---------------------------------------------------------------------
  {
    id: "A1",
    persona: "Program analyst",
    question:
      "Which organizations received funding from both governments in FY2024, and how much from each?",
    portal: "No",
    portal_why: "Two portals, two exports, then matching recipient names by hand in Excel.",
    calls: [["shared_recipients", { fiscal_year_from: 2024, fiscal_year_to: 2024, limit: 15 }]],
  },
  {
    id: "A2",
    persona: "Program analyst",
    question:
      "From FY2020 to FY2025, how much did each government put into the University of Calgary, by year?",
    portal: "Partial",
    portal_why:
      "Two keyword searches; the federal portal filters by calendar year and lists every amendment.",
    calls: [
      ["list_recipients", { search: "University of Calgary", limit: 10 }],
      [
        "recipient_funding",
        { recipient_name: "University of Calgary", fiscal_year_from: 2020, fiscal_year_to: 2025 },
      ],
    ],
  },
  {
    id: "A3",
    persona: "Program analyst",
    question: "Which Alberta programs grew the most between FY2022 and FY2025?",
    portal: "No",
    portal_why: "The Alberta table pages through payments ten at a time and never totals them.",
    calls: [
      [
        "query",
        {
          model: "award",
          filters: [
            AB,
            { field: "fiscal_year", op: "in", value: [2022, 2025] },
            { field: "recipient_is_placeholder", op: "eq", value: false },
          ],
          group_by: ["program", "fiscal_year"],
          aggregations: [{ func: "sum", field: "value", alias: "paid" }],
          order_by: ["-paid"],
          limit: 400,
        },
      ],
    ],
  },
  {
    id: "A4",
    persona: "Program analyst",
    question:
      "What share of Alberta Health's FY2024 grant payments went to named recipients versus undisclosed aggregates?",
    portal: "No",
    portal_why:
      "No totals; undisclosed rows are listed under program names among thousands of payments.",
    calls: [
      ["list_ministries", { organization_id: null, search: "Health", limit: 20 }],
      [
        "ministry_funding",
        { ministry_id: "$Health", fiscal_year_from: 2024, fiscal_year_to: 2024, top_recipients: 5 },
      ],
    ],
  },
  // --- Journalist / researcher ---------------------------------------------------------------
  {
    id: "B1",
    persona: "Journalist",
    question: "Which federal departments committed the most to Alberta-based recipients in FY2024?",
    portal: "No",
    portal_why: "The federal portal has no recipient-province filter and no totals.",
    calls: [
      [
        "award_totals",
        {
          group_by: "ministry",
          filters: [FED, fy(2024), { field: "recipient_province", op: "eq", value: "AB" }],
          limit: 10,
        },
      ],
    ],
  },
  {
    id: "B2",
    persona: "Journalist",
    question:
      "Which Calgary organizations received the most federal agreement value across FY2023 and FY2024?",
    portal: "Partial",
    portal_why: "A keyword search for Calgary finds rows but cannot group or total them.",
    calls: [
      [
        "award_totals",
        {
          group_by: "recipient",
          filters: [
            FED,
            { field: "fiscal_year", op: "between", value: [2023, 2024] },
            { field: "recipient_city", op: "contains", value: "Calgary" },
          ],
          limit: 10,
        },
      ],
    ],
  },
  {
    id: "B3",
    persona: "Journalist",
    question:
      "Show the amendment history of the largest federal agreement with an Alberta recipient since FY2020.",
    portal: "Partial",
    portal_why: "Sort by value works, but there is no province filter to narrow to Alberta.",
    calls: [
      [
        "list_awards",
        {
          filters: [
            FED,
            { field: "recipient_province", op: "eq", value: "AB" },
            { field: "fiscal_year", op: "gte", value: 2020 },
            { field: "recipient_is_placeholder", op: "eq", value: false },
          ],
          sort: ["-value"],
          fields: [
            "id",
            "reference",
            "recipient",
            "ministry",
            "program",
            "value",
            "start_date",
            "amendment_number",
          ],
          limit: 1,
        },
      ],
      ["get_award", { id: "$largest" }],
    ],
  },
  {
    id: "B4",
    persona: "Journalist",
    question:
      "How did Alberta's lottery-funded grant payments change around the Lottery Fund's dissolution in December 2019?",
    portal: "Partial",
    portal_why: "The lottery column can be filtered, but nothing is totalled by year.",
    calls: [
      [
        "award_totals",
        {
          group_by: "fiscal_year",
          filters: [AB, { field: "lottery_fund", op: "eq", value: true }],
          limit: 20,
        },
      ],
    ],
  },
  // --- Sector researcher ---------------------------------------------------------------------
  {
    id: "C1",
    persona: "Sector researcher",
    question:
      "Which First Nations received funding from both governments across FY2023 and FY2024?",
    portal: "No",
    portal_why: "Cross-government matching is not possible in either portal.",
    calls: [
      [
        "shared_recipients",
        { fiscal_year_from: 2023, fiscal_year_to: 2024, search: "FIRST NATION", limit: 15 },
      ],
    ],
  },
  {
    id: "C2",
    persona: "Sector researcher",
    question: "How have Alberta's child care grant payments changed year over year since FY2019?",
    portal: "No",
    portal_why: "Program filter works, but there are no yearly totals.",
    calls: [
      [
        "award_totals",
        {
          group_by: "fiscal_year",
          filters: [
            AB,
            { field: "program", op: "contains", value: "CHILD CARE" },
            { field: "fiscal_year", op: "gte", value: 2019 },
          ],
          limit: 20,
        },
      ],
    ],
  },
  {
    id: "C3",
    persona: "Sector researcher",
    question:
      "For federal agreements with Alberta not-for-profits, how does the split between grants and contributions change by year?",
    portal: "Partial",
    portal_why: "Agreement type is a facet; recipient type and province are not.",
    calls: [
      [
        "query",
        {
          model: "award",
          filters: [
            FED,
            { field: "recipient_province", op: "eq", value: "AB" },
            { field: "recipient_type", op: "eq", value: "N" },
            { field: "fiscal_year", op: "between", value: [2019, 2025] },
          ],
          group_by: ["fiscal_year", "agreement_type"],
          aggregations: [
            { func: "sum", field: "value", alias: "committed" },
            { func: "count", field: "id", alias: "agreements" },
          ],
          order_by: ["fiscal_year", "agreement_type"],
          limit: 50,
        },
      ],
    ],
  },
  {
    id: "C4",
    persona: "Sector researcher",
    question:
      "Which recipients got Community Facility Enhancement Program payments of $250,000 or more in FY2024?",
    portal: "Yes",
    portal_why: "Program and amount column filters can produce this list, ten rows per page.",
    calls: [
      ["list_programs", { organization_id: null, search: "CFEP", limit: 20 }],
      [
        "list_awards",
        {
          filters: [
            AB,
            fy(2024),
            { field: "program", op: "contains", value: "CFEP" },
            { field: "value", op: "gte", value: 250000 },
          ],
          sort: ["-value"],
          fields: ["recipient", "program", "value", "start_date"],
          limit: 25,
        },
      ],
    ],
  },
];

class MissingContext extends Error {}

/** Fill "$name" placeholders from earlier results (e.g. an id found by a lookup call). */
function resolve(args: Args, context: Record<string, unknown>): Args {
  const resolved: Args = {};
  for (const [key, raw] of Object.entries(args)) {
    let value = raw;
    if (typeof value === "string" && value.startsWith("$")) {
      const name = value.slice(1);
      if (!(name in context)) throw new MissingContext(name);
      value = context[name];
    }
    if (value !== null && value !== undefined) resolved[key] = value;
  }
  return resolved;
}

type Row = Record<string, unknown>;

function remember(questionId: string, tool: string, data: Row, context: Record<string, unknown>) {
  const rows = (data.data as Row[] | undefined) ?? [];
  if (questionId === "A4" && tool === "list_ministries") {
    const health = rows.find(
      (m) => m.name === "Health" && m.organization === "Government of Alberta",
    );
    if (health) context.Health = health.id;
  }
  if (questionId === "B3" && tool === "list_awards" && rows.length > 0) {
    context.largest = rows[0]?.id;
  }
}

async function main() {
  const key = process.env.MCP_API_KEY;
  if (!key) throw new Error("Set MCP_API_KEY (the server's static bearer key).");
  const client = new Client({ name: "question-bank", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(URL_), {
      requestInit: { headers: { Authorization: `Bearer ${key}` } },
    }),
  );
  const results: unknown[] = [];
  try {
    for (const question of QUESTIONS) {
      const context: Record<string, unknown> = {};
      const calls: Row[] = [];
      const started = performance.now();
      for (const [tool, rawArgs] of question.calls) {
        let args: Args;
        try {
          args = resolve(rawArgs, context);
        } catch (error) {
          if (!(error instanceof MissingContext)) throw error;
          calls.push({ tool, skipped: `no earlier result for '${error.message}'` });
          break;
        }
        const t0 = performance.now();
        const result = (await client.callTool({ name: tool, arguments: args })) as CallToolResult;
        const seconds = Math.round(performance.now() - t0) / 1000;
        const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
        const data = result.isError ? { error: text } : (JSON.parse(text) as Row);
        if (!result.isError) remember(question.id, tool, data, context);
        calls.push({ tool, args, seconds, error: Boolean(result.isError), result: data });
      }
      const total = Math.round(performance.now() - started) / 1000;
      const flags = `${calls.some((c) => c.error) ? " ERROR" : ""}${calls.some((c) => "skipped" in c) ? " SKIPPED" : ""}`;
      console.log(`${question.id}: ${calls.length} call(s), ${total.toFixed(2)}s${flags}`);
      const { calls: _calls, ...meta } = question;
      results.push({ ...meta, seconds: total, calls });
    }
  } finally {
    await client.close();
  }
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(results, null, 2));
  console.log(`wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
