import { ApiError } from "./errors";

/**
 * An API URL on this origin: `path` (`/api/organization`, no trailing slash) with `params` as its
 * query string. Absolute in the browser, where Node-style fetches (the tests') need one.
 */
export function apiUrl(path: string, params?: URLSearchParams): string {
  const query = params?.toString();
  const relative = query ? `${path}?${query}` : path;
  return typeof window === "undefined" ? relative : new URL(relative, window.location.href).href;
}

/**
 * GET a JSON endpoint of the web API, with the session cookie. Throws an `ApiError` for a non-2xx
 * response, carrying its body: `{detail}`, or `{field: [messages]}` for rejected parameters.
 */
export async function getJson<T>(
  path: string,
  params?: URLSearchParams,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(apiUrl(path, params), {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
    signal,
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response.status, body);
  return body as T;
}
