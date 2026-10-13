/**
 * Downloads a source file to disk, streaming (the federal file is 2.3 GB), with a conditional
 * request so an unchanged file isn't fetched again, and a SHA-256 of what arrived so an
 * unchanged file without validators is still recognised.
 */
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

export interface DownloadState {
  etag: string | null;
  lastModified: string | null;
}

export type DownloadResult =
  | { notModified: true }
  | {
      notModified: false;
      bytes: number;
      sha256: string;
      etag: string | null;
      lastModified: string | null;
    };

export interface DownloadOptions {
  /** What the last successful import saw; sent as If-None-Match / If-Modified-Since. */
  previous?: DownloadState | null;
  force?: boolean;
  signal?: AbortSignal;
  onProgress?: (bytes: number, total: number | null) => void;
  fetchImpl?: typeof fetch;
}

export class DownloadError extends Error {}

export async function download(
  url: string,
  destination: string,
  options: DownloadOptions = {},
): Promise<DownloadResult> {
  const headers: Record<string, string> = {
    // The real length, for progress (and no surprise decompression of a 2 GB file)
    "Accept-Encoding": "identity",
    "User-Agent": "GrantLedger importer",
  };
  if (!options.force && options.previous) {
    if (options.previous.etag) headers["If-None-Match"] = options.previous.etag;
    if (options.previous.lastModified) headers["If-Modified-Since"] = options.previous.lastModified;
  }
  const response = await (options.fetchImpl ?? fetch)(url, {
    headers,
    redirect: "follow",
    signal: options.signal,
  });
  if (response.status === 304) return { notModified: true };
  if (!response.ok || !response.body) {
    throw new DownloadError(
      `Download failed: HTTP ${response.status} ${response.statusText} from ${url}`,
    );
  }
  const length = Number(response.headers.get("content-length"));
  const total = Number.isFinite(length) && length > 0 ? length : null;

  await mkdir(dirname(destination), { recursive: true });
  const partial = `${destination}.part`;
  const hash = createHash("sha256");
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      hash.update(chunk);
      options.onProgress?.(bytes, total);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream<Uint8Array>),
      counter,
      createWriteStream(partial),
      { signal: options.signal },
    );
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  if (total !== null && bytes !== total) {
    await rm(partial, { force: true });
    throw new DownloadError(`Download incomplete: ${bytes} of ${total} bytes from ${url}`);
  }
  await rename(partial, destination);
  options.onProgress?.(bytes, total ?? bytes);
  return {
    notModified: false,
    bytes,
    sha256: hash.digest("hex"),
    etag: response.headers.get("etag"),
    lastModified: response.headers.get("last-modified"),
  };
}
