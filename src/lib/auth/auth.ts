/**
 * Better Auth for the web UI: sign-in with Google.
 *
 * Anyone with a Google account may sign in: their first sign-in makes them an account, as a
 * user, provided Google has verified their email. The admin named by ADMIN_EMAIL, and anyone an
 * admin adds or promotes (Admin > Users, or `make user`), keep the role they were given.
 * Roles come from the admin plugin: "admin" may edit data and run imports, "user" may read.
 */
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { getDb } from "@/lib/db";
import * as authSchema from "@/lib/db/auth-schema";
import { getAuthEnv, getEnv, trustedProxies } from "@/lib/env";

const DAY_SECONDS = 60 * 60 * 24;

/** Where a refused or failed sign-in lands (with ?error=...). */
export const SIGN_IN_ERROR_PATH = "/sign-in";

export function authOptions() {
  const { secret, baseURL, google } = getAuthEnv();
  return {
    appName: "GrantLedger",
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    database: drizzleAdapter(getDb(), { provider: "pg", schema: authSchema }),
    // Google only: no passwords
    emailAndPassword: { enabled: false },
    socialProviders: google
      ? {
          google: {
            clientId: google.clientId,
            clientSecret: google.clientSecret,
            prompt: "select_account" as const,
            // Names and pictures follow the Google account
            overrideUserInfoOnSignIn: true,
          },
        }
      : {},
    account: {
      // Someone an admin added by email joins that account on their first Google sign-in, but
      // only when Google says it has verified the email (Better Auth's default without trusted
      // providers), so nobody can claim an account with an address they don't own.
      accountLinking: { enabled: true, updateUserInfoOnLink: true },
    },
    onAPIError: { errorURL: SIGN_IN_ERROR_PATH },
    databaseHooks: {
      user: {
        create: {
          // A first Google sign-in makes an account (as a user) only for an email Google has
          // verified, by the redirect or by an ID token alike. Accounts admins add are created
          // verified (src/lib/auth/users.ts), and there is no other way to make one.
          before: async (user) => {
            if (!user.emailVerified) {
              throw new APIError("FORBIDDEN", {
                code: "unverified_email",
                message: "Google hasn't verified this account's email",
              });
            }
            return { data: user };
          },
        },
      },
    },
    session: {
      expiresIn: 7 * DAY_SECONDS,
      // A session in use is extended once a day
      updateAge: DAY_SECONDS,
      // Each list request reads the session; a signed cookie saves a query for five minutes
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },
    // On everywhere but the tests, which sign in many times a second
    rateLimit: {
      enabled: getEnv().NODE_ENV !== "test",
      customRules: { "/get-session": false as const },
    },
    advanced: {
      // Client IP for rate limiting. Forwarded chains are only walked through the configured
      // proxies; the app port itself must only be reachable via the proxy.
      ipAddress: {
        ipAddressHeaders: ["x-forwarded-for"],
        trustedProxies: trustedProxies(),
      },
    },
    telemetry: { enabled: false },
    plugins: [
      admin({ adminRoles: ["admin"], defaultRole: "user" }),
      // Must stay last so cookies set by auth.api calls in server actions reach the response.
      nextCookies(),
    ],
  } satisfies BetterAuthOptions;
}

function createAuth() {
  return betterAuth(authOptions());
}

export type Auth = ReturnType<typeof createAuth>;

const store = globalThis as { __grantsAuth?: Auth };

export function getAuth(): Auth {
  if (!store.__grantsAuth) store.__grantsAuth = createAuth();
  return store.__grantsAuth;
}

/** Whether Google sign-in is configured (the sign-in page says so when it isn't). */
export function googleConfigured() {
  return getAuthEnv().google !== null;
}
