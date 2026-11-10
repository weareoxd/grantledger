// Used only by the Better Auth CLI (`npm run auth:generate`) to emit src/lib/db/auth-schema.ts.
// Keep the schema-affecting options (plugins, user fields) in sync with src/lib/auth/auth.ts.
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { betterAuth } from "better-auth";
import { admin } from "better-auth/plugins";
import { drizzle } from "drizzle-orm/node-postgres";

export const auth = betterAuth({
  database: drizzleAdapter(drizzle.mock(), { provider: "pg" }),
  socialProviders: { google: { clientId: "", clientSecret: "" } },
  plugins: [admin()],
});
