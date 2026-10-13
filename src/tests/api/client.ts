/**
 * Calls the API's route handlers by path, as Next's router would, for the *.db.test.ts files.
 * The session check is the tests' own (vi.mock of @/lib/auth/session in each file).
 */
import { listHandler, notFoundHandler, summaryHandler } from "@/lib/rest/handlers";

type Handlers = Record<
  string,
  (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>
>;

const O = "/api/organization/(?<organization_id>[^/]+)";
const M = `${O}/ministry/(?<ministry_id>[^/]+)`;
const P = `${M}/program/(?<program_id>[^/]+)`;
const R = `${O}/recipient/(?<recipient_id>[^/]+)`;

const summary = summaryHandler() as unknown as Handlers;
const lists = new Map<string, Handlers>();
const list = (kind: string) => {
  if (!lists.has(kind)) lists.set(kind, listHandler(kind) as unknown as Handlers);
  return lists.get(kind) as Handlers;
};

const ROUTES: [RegExp, () => Handlers][] = [
  ["/api/organization", () => list("organizations")],
  [`${O}/summary`, () => summary],
  [`${O}/ministry`, () => list("org_ministries")],
  [`${M}/summary`, () => summary],
  [`${M}/recipient`, () => list("ministry_recipients")],
  [`${M}/recipient/(?<recipient_id>[^/]+)/award`, () => list("awards")],
  [`${M}/award`, () => list("awards")],
  [`${M}/program`, () => list("ministry_programs")],
  [`${P}/summary`, () => summary],
  [`${P}/recipient`, () => list("program_recipients")],
  [`${P}/award`, () => list("awards")],
  [`${P}/recipient/(?<recipient_id>[^/]+)/award`, () => list("awards")],
  [`${O}/recipient`, () => list("org_recipients")],
  [`${R}/summary`, () => summary],
  [`${R}/ministry`, () => list("recipient_ministries")],
  [`${R}/award`, () => list("awards")],
  [`${O}/award`, () => list("awards")],
].map(([pattern, handlers]) => [new RegExp(`^${pattern}/?$`), handlers as () => Handlers]);

export async function call(
  method: string,
  path: string,
  init: { body?: string; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<Response> {
  const url = new URL(path, "http://localhost:3000");
  const request = new Request(url, {
    method,
    body: init.body,
    headers: init.headers,
    signal: init.signal,
  });
  for (const [pattern, handlers] of ROUTES) {
    const match = pattern.exec(url.pathname);
    if (!match) continue;
    const handler = handlers()[method];
    if (!handler) return new Response(null, { status: 405 });
    return handler(request, { params: Promise.resolve({ ...match.groups }) });
  }
  return notFoundHandler(request);
}

/** The bracketed filter params for one column's [matchMode, value] conditions. */
export function conditions(field: string, pairs: [string, string][], operator?: string) {
  const params: Record<string, string> = {};
  pairs.forEach(([mode, value], i) => {
    params[`${field}[${i}][value]`] = value;
    params[`${field}[${i}][matchMode]`] = mode;
  });
  if (operator) params[`${field}[operator]`] = operator;
  return params;
}

export function withQuery(path: string, params: Record<string, string | number> = {}) {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  return query ? `${path}?${query}` : path;
}

export async function getJson(
  path: string,
  params: Record<string, string | number> = {},
  status = 200,
): Promise<Record<string, unknown> & { data?: Record<string, unknown>[] }> {
  const response = await call("GET", withQuery(path, params));
  const text = await response.text();
  if (response.status !== status) {
    throw new Error(
      `GET ${withQuery(path, params)}: expected ${status}, got ${response.status}: ${text.slice(0, 500)}`,
    );
  }
  return JSON.parse(text);
}
