import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { runTool, type ToolData } from "@/lib/mcp/result";

/** Registers a read-only tool with typed arguments, the audit line and the shared error handling. */
export function register<S extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  description: string,
  inputSchema: S,
  handler: (args: z.output<z.ZodObject<S>>) => Promise<ToolData>,
  options: { database?: boolean } = {},
) {
  server.registerTool(
    name,
    {
      description,
      inputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    runTool(name, handler, options) as never,
  );
}

// Argument shapes shared by the tools (Python: Optional[...] = None accepts null).
export const args = {
  optionalInt: () => z.number().int().nullish(),
  optionalString: () => z.string().nullish(),
  optionalBool: () => z.boolean().nullish(),
  filters: () =>
    z
      .array(z.record(z.string(), z.unknown()))
      .nullish()
      .describe('Structured filters: [{"field", "op", "value"}] (see describe_schema)'),
  combine: () => z.string().default("and").describe('"and" (default) or "or" across the filters'),
  fields: () => z.array(z.string()).nullish().describe("Return only these keys"),
  sort: () =>
    z.array(z.string()).nullish().describe("Field names to sort by; prefix with - for descending"),
  limit: (fallback: number) => z.number().int().default(fallback),
  offset: () => z.number().int().default(0),
};
