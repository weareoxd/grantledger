/**
 * The worker's status and its page are for admins only: the real session checks, with the
 * signed-in user and the worker's data stubbed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runImportNow } from "@/actions/worker";
import WorkerPage from "@/app/(app)/worker/page";
import { GET } from "@/app/api/worker/route";
import { resetEnvCache } from "@/lib/env";
import { enqueueImport } from "@/lib/queue";

const session = vi.hoisted(() => ({ user: null as null | { role: string } }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/server/bootstrap", () => ({ bootstrapOnce: async () => {} }));
vi.mock("@/lib/auth/auth", () => ({
  getAuth: () => ({
    api: {
      getSession: async () =>
        session.user && {
          user: { id: "u1", email: "someone@example.org", name: "Someone", ...session.user },
        },
    },
  }),
}));
vi.mock("@/lib/queries/worker", () => ({
  getWorkerSnapshot: async () => ({ worker: null, queued: [] }),
  getSchedules: async () => [],
  listImportRuns: async () => [],
}));
vi.mock("@/lib/settings", () => ({ getSetting: async () => false }));
vi.mock("@/lib/queue", async (original) => ({
  ...(await original<typeof import("@/lib/queue")>()),
  enqueueImport: vi.fn(async () => "job-1"),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

/** Where a redirect() from a server component was sent. */
async function redirectedTo(render: () => Promise<unknown>) {
  try {
    await render();
  } catch (error) {
    const digest = (error as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw error;
  }
  return null;
}

beforeEach(() => {
  session.user = null;
});

describe("the worker's status", () => {
  it("is refused to anyone signed out, then to a user", async () => {
    expect((await GET()).status).toBe(401);
    session.user = { role: "user" };
    const response = await GET();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      detail: "You do not have permission to perform this action.",
    });
  });

  it("is given to an admin", async () => {
    session.user = { role: "admin" };
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ worker: null, queued: [] });
  });
});

describe("the Worker page", () => {
  it("sends a user back to the home page, and anyone signed out to sign in", async () => {
    session.user = { role: "user" };
    expect(await redirectedTo(() => WorkerPage())).toBe("/");
    session.user = null;
    expect(await redirectedTo(() => WorkerPage())).toBe("/sign-in?redirect=%2Fworker");
  });

  it("shows an admin the worker", async () => {
    session.user = { role: "admin" };
    expect(await redirectedTo(() => WorkerPage())).toBeNull();
  });
});

describe("Run now", () => {
  it("refuses a source that is turned off, queueing nothing", async () => {
    session.user = { role: "admin" };
    vi.stubEnv("FEDERAL_IMPORTS_ENABLED", "");
    resetEnvCache();
    expect(await runImportNow({ source: "federal" })).toEqual({
      ok: false,
      error: "Federal imports are turned off. Set FEDERAL_IMPORTS_ENABLED=true to run them.",
    });
    expect(enqueueImport).not.toHaveBeenCalled();

    vi.stubEnv("FEDERAL_IMPORTS_ENABLED", "true");
    resetEnvCache();
    expect(await runImportNow({ source: "federal" })).toEqual({
      ok: true,
      data: { jobId: "job-1" },
    });
    expect(enqueueImport).toHaveBeenCalledWith(expect.objectContaining({ source: "federal" }));
    vi.unstubAllEnvs();
    resetEnvCache();
  });
});
