/**
 * Route handlers for the read-only web API (signed-in users only).
 *
 * Every list goes through one handler: check the session (401), resolve the scope (404 if it
 * doesn't exist or doesn't nest), validate params (400 naming the field), then return a cached
 * JSON page (GET) or a streaming CSV of every row (POST, see export.ts). Database work runs with
 * a statement timeout (db.ts).
 */
import { userOrUnauthorized } from "@/lib/auth/session";
import { createLogger } from "@/lib/server/logger";
import { LIST_SPECS, type ListSpec } from "./columns";
import { limited } from "./db";
import { ApiError } from "./errors";
import { exportColumns, exportCsv } from "./export";
import { page, resolveScope, type ScopeIds, scopeKind, totals } from "./lists";
import { parseParams } from "./params";
import { summaryFor } from "./summary";

const log = createLogger("api");

type RouteContext = { params?: Promise<Record<string, string | string[]> | undefined> };

const ID_PARAMS = ["organization_id", "ministry_id", "program_id", "recipient_id"] as const;

/** The path's ids; a 404 like any unknown path when one isn't a number (Django's <int:...>). */
async function scopeIds(request: Request, context: RouteContext): Promise<ScopeIds> {
  // Routes without dynamic segments get no params
  const params = (await context?.params) ?? {};
  const ids: ScopeIds = {};
  for (const name of ID_PARAMS) {
    const value = params[name];
    if (value === undefined) continue;
    if (
      typeof value !== "string" ||
      !/^[0-9]+$/.test(value) ||
      !Number.isSafeInteger(Number(value))
    ) {
      throw new ApiError(404, { detail: `No API resource at ${new URL(request.url).pathname}.` });
    }
    ids[name] = Number(value);
  }
  return ids;
}

async function respond(work: () => Promise<Response>): Promise<Response> {
  const user = await userOrUnauthorized();
  if (user instanceof Response) return user;
  try {
    return await work();
  } catch (error) {
    if (error instanceof ApiError) return error.response();
    log.error("request failed", { error });
    return Response.json({ detail: "A server error occurred." }, { status: 500 });
  }
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  const type = request.headers.get("content-type") ?? "";
  if (!type.includes("json")) {
    throw new ApiError(415, { detail: `Unsupported media type "${type}" in request.` });
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ApiError(400, {
      detail: `JSON parse error - ${error instanceof Error ? error.message : "invalid JSON"}`,
    });
  }
}

/** A list's rows, a page at a time (GET), or every one as CSV (POST, with the columns in the body). */
export function listHandler(kind: string) {
  const found = LIST_SPECS[kind];
  if (!found) throw new Error(`Unknown list ${kind}`);
  const spec: ListSpec = found;

  async function GET(request: Request, context: RouteContext) {
    return respond(async () => {
      const scope = await resolveScope(await scopeIds(request, context));
      const params = parseParams(new URL(request.url).searchParams, spec, scopeKind(scope));
      return Response.json(await limited(() => page(spec, scope, params)));
    });
  }

  async function POST(request: Request, context: RouteContext) {
    return respond(async () => {
      const scope = await resolveScope(await scopeIds(request, context));
      const kindOf = scopeKind(scope);
      const params = parseParams(new URL(request.url).searchParams, spec, kindOf, {
        paging: false,
      });
      const columns = exportColumns(spec, kindOf, await readJson(request));
      const { count } = await limited(() => totals(spec, scope, params));
      return exportCsv(spec, scope, params, columns, count, request.signal);
    });
  }

  const other = methodNotAllowed(["GET", "POST", "HEAD", "OPTIONS"]);
  return { GET, POST, PUT: other, PATCH: other, DELETE: other };
}

/** An organization's, ministry's, program's or recipient's overview figures. */
export function summaryHandler() {
  async function GET(request: Request, context: RouteContext) {
    return respond(async () => {
      const scope = await resolveScope(await scopeIds(request, context));
      return Response.json(await summaryFor(scope));
    });
  }
  const other = methodNotAllowed(["GET", "HEAD", "OPTIONS"]);
  return { GET, POST: other, PUT: other, PATCH: other, DELETE: other };
}

/** A method a list doesn't take, after the session check (as DRF answers). */
export function methodNotAllowed(allowed: string[]) {
  return async (request: Request) =>
    respond(async () =>
      Response.json(
        { detail: `Method "${request.method}" not allowed.` },
        { status: 405, headers: { Allow: allowed.join(", ") } },
      ),
    );
}

/** JSON 404s for paths under /api/ that nothing serves. */
export function notFoundHandler(request: Request) {
  return Response.json(
    { detail: `No API resource at ${new URL(request.url).pathname}.` },
    { status: 404 },
  );
}
