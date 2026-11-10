import { createLogger } from "@/lib/server/logger";

const log = createLogger("db");

/** An error whose message is meant for the user (validation/business rules). */
export class UserError extends Error {}

/**
 * Turns Postgres errors into messages a form can show. Anything unexpected is logged and
 * replaced by a generic message, so SQL text and parameters never reach the browser.
 */
export function friendlyDbError(error: unknown, messages: Record<string, string> = {}): Error {
  if (error instanceof UserError) return error;
  const pg = (error as { cause?: unknown })?.cause ?? error;
  const code = (pg as { code?: string })?.code;
  const constraint = (pg as { constraint?: string })?.constraint ?? "";
  if (code === "23505") {
    return new UserError(messages[constraint] ?? "A matching record already exists");
  }
  if (code === "23503") {
    return new UserError(messages[constraint] ?? "The referenced record does not exist");
  }
  if (code === "23514") return new UserError(messages[constraint] ?? "A value is out of range");
  // Class 22: data exceptions (out-of-range numbers or dates, invalid formats).
  if (code?.startsWith("22")) return new UserError("A value is out of range");
  log.error("database error", { error });
  return new Error("Could not save the change. Please try again.");
}
