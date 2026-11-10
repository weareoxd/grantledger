import type { NextConfig } from "next";

// Fixed when `next build` runs, which has none of the runtime settings (they arrive with the
// container when it starts), so nothing here may depend on them. HSTS is always sent: browsers ignore it over
// plain http, so local development is unaffected.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  // Server-only packages loaded from node_modules at runtime instead of being bundled.
  // iconv-lite loads its encoding tables with dynamic requires.
  serverExternalPackages: ["pg", "pg-boss", "pg-query-stream", "iconv-lite"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
