/** Next.js calls this once per server process; startup failures are retried per request. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { bootstrapOnce } = await import("@/lib/server/bootstrap");
  await bootstrapOnce().catch(() => {
    // Logged by bootstrapOnce; /api/health reports 503 until a retry succeeds.
  });
}
