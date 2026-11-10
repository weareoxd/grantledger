/**
 * API errors in the shapes the web UI reads (Django REST framework's): `{"detail": "..."}`, or
 * `{"<field>": ["<message>"]}` for a request whose parameters are invalid.
 */
export type ErrorBody = { detail: string } | Record<string, string[]>;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: ErrorBody,
    readonly headers: Record<string, string> = {},
  ) {
    super("detail" in body ? String(body.detail) : JSON.stringify(body));
    this.name = "ApiError";
  }

  response() {
    return Response.json(this.body, { status: this.status, headers: this.headers });
  }
}

export function invalid(field: string, message: string) {
  return new ApiError(400, { [field]: [message] });
}

export function notFound(detail = "Not found.") {
  return new ApiError(404, { detail });
}
