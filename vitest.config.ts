import { defineConfig } from "vitest/config";

// Tests that touch the database run against DATABASE_URL_TEST (a database of its own: each
// test file empties it), one file at a time.
try {
  process.loadEnvFile(".env");
} catch {
  // Rely on the process environment (CI).
}
const testDatabase = process.env.DATABASE_URL_TEST;

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          exclude: ["src/**/*.db.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "db",
          environment: "node",
          include: ["src/**/*.db.test.ts"],
          globalSetup: ["src/tests/db/global-setup.ts"],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
          env: {
            ...(testDatabase ? { DATABASE_URL: testDatabase } : {}),
            NODE_ENV: "test",
            TZ: "America/Edmonton",
            BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
            BETTER_AUTH_URL: "http://localhost:3000",
            ADMIN_USERNAME: "",
            ADMIN_PASSWORD: "",
            MCP_API_KEY: "test-service-key",
            MCP_JWT_SECRET: "test-jwt-secret-test-jwt-secret-0123456789",
            MCP_MAX_ROWS: "500",
            MCP_PUBLIC_URL: "",
          },
        },
      },
      {
        extends: true,
        test: {
          name: "ui",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["src/test/setup.ts"],
          testTimeout: 15_000,
          css: false,
          restoreMocks: true,
          unstubGlobals: true,
          unstubEnvs: true,
        },
      },
    ],
  },
});
