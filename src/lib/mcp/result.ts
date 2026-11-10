/**
 * Tool results, errors and the audit trail.
 *
 * Every tool call writes one structured line on the `mcp_audit` logger (who, which tool, which
 * arguments, how long, how many rows or which error), which is enough to replay any answer.
 */
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { getEnv } from "@/lib/env";
import { isStatementTimeout, withStatementTimeout } from "@/lib/rest/db";
import { createLogger } from "@/lib/server/logger";
import { QueryError } from "@/lib/sql/conditions";

const audit = createLogger("mcp_audit");
const log = createLogger("mcp");

/** An expected failure whose message is safe to show the client (bad input, nothing found). */
export class ToolError extends Error {
  override name = "ToolError";
}

/** Django's DoesNotExist wording, which the Python server returned for an unknown id. */
export function notFound(model: string): ToolError {
  return new ToolError(`${model} matching query does not exist.`);
}

export type ToolData = Record<string, unknown>;

/** The result as JSON text (as the Python server sent it) plus the same object as structuredContent. */
export function ok(data: ToolData): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
  };
}

export function fail(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export interface Caller {
  subject: unknown;
  client_id: string;
}

/** Identity of the authenticated caller, when the transport carries one (not over stdio). */
export function callerOf(authInfo: AuthInfo | undefined): Caller | null {
  if (!authInfo) return null;
  return { subject: authInfo.extra?.subject ?? null, client_id: authInfo.clientId };
}

function rowCount(result: ToolData): number | null {
  const data = result.data;
  return Array.isArray(data) ? data.length : null;
}

/** The Postgres error behind a (possibly Drizzle-wrapped) driver error. */
function pgError(error: unknown): { code: string; message: string } | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof candidate.code === "string" && /^[0-9A-Z]{5}$/.test(candidate.code)) {
      return { code: candidate.code, message: String(candidate.message ?? "") };
    }
    current = candidate.cause;
  }
  return undefined;
}

/**
 * The client-safe version of an error: ToolError and QueryError as they are, and Postgres data
 * errors (SQLSTATE class 22, e.g. a filter value that is not a valid date or number) with the
 * database's reason. Anything else is not safe to show.
 */
export function toToolError(error: unknown): ToolError | undefined {
  if (error instanceof ToolError) return error;
  if (error instanceof QueryError) return new ToolError(error.message);
  const pg = pgError(error);
  if (pg?.code.startsWith("22")) return new ToolError(`Invalid value in the query: ${pg.message}`);
  if (isStatementTimeout(error)) {
    return new ToolError(
      "The query took too long. Narrow the filters, add a fiscal year, or ask for fewer rows.",
    );
  }
  return undefined;
}

/**
 * Wraps a tool handler with the audit line and the error mapping. Client-safe errors go back as
 * "Error executing tool <name>: <reason>" (the Python server's wording); anything else is
 * logged and reported generically so stack traces and SQL never leave the server.
 */
export function runTool<A>(
  name: string,
  handler: (args: A) => Promise<ToolData>,
  { database = true }: { database?: boolean } = {},
) {
  return async (args: A, extra?: { authInfo?: AuthInfo }): Promise<CallToolResult> => {
    const started = performance.now();
    const entry: Record<string, unknown> = {
      tool: name,
      args,
      caller: callerOf(extra?.authInfo),
    };
    const elapsed = () => Math.round(performance.now() - started);
    try {
      // One transaction per call, with a statement timeout: the database is shared
      const result = database
        ? await withStatementTimeout(() => handler(args), getEnv().MCP_STATEMENT_TIMEOUT_MS)
        : await handler(args);
      audit.info("tool call", { ...entry, ms: elapsed(), rows: rowCount(result) });
      return ok(result);
    } catch (error) {
      const safe = toToolError(error);
      const reason = safe?.message ?? (error instanceof Error ? error.message : String(error));
      audit.info("tool call", { ...entry, ms: elapsed(), error: reason.slice(0, 500) });
      if (safe) return fail(`Error executing tool ${name}: ${safe.message}`);
      log.error("tool call failed", { tool: name, error });
      return fail(`Error executing tool ${name}: internal error (see the server log)`);
    }
  };
}
