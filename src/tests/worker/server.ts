/** A tiny HTTP server for the worker tests: serves files by path, with ETags and 304s. */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface TestServer {
  url: string;
  files: Map<string, Buffer>;
  requests: { path: string; ifNoneMatch?: string }[];
  /** Answer with a shorter body than Content-Length says. */
  truncate: boolean;
  close: () => Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  const state: Omit<TestServer, "url" | "close"> = {
    files: new Map(),
    requests: [],
    truncate: false,
  };
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    const ifNoneMatch = req.headers["if-none-match"];
    state.requests.push({
      path,
      ifNoneMatch: typeof ifNoneMatch === "string" ? ifNoneMatch : undefined,
    });
    const body = state.files.get(path);
    if (!body) {
      res.writeHead(404).end("not found");
      return;
    }
    const etag = `"${createHash("sha1").update(body).digest("hex")}"`;
    if (ifNoneMatch === etag) {
      res.writeHead(304).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/csv", "content-length": String(body.length), etag });
    if (state.truncate) {
      res.write(body.subarray(0, Math.floor(body.length / 2)));
      res.destroy();
      return;
    }
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const result = state as TestServer;
  result.url = `http://127.0.0.1:${port}`;
  result.close = () => new Promise((resolve) => server.close(() => resolve()));
  return result;
}
