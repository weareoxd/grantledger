/** Tool calls run under a statement timeout: the database is shared with other apps. */
import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { defaultDeps } from "@/lib/mcp/queries";
import { runTool } from "@/lib/mcp/result";

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("a tool call's queries", () => {
  it("are cancelled after MCP_STATEMENT_TIMEOUT_MS, with a reason the client can act on", async () => {
    vi.stubEnv("MCP_STATEMENT_TIMEOUT_MS", "100");
    resetEnvCache();
    const slow = runTool("slow", async () => {
      await defaultDeps.query(sql`SELECT pg_sleep(2)`);
      return { done: true };
    });
    const started = Date.now();
    const result = await slow({});
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("The query took too long");
  });

  it("run normally within it", async () => {
    const quick = runTool("quick", async () => ({
      rows: await defaultDeps.query(sql`SELECT 1 AS one`),
    }));
    const result = await quick({});
    expect(result.isError).toBeFalsy();
  });
});
