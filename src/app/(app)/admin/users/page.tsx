import type { Metadata } from "next";
import { UsersAdmin } from "@/components/admin/users";
import { requireAdmin } from "@/lib/auth/session";
import { listUsers } from "@/lib/auth/users";

export const metadata: Metadata = { title: "Users · Admin" };

export default async function UsersAdminPage() {
  const admin = await requireAdmin("/admin/users");
  const users = await listUsers();
  return (
    <UsersAdmin
      currentUserId={admin.id}
      users={users.map((user) => ({
        ...user,
        createdAt: new Date(user.createdAt).toISOString(),
      }))}
    />
  );
}
