import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import { clientIp } from "./rate-limit";

const request = (forwardedFor?: string) =>
  new Request("http://localhost/api/mcp-oauth/register", {
    headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
  });

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("clientIp", () => {
  it("takes the address the load balancer added, whatever the client put first", () => {
    vi.stubEnv("TRUSTED_PROXIES", "10.55.0.0/16");
    resetEnvCache();
    expect(clientIp(request("203.0.113.9"))).toBe("203.0.113.9");
    // A client that sends its own X-Forwarded-For can't choose its bucket
    expect(clientIp(request("1.2.3.4, 203.0.113.9"))).toBe("203.0.113.9");
    expect(clientIp(request("5.6.7.8, 203.0.113.9"))).toBe("203.0.113.9");
    // Hops through the trusted proxies are skipped
    expect(clientIp(request("1.2.3.4, 203.0.113.9, 10.55.1.20"))).toBe("203.0.113.9");
  });

  it("falls back to one shared bucket when no address can be trusted", () => {
    vi.stubEnv("TRUSTED_PROXIES", "");
    resetEnvCache();
    expect(clientIp(request())).toBe("unknown");
    expect(clientIp(request("1.2.3.4, 203.0.113.9"))).toBe("unknown");
  });
});
