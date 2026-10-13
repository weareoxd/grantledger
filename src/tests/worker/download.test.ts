import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { download } from "@/worker/download";
import { startServer, type TestServer } from "./server";

let server: TestServer;
let dir: string;

beforeEach(async () => {
  server = await startServer();
  dir = mkdtempSync(join(tmpdir(), "download-"));
});

afterEach(async () => {
  await server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("download", () => {
  it("streams a file to disk with its validators, hash and progress", async () => {
    server.files.set("/grants.csv", Buffer.from("a,b\n1,2\n"));
    const progress: number[] = [];
    const result = await download(`${server.url}/grants.csv`, join(dir, "sub", "grants.csv"), {
      onProgress: (bytes) => progress.push(bytes),
    });
    expect(result.notModified).toBe(false);
    if (result.notModified) return;
    expect(result.bytes).toBe(8);
    expect(result.etag).toMatch(/^".+"$/);
    expect(result.sha256).toHaveLength(64);
    expect(readFileSync(join(dir, "sub", "grants.csv"), "utf8")).toBe("a,b\n1,2\n");
    expect(progress.at(-1)).toBe(8);
  });

  it("asks only for a changed file, unless forced", async () => {
    server.files.set("/grants.csv", Buffer.from("x\n"));
    const first = await download(`${server.url}/grants.csv`, join(dir, "g.csv"));
    if (first.notModified) throw new Error("expected a download");
    const previous = { etag: first.etag, lastModified: first.lastModified };
    expect(await download(`${server.url}/grants.csv`, join(dir, "g.csv"), { previous })).toEqual({
      notModified: true,
    });
    expect(server.requests.at(-1)?.ifNoneMatch).toBe(first.etag);
    const forced = await download(`${server.url}/grants.csv`, join(dir, "g.csv"), {
      previous,
      force: true,
    });
    expect(forced.notModified).toBe(false);
    expect(server.requests.at(-1)?.ifNoneMatch).toBeUndefined();
  });

  it("fails on an error status and keeps no partial file", async () => {
    await expect(download(`${server.url}/missing.csv`, join(dir, "m.csv"))).rejects.toThrow(
      /HTTP 404/,
    );
    server.files.set("/big.csv", Buffer.alloc(100_000, 97));
    server.truncate = true;
    await expect(download(`${server.url}/big.csv`, join(dir, "big.csv"))).rejects.toThrow();
    expect(() => readFileSync(join(dir, "big.csv"))).toThrow();
    expect(() => readFileSync(join(dir, "big.csv.part"))).toThrow();
  });
});
