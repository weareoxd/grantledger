/**
 * Streaming CSV export of any list: same filters, sort and scope as its pages.
 *
 * The UI posts the columns it shows, with their headers, to the list's own URL (its query string
 * carries the filters and sort): `{"columns": [{"id": ..., "header": ...}]}`. Rows stream from a
 * server-side cursor inside a transaction, so memory stays flat and the first rows leave before
 * the last are read. Files open cleanly in Excel: a UTF-8 byte-order mark, and at most
 * API_EXPORT_MAX_ROWS data rows (Excel's sheet limit is 1,048,576 rows, header included).
 */
import { PgDialect } from "drizzle-orm/pg-core";
import type { PoolClient } from "pg";
import QueryStream from "pg-query-stream";
import { getPool } from "@/lib/db";
import type { RecordKind } from "@/lib/domain";
import { getEnv } from "@/lib/env";
import { fiscalYearLabel } from "@/lib/grants/fiscal";
import { createLogger } from "@/lib/server/logger";
import { applicable, type Column, type ListSpec } from "./columns";
import { ApiError } from "./errors";
import { exportQuery, type Scope, serialize } from "./lists";
import type { ListParams } from "./params";

const log = createLogger("export");
const CHUNK_BYTES = 64 * 1024;
const MAX_HEADER = 200;
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];
const dialect = new PgDialect();

/**
 * The body's columns as `[Column, header][]`: each one of this list's columns for the
 * organization's record kind, at most once, with a header to print.
 */
export function exportColumns(
  spec: ListSpec,
  kind: RecordKind | null,
  data: unknown,
): [Column, string][] {
  const columns = new Map(applicable(spec, kind).map((col) => [col.key, col]));
  const given =
    data && typeof data === "object" && !Array.isArray(data)
      ? (data as { columns?: unknown }).columns
      : undefined;
  const valid =
    Array.isArray(given) &&
    given.length > 0 &&
    given.length <= columns.size &&
    given.every(
      (column) =>
        column &&
        typeof column === "object" &&
        typeof (column as { id?: unknown }).id === "string" &&
        typeof (column as { header?: unknown }).header === "string" &&
        Array.from((column as { header: string }).header).length <= MAX_HEADER,
    );
  if (!valid) {
    throw new ApiError(400, { columns: ["Give each column's id and header, as text."] });
  }
  const list = given as { id: string; header: string }[];
  const ids = list.map((column) => column.id);
  const unknown = ids.filter((key) => !columns.has(key));
  if (unknown.length || new Set(ids).size !== ids.length) {
    const shown = unknown.length ? unknown : ids;
    throw new ApiError(400, {
      columns: [`Unknown or repeated columns: [${shown.map((id) => `'${id}'`).join(", ")}].`],
    });
  }
  return list.map((column) => [columns.get(column.id) as Column, column.header]);
}

/** Python csv.writer's QUOTE_MINIMAL with its "\r\n" line terminator. */
function csvLine(values: string[]) {
  return `${values
    .map((v) => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v))
    .join(",")}\r\n`;
}

export function cell(col: Column, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  switch (col.type) {
    case "bool":
      return value ? "Yes" : "No";
    case "fiscal_year":
      return fiscalYearLabel(Number(value));
    case "code":
      return col.options[String(value)] ?? String(value);
    case "money":
      return Number(value).toFixed(2);
    case "int":
    case "date":
      return String(value);
  }
  const text = String(value);
  // Spreadsheet formula injection: neutralise cells a spreadsheet would evaluate.
  return FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix)) ? `'${text}` : text;
}

function filename(spec: ListSpec, scope: Scope, params: ListParams, truncated: boolean) {
  const org = scope.organization ? scope.organization.key : "all";
  const year = params.fiscal_year ? `fy${params.fiscal_year}` : "all-years";
  const suffix = truncated ? "-first-rows" : "";
  return `grantledger-${org}-${spec.kind.replaceAll("_", "-")}-${year}${suffix}.csv`;
}

/** The response for an export of `count` rows (the list's, already worked out). */
export function exportCsv(
  spec: ListSpec,
  scope: Scope,
  params: ListParams,
  columns: [Column, string][],
  count: number,
  signal?: AbortSignal,
): Response {
  const env = getEnv();
  const cap = env.API_EXPORT_MAX_ROWS;
  const truncated = count > cap;
  const query = dialect.sqlToQuery(exportQuery(spec, scope, params));
  const encoder = new TextEncoder();

  let client: PoolClient | null = null;
  let stream: QueryStream | null = null;
  let rows: AsyncIterator<Record<string, unknown>> | null = null;
  let released = false;
  let written = 0;
  // A byte order mark, so Excel reads accented names as UTF-8
  let header: string | null = `\ufeff${csvLine(columns.map(([, name]) => name))}`;
  const onAbort = () => void cleanup();

  async function cleanup() {
    if (released) return;
    released = true;
    signal?.removeEventListener("abort", onAbort);
    stream?.destroy();
    if (client) {
      // A connection whose rollback fails is closed, not handed back to the pool
      let broken = false;
      await client.query("ROLLBACK").catch(() => {
        broken = true;
      });
      client.release(broken);
    }
  }

  // Pull-based: a chunk is read from the database only when the client is ready for one, so a
  // slow download holds about one chunk in memory, not the whole export.
  const body = new ReadableStream<Uint8Array>({
    async start() {
      // A client already gone gets nothing; one that leaves while this connects is noticed after
      // each wait, so a connection taken meanwhile is handed back rather than kept
      if (signal?.aborted) {
        released = true;
        return;
      }
      signal?.addEventListener("abort", onAbort);
      try {
        const connected = await getPool().connect();
        if (released) {
          connected.release();
          return;
        }
        client = connected;
        // In a transaction the rows stream from a cursor; outside one, Postgres would build the
        // whole result first
        await client.query("BEGIN");
        // cleanup() ran meanwhile: it rolled back and released the connection
        if (released) return;
        stream = client.query(
          new QueryStream(query.sql, query.params as unknown[], { batchSize: 5000 }),
        );
        rows = (stream as AsyncIterable<Record<string, unknown>>)[Symbol.asyncIterator]();
      } catch (error) {
        log.error("export failed", { error, kind: spec.kind });
        await cleanup();
        throw error;
      }
    },
    async pull(controller) {
      if (released) {
        // The client left (or never came): end the stream rather than leave it open
        controller.close();
        return;
      }
      try {
        let buffer = header ?? "";
        header = null;
        while (!released && buffer.length < CHUNK_BYTES) {
          const next = written < cap && rows ? await rows.next() : { done: true as const };
          if (next.done) {
            if (buffer) controller.enqueue(encoder.encode(buffer));
            controller.close();
            await cleanup();
            return;
          }
          const row = await serialize(spec, next.value, { fullText: true });
          buffer += csvLine(columns.map(([col]) => cell(col, row[col.key])));
          written += 1;
        }
        if (!released) controller.enqueue(encoder.encode(buffer));
      } catch (error) {
        if (!released) {
          log.error("export failed", { error, kind: spec.kind });
          controller.error(error);
        }
        await cleanup();
      }
    },
    async cancel() {
      await cleanup();
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename(spec, scope, params, truncated)}"`,
      "Cache-Control": "no-store",
      // Straight through a proxy rather than into its temp files
      "X-Accel-Buffering": "no",
      "X-Total-Count": String(count),
      "X-Export-Rows": String(Math.min(count, cap)),
      "X-Export-Truncated": truncated ? "true" : "false",
    },
  });
}
