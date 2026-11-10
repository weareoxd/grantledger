// Minimal MCP client for smoke tests.
//
//   npm run mcp-call -- list-tools
//   npm run mcp-call -- call award_totals '{"group_by": "organization"}'
//   npm run mcp-call -- --url https://grants.example.com/api/mcp list-tools
//
// Connects to --url (or MCP_URL, default http://localhost:3000/api/mcp) with MCP_API_KEY as the
// bearer token.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { loadDotEnv } from "@/lib/env";

loadDotEnv();

const USAGE = `Usage:
  mcp-call.ts [--url <url>] list-tools
  mcp-call.ts [--url <url>] call <tool> ['<json arguments>']`;

function parseArgs(argv: string[]) {
  let url = process.env.MCP_URL || "http://localhost:3000/api/mcp";
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === "--url") url = argv[++i] ?? url;
    else if (arg.startsWith("--url=")) url = arg.slice("--url=".length);
    else rest.push(arg);
  }
  return { url, command: rest[0] ?? "list-tools", rest: rest.slice(1) };
}

async function main() {
  const { url, command, rest } = parseArgs(process.argv.slice(2));
  const key = process.env.MCP_API_KEY;
  if (!key) throw new Error("Set MCP_API_KEY (the server's static bearer key).");
  if (command !== "list-tools" && command !== "call") throw new Error(USAGE);

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${key}` } },
  });
  const client = new Client({ name: "mcp-call", version: "1.0.0" });
  await client.connect(transport);
  try {
    if (command === "list-tools") {
      const info = client.getServerVersion();
      const { tools } = await client.listTools();
      console.log(`server: ${info?.name} ${info?.version}`);
      for (const tool of tools) {
        console.log(`- ${tool.name}: ${(tool.description ?? "").trim().split("\n")[0]}`);
      }
      return;
    }
    const [name, json] = rest;
    if (!name) throw new Error(USAGE);
    const args = json ? (JSON.parse(json) as Record<string, unknown>) : {};
    const started = performance.now();
    const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
    const seconds = ((performance.now() - started) / 1000).toFixed(2);
    const text = result.content.map((c) => (c.type === "text" ? c.text : "")).join("");
    console.error(`[${result.isError ? "ERROR" : "ok"}] ${name} in ${seconds}s`);
    try {
      console.log(JSON.stringify(JSON.parse(text), null, 2));
    } catch {
      console.log(text);
    }
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
