/**
 * The read-only grants MCP server, shared by both transports: Streamable HTTP at /api/mcp
 * (src/app/api/mcp/route.ts, stateless, one server per request) and stdio (scripts/mcp-stdio.ts).
 */
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { defaultDeps, type McpDeps } from "@/lib/mcp/queries";
import { describeSchema } from "@/lib/mcp/schema";
import { createLogger } from "@/lib/server/logger";
import { registerAggregateTools } from "./tools/aggregates";
import { registerFlexibleTools } from "./tools/flexible";
import { registerRecordTools } from "./tools/records";

const log = createLogger("mcp");

export const MCP_SERVER_NAME = "grantledger";
export const MCP_SERVER_VERSION = "1.0.0";
export const SCHEMA_URI = "schema://grants";

export const INSTRUCTIONS = `Read-only access to Canadian public grant disclosures: Government of Canada grants and
contributions (agreements) and Government of Alberta grant payments. Organizations,
ministries, programs, recipients, awards and fiscal years. User accounts are not available.

Start with \`describe_schema\` (or the \`schema://grants\` resource): its \`conventions\` section
explains how to read the numbers. Use the curated tools (\`list_*\`, \`get_*\`, \`award_totals\`,
\`recipient_funding\`, \`ministry_funding\`, \`shared_recipients\`) for common questions and the
\`query\` tool for ad-hoc filtering, grouping and aggregation.

Key rules: fiscal years run April-March (FY2024 = Apr 1 2024 - Mar 31 2025). Federal rows
are agreements (committed totals), Alberta rows are cash payments; report them separately.
Award tools count only the current amendment of each federal agreement unless
current_only=false. Placeholder recipients (individuals with names withheld, recipients not
disclosed) count in totals but are not real recipients. Values are CAD. Cite the Open
Government Licence attribution for each government whose data you use.
`;

/** The server with its 17 tools and the schema resource. */
export function createMcpServer(deps: McpDeps = defaultDeps): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { instructions: INSTRUCTIONS },
  );
  registerRecordTools(server, deps);
  registerAggregateTools(server, deps);
  registerFlexibleTools(server, deps);
  server.registerResource(
    "schema_resource",
    SCHEMA_URI,
    {
      description: "Machine-readable description of the models, fields, conventions and operators.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(describeSchema(), null, 2),
        },
      ],
    }),
  );
  return server;
}

/**
 * Handles one Streamable HTTP POST statelessly: a fresh server and transport per request, JSON
 * responses (no SSE), nothing kept between requests. `authInfo` reaches the tools (audit log).
 */
export async function handleMcpRequest(
  request: Request,
  authInfo?: AuthInfo,
  deps: McpDeps = defaultDeps,
): Promise<Response> {
  const server = createMcpServer(deps);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  try {
    await server.connect(transport);
    // In JSON mode the response is complete once handleRequest resolves.
    return await transport.handleRequest(request, { authInfo });
  } catch (error) {
    log.error("mcp request failed", { error });
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32603, message: "Internal error" }, id: null },
      { status: 500 },
    );
  } finally {
    await server.close().catch(() => {});
  }
}
