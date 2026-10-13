/**
 * Versioned, in-process result cache.
 *
 * Every key embeds the data version (src/lib/grants/version.ts): an import or an admin edit
 * bumps it, so stale entries become unreachable at once and age out of the LRU. One cache per
 * process, cached on globalThis so dev reloads keep it.
 */
import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";
import { getEnv } from "@/lib/env";
import { getDataVersion } from "@/lib/grants/version";

const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Bytes of heap per character of an entry's JSON, roughly: strings are UTF-16 and every object,
 * array and number costs more than its text. Errs high, so the cache stays within CACHE_MAX_MB.
 */
const HEAP_BYTES_PER_JSON_CHAR = 4;

type CacheGlobal = {
  __grantsCache?: LRUCache<string, { value: unknown }>;
  __grantsInFlight?: Map<string, Promise<unknown>>;
};
const store = globalThis as CacheGlobal;

function cache() {
  if (!store.__grantsCache) {
    store.__grantsCache = new LRUCache<string, { value: unknown }>({
      // Bounded by size, not count: a page of awards is far bigger than a total
      maxSize: getEnv().CACHE_MAX_MB * 1024 * 1024,
      sizeCalculation: (entry) =>
        Math.max(1, (JSON.stringify(entry.value)?.length ?? 1) * HEAP_BYTES_PER_JSON_CHAR),
      ttl: DAY_MS,
    });
  }
  return store.__grantsCache;
}

/** Computations under way, so concurrent misses for one key share a single query. */
function inFlight() {
  store.__grantsInFlight ??= new Map();
  return store.__grantsInFlight;
}

export function digest(identity: string) {
  return createHash("sha1").update(identity).digest("hex");
}

export async function cacheKey(kind: string, identity: string, version?: string) {
  return `gl:${version ?? (await getDataVersion())}:${kind}:${digest(identity)}`;
}

/**
 * The cached value for (kind, identity) under the current data version, computing and storing
 * it on a miss. `identity` is anything that tells the inputs apart (it is hashed).
 */
export async function cached<T>(
  kind: string,
  identity: string,
  compute: () => Promise<T>,
  options: { ttlMs?: number } = {},
): Promise<T> {
  const key = await cacheKey(kind, identity);
  const hit = cache().get(key);
  if (hit) return hit.value as T;
  const pending = inFlight().get(key);
  if (pending) return pending as Promise<T>;
  const computing = compute()
    .then((value) => {
      cache().set(key, { value }, options.ttlMs ? { ttl: options.ttlMs } : undefined);
      return value;
    })
    .finally(() => inFlight().delete(key));
  inFlight().set(key, computing);
  return computing;
}

/** Empty the cache (tests). */
export function clearCache() {
  cache().clear();
  inFlight().clear();
}
