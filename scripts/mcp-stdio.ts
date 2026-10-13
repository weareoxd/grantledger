// Run the read-only grants MCP server over stdio, for local / developer clients (trusted: no
// auth). Point a client at it with e.g. `npm run --silent mcp-stdio`.
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { closeDb } from "@/lib/db";
import { loadDotEnv } from "@/lib/env";
import { createMcpServer } from "@/lib/mcp/server";

// stdout carries the JSON-RPC stream, so log lines (the audit log included) go to stderr.
console.log = console.error;
console.info = console.error;

loadDotEnv();

const server = createMcpServer();
const transport = new StdioServerTransport();

async function shutdown() {
  await server.close().catch(() => {});
  await closeDb().catch(() => {});
  process.exit(0);
}

transport.onclose = () => void shutdown();
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());

await server.connect(transport);
