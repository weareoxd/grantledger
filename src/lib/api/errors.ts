/** A non-2xx API response */
export class ApiError extends Error {
  readonly status: number;
  /** Parsed JSON body, or the raw text when it isn't JSON */
  readonly body: unknown;

  constructor(status: number, body: unknown) {
    super(describe(status, body));
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }

  /**
   * DRF validation errors keyed by field, e.g. a rejected list filter:
   * `{"recipient": ["Unsupported matchMode 'x'."]}` (or a message on its own,
   * not in a list). Empty for other errors; `detail` is the message.
   */
  get fieldErrors(): Record<string, string[]> {
    if (this.status !== 400 || !isRecord(this.body)) return {};
    const errors: Record<string, string[]> = {};
    for (const [field, messages] of Object.entries(this.body)) {
      if (field === "detail") continue;
      if (Array.isArray(messages)) errors[field] = messages.map(String);
      else if (typeof messages === "string") errors[field] = [messages];
    }
    return errors;
  }
}

export function isApiError(error: unknown, status?: number): error is ApiError {
  return error instanceof ApiError && (status === undefined || error.status === status);
}

function describe(status: number, body: unknown) {
  if (status === 401) return "Your session has ended. Sign in again.";
  if (isRecord(body) && typeof body.detail === "string") return body.detail;
  if (status === 0 || status >= 500) {
    return "The server couldn't complete the request. Try again in a moment.";
  }
  return `Request failed (${status})`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
