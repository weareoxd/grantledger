import { getIPFromHeader } from "@better-auth/core/utils/ip";
import { trustedProxies } from "@/lib/env";

/**
 * A small in-memory sliding-window rate limiter, per process (cached on globalThis so dev
 * reloads keep it). Enough to blunt abuse of the public OAuth endpoints; it is not shared across
 * replicas.
 */

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  /** Seconds until another request would be allowed (0 when allowed). */
  retryAfterSeconds: number;
}

type LimiterGlobal = { __rateLimitHits?: Map<string, number[]> };
const store = globalThis as LimiterGlobal;

function hits(): Map<string, number[]> {
  store.__rateLimitHits ??= new Map();
  return store.__rateLimitHits;
}

const SWEEP_THRESHOLD = 10_000;

function sweep(now: number, windowMs: number) {
  for (const [key, times] of hits()) {
    if (times.length === 0 || (times[times.length - 1] as number) <= now - windowMs) {
      hits().delete(key);
    }
  }
}

/** Count one request for `key` under `rule`, refusing it once the window is full. */
export function checkRateLimit(
  key: string,
  rule: RateLimitRule,
  now = Date.now(),
): RateLimitResult {
  if (hits().size > SWEEP_THRESHOLD) sweep(now, rule.windowMs);
  const recent = (hits().get(key) ?? []).filter((time) => time > now - rule.windowMs);
  if (recent.length >= rule.max) {
    hits().set(key, recent);
    const oldest = recent[0] as number;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000)),
    };
  }
  recent.push(now);
  hits().set(key, recent);
  return { allowed: true, remaining: rule.max - recent.length, retryAfterSeconds: 0 };
}

/**
 * The client's IP from X-Forwarded-For, resolved as Better Auth's own limiter does: the leftmost
 * hops are whatever the client sent, so the chain is read from the right, past the proxies in
 * TRUSTED_PROXIES (the load balancer appends the real address). Without a trustworthy address,
 * "unknown": one shared bucket.
 */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return "unknown";
  return getIPFromHeader(forwarded, { trustedProxies: trustedProxies() }) ?? "unknown";
}

/** Forget every counter (tests). */
export function resetRateLimits() {
  hits().clear();
}
