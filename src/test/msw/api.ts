import { http } from "msw/http";

/**
 * MSW handler builders for API paths, e.g. `api.get("/api/organization", ...)`. The API is on the
 * page's own origin (jsdom's), as are sign-in and sign-out (`/api/auth/...`). The lists are read
 * (GET) and exported (POST).
 */
export const api = {
  get: (
    path: string,
    resolver: Parameters<typeof http.get>[1],
    options?: Parameters<typeof http.get>[2],
  ) => http.get(path, resolver, options),
  post: (path: string, resolver: Parameters<typeof http.post>[1]) => http.post(path, resolver),
};
