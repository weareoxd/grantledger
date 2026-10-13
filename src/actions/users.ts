"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/session";
import { createUser, deleteUser, findUserById, setRole } from "@/lib/auth/users";
import { createLogger } from "@/lib/server/logger";
import { createUserInput, setRoleInput } from "@/lib/validation/admin";
import { type ActionResult, fail, ok } from "./result";

const log = createLogger("users");

async function target(userId: string) {
  const found = await findUserById(userId);
  if (!found) throw new Error("That user no longer exists");
  return found;
}

/** Add someone by their Google email, with a role, ahead of their first sign-in (admins only). */
export async function addUser(input: unknown): Promise<ActionResult> {
  const admin = await requireAdmin("/admin/users");
  try {
    const { email, role } = createUserInput.parse(input);
    await createUser(email, role);
    log.info("user added", { email, role, by: admin.email });
    revalidatePath("/admin/users");
    return ok();
  } catch (error) {
    return fail(error);
  }
}

export async function changeRole(input: unknown): Promise<ActionResult> {
  const admin = await requireAdmin("/admin/users");
  try {
    const { userId, role } = setRoleInput.parse(input);
    if (userId === admin.id && role !== "admin") {
      return { ok: false, error: "You can't take away your own admin role." };
    }
    const found = await target(userId);
    await setRole(found.id, role);
    log.info("role changed", { email: found.email, role, by: admin.email });
    revalidatePath("/admin/users");
    return ok();
  } catch (error) {
    return fail(error);
  }
}

export async function removeUser(input: unknown): Promise<ActionResult> {
  const admin = await requireAdmin("/admin/users");
  try {
    const { id } = z.object({ id: z.string().min(1) }).parse(input);
    if (id === admin.id) return { ok: false, error: "You can't delete your own account." };
    const found = await target(id);
    await deleteUser(found.id);
    log.info("user removed", { email: found.email, by: admin.email });
    revalidatePath("/admin/users");
    return ok();
  } catch (error) {
    return fail(error);
  }
}
