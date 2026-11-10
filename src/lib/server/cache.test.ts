import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { cached, clearCache } from "./cache";

vi.mock("@/lib/grants/version", () => ({ getDataVersion: async () => "v1" }));

/** A fresh cache, built with the current settings. */
function freshCache() {
  (globalThis as { __grantsCache?: unknown }).__grantsCache = undefined;
  clearCache();
}

beforeEach(freshCache);
afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
  freshCache();
});

describe("cached", () => {
  it("runs one computation for requests that miss together", async () => {
    let release: (value: number) => void = () => {};
    const compute = vi.fn(() => new Promise<number>((resolve) => (release = resolve)));
    const both = Promise.all([cached("sum", "a", compute), cached("sum", "a", compute)]);
    await vi.waitFor(() => expect(compute).toHaveBeenCalled());
    release(42);
    expect(await both).toEqual([42, 42]);
    expect(compute).toHaveBeenCalledTimes(1);
    // Then a hit
    expect(await cached("sum", "a", compute)).toBe(42);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("forgets a failed computation, so the next request tries again", async () => {
    const failing = vi.fn(async () => {
      throw new Error("timeout");
    });
    await expect(cached("sum", "b", failing)).rejects.toThrow("timeout");
    expect(await cached("sum", "b", async () => 7)).toBe(7);
  });

  it("keeps within CACHE_MAX_MB, counting an entry's size generously", async () => {
    vi.stubEnv("CACHE_MAX_MB", "1");
    resetEnvCache();
    freshCache();
    // 300,000 characters of JSON: about 1.2 MB by the cache's estimate, over the 1 MB budget
    const big = vi.fn(async () => "x".repeat(300_000));
    await cached("page", "big", big);
    await cached("page", "big", big);
    expect(big).toHaveBeenCalledTimes(2);
    const small = vi.fn(async () => "x".repeat(1_000));
    await cached("page", "small", small);
    await cached("page", "small", small);
    expect(small).toHaveBeenCalledTimes(1);
  });
});
