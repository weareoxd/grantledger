type Level = "debug" | "info" | "warn" | "error";

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = process.env.LOG_LEVEL as Level | undefined;
  return ORDER[configured ?? "info"] ?? ORDER.info;
}

// Extra fields worth keeping from driver errors (pg: code, detail, constraint, …).
const ERROR_FIELDS = ["code", "detail", "constraint", "table", "column", "hint"] as const;

function serializeError(value: unknown, depth = 0): unknown {
  if (!(value instanceof Error)) return value;
  const out: Record<string, unknown> = {
    name: value.name,
    message: value.message,
    stack: value.stack,
  };
  for (const field of ERROR_FIELDS) {
    const extra = (value as unknown as Record<string, unknown>)[field];
    if (extra !== undefined) out[field] = extra;
  }
  // Drizzle wraps the pg error ("Failed query: …") and keeps the real reason in `cause`.
  if (value.cause !== undefined && depth < 3) out.cause = serializeError(value.cause, depth + 1);
  return out;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < threshold()) return;
  const entry: Record<string, unknown> = { time: new Date().toISOString(), level, msg };
  if (fields) {
    for (const [key, value] of Object.entries(fields)) entry[key] = serializeError(value);
  }
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

/** JSON-lines logger (one object per line) so container logs stay greppable. */
export function createLogger(scope: string) {
  return {
    debug: (msg: string, fields?: Record<string, unknown>) =>
      write("debug", msg, { scope, ...fields }),
    info: (msg: string, fields?: Record<string, unknown>) =>
      write("info", msg, { scope, ...fields }),
    warn: (msg: string, fields?: Record<string, unknown>) =>
      write("warn", msg, { scope, ...fields }),
    error: (msg: string, fields?: Record<string, unknown>) =>
      write("error", msg, { scope, ...fields }),
  };
}

export type Logger = ReturnType<typeof createLogger>;
