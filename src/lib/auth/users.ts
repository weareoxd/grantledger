/**
 * Server-side user management: seeding the admin on startup, the Users tab's actions and the
 * `scripts/users.ts` CLI. Anyone's first Google sign-in makes them a user; adding someone by email
 * first gives them a role, and their first Google sign-in joins that account (src/lib/auth/auth.ts).
 */
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/lib/db";
import { user } from "@/lib/db/auth-schema";
import type { UserRole } from "@/lib/domain";
import { getAdminSeed } from "@/lib/env";
import { createLogger } from "@/lib/server/logger";
import { getAuth } from "./auth";

const log = createLogger("users");

export const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter the person's Google email address"));

export async function findUserByEmail(email: string) {
  const [row] = await getDb()
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(sql`lower(${user.email})`, email.toLowerCase()))
    .limit(1);
  return row ?? null;
}

export async function findUserById(id: string) {
  const [row] = await getDb()
    .select({ id: user.id, email: user.email, role: user.role })
    .from(user)
    .where(eq(user.id, id))
    .limit(1);
  return row ?? null;
}

/**
 * Adds someone by email, ahead of their first sign-in. Until they first sign
 * in with Google, their name is their email.
 *
 * The address counts as verified: an admin vouched for it. Better Auth links a Google sign-in to
 * an existing account only when both sides are verified, so Google must still have verified it.
 */
export async function createUser(address: string, role: UserRole = "user") {
  const email = emailField.parse(address);
  if (await findUserByEmail(email)) throw new Error(`${email} already has an account.`);
  await getAuth().api.createUser({
    body: { email, name: email, role, data: { emailVerified: true } },
  });
}

export async function setRole(id: string, role: UserRole) {
  await getDb().update(user).set({ role }).where(eq(user.id, id));
}

/** Removes a user and their sessions; signing in with Google again makes them a user anew. */
export async function deleteUser(id: string) {
  const context = await getAuth().$context;
  await context.internalAdapter.deleteUserSessions(id);
  await context.internalAdapter.deleteUser(id);
}

/** Creates the admin account for ADMIN_EMAIL when it doesn't exist yet (or makes it an admin). */
export async function ensureAdminUser() {
  const seed = getAdminSeed();
  if (!seed) {
    log.debug("ADMIN_EMAIL not set; no admin to create");
    return { created: false };
  }
  const existing = await findUserByEmail(seed.email);
  if (existing) {
    if (existing.role !== "admin") await setRole(existing.id, "admin");
    // Vouched for, as createUser does (an account made before it did)
    await getDb().update(user).set({ emailVerified: true }).where(eq(user.id, existing.id));
    return { created: false };
  }
  await createUser(seed.email, "admin");
  log.info("created admin user", { email: seed.email });
  return { created: true };
}

export type UserRow = {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string | null;
  createdAt: Date;
  /** Whether they've signed in with Google yet. */
  joined: boolean;
  sessions: number;
};

/** Everyone with an account, for the admin's Users tab. */
export async function listUsers(): Promise<UserRow[]> {
  const rows = await getDb().execute<UserRow>(sql`
    -- Better Auth writes UTC into columns without a time zone
    SELECT u.id, u.email, u.name, u.image, u.role, u.created_at AT TIME ZONE 'UTC' AS "createdAt",
           EXISTS (SELECT 1 FROM "account" a WHERE a.user_id = u.id AND a.provider_id = 'google') AS joined,
           (SELECT COUNT(*)::int FROM "session" s WHERE s.user_id = u.id AND s.expires_at > now()) AS sessions
      FROM "user" u ORDER BY u.email`);
  return rows.rows;
}
