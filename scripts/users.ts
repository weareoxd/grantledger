// Manage accounts and roles from the command line. Anyone can sign in with Google as a user;
// adding someone here (or in Admin > Users) gives them a role before they first sign in.
//
//   npm run users -- add <email> [admin|user]
//   npm run users -- set-role <email> <admin|user>
//   npm run users -- remove <email>
//   npm run users -- list
import { createUser, deleteUser, findUserByEmail, listUsers, setRole } from "@/lib/auth/users";
import { closeDb } from "@/lib/db";
import { runMigrations } from "@/lib/db/migrate";
import { USER_ROLES, type UserRole } from "@/lib/domain";
import { loadDotEnv } from "@/lib/env";

loadDotEnv();

const [command, email, roleArg] = process.argv.slice(2);
const usage =
  "Usage: users.ts add <email> [admin|user] | set-role <email> <admin|user> | remove <email> | list";

function role(value: string | undefined, fallback?: UserRole): UserRole {
  const chosen = value ?? fallback;
  if (!chosen || !(USER_ROLES as readonly string[]).includes(chosen)) {
    throw new Error(`The role must be one of: ${USER_ROLES.join(", ")}.`);
  }
  return chosen as UserRole;
}

async function existing(address: string | undefined) {
  if (!address) throw new Error(usage);
  const found = await findUserByEmail(address);
  if (!found) throw new Error(`Nobody with ${address.toLowerCase()} has an account.`);
  return found;
}

try {
  if (!command) throw new Error(usage);
  await runMigrations();
  switch (command) {
    case "add": {
      if (!email) throw new Error(usage);
      const found = await findUserByEmail(email);
      if (found) {
        // Already there: just the role, when one was given
        if (roleArg) await setRole(found.id, role(roleArg));
        console.log(`${found.email} already has an account${roleArg ? `; now ${roleArg}` : ""}.`);
      } else {
        await createUser(email, role(roleArg, "user"));
        console.log(`Added ${email.toLowerCase()} as ${role(roleArg, "user")}.`);
      }
      break;
    }
    case "set-role": {
      const found = await existing(email);
      await setRole(found.id, role(roleArg));
      console.log(`${found.email} is now ${roleArg}.`);
      break;
    }
    case "remove": {
      const found = await existing(email);
      await deleteUser(found.id);
      console.log(`${found.email} removed and signed out.`);
      break;
    }
    case "list":
      for (const user of await listUsers()) {
        console.log(
          `${user.email}\t${user.role ?? "user"}\t${user.joined ? "signed in" : "not yet"}`,
        );
      }
      break;
    default:
      throw new Error(usage);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await closeDb();
}
