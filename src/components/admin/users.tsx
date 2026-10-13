"use client";

import { useForm } from "@tanstack/react-form";
import { MoreHorizontalIcon, PlusIcon, ShieldIcon, Trash2Icon, UserIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { addUser, changeRole, removeUser } from "@/actions/users";
import { EmptyState } from "@/components/page-parts";
import { RelativeTime } from "@/components/relative-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FieldGroup } from "@/components/ui/field";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { USER_ROLES } from "@/lib/domain";
import { createUserInput } from "@/lib/validation/admin";
import { ConfirmDelete } from "./confirm-delete";
import { useSave } from "./crud";
import { FormFooter } from "./entities";
import { FormError, SelectField, TextField } from "./form-fields";

export interface UserListRow {
  id: string;
  email: string;
  name: string;
  image: string | null;
  role: string | null;
  createdAt: string;
  joined: boolean;
  sessions: number;
}

const ROLE_OPTIONS = USER_ROLES.map((role) => ({
  value: role,
  label: role === "admin" ? "Admin: edits data, runs imports" : "User: reads",
}));

function AddUserForm({ done }: { done: () => void }) {
  const { error, save } = useSave();
  const form = useForm({
    defaultValues: { email: "", role: "user" as (typeof USER_ROLES)[number] },
    validators: { onSubmit: createUserInput },
    onSubmit: ({ value }) =>
      save(() => addUser(value), `Added ${value.email.trim().toLowerCase()}`, done),
  });
  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void form.handleSubmit();
      }}
    >
      <FieldGroup>
        <form.Field name="email">
          {(field) => (
            <TextField
              field={field}
              label="Google email"
              autoFocus
              autoComplete="off"
              description="The address of the Google account they'll sign in with."
            />
          )}
        </form.Field>
        <form.Field name="role">
          {(field) => <SelectField field={field} label="Role" options={ROLE_OPTIONS} />}
        </form.Field>
        <FormError message={error} />
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => <FormFooter onCancel={done} submitting={submitting} />}
        </form.Subscribe>
      </FieldGroup>
    </form>
  );
}

function Avatar({ user }: { user: UserListRow }) {
  if (user.image) {
    return (
      <img
        src={user.image}
        alt=""
        referrerPolicy="no-referrer"
        className="size-7 shrink-0 rounded-full"
      />
    );
  }
  return (
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <UserIcon className="size-4" />
    </span>
  );
}

/** Everyone with an account: add people ahead of their first sign-in, change roles, remove. */
export function UsersAdmin({
  users,
  currentUserId,
}: {
  users: UserListRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<UserListRow>();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const setRole = async (user: UserListRow, role: (typeof USER_ROLES)[number]) => {
    const result = await changeRole({ userId: user.id, role });
    if (!result.ok) toast.error(result.error);
    else {
      toast.success(`${user.email} is now ${role === "admin" ? "an admin" : "a user"}`);
      router.refresh();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setAdding(true)}>
          <PlusIcon />
          Add user
        </Button>
      </div>
      {users.length === 0 ? (
        <EmptyState title="No users" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Person</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Added</TableHead>
                <TableHead className="text-right">Signed in on</TableHead>
                <TableHead className="w-10">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const self = user.id === currentUserId;
                return (
                  <TableRow key={user.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Avatar user={user} />
                        <div className="min-w-0">
                          <div className="truncate font-medium">
                            {user.joined ? user.name : user.email}
                            {self && (
                              <span className="ml-2 font-normal text-muted-foreground text-xs">
                                (you)
                              </span>
                            )}
                          </div>
                          <div className="truncate text-muted-foreground text-xs">
                            {user.joined ? user.email : "Hasn't signed in yet"}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {user.role === "admin" ? (
                        <Badge>Admin</Badge>
                      ) : (
                        <Badge variant="secondary">User</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <RelativeTime value={user.createdAt} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {user.sessions === 1 ? "1 device" : `${user.sessions} devices`}
                    </TableCell>
                    <TableCell className="w-10 text-right">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${user.email}`}
                          >
                            <MoreHorizontalIcon />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {user.role === "admin" ? (
                            <DropdownMenuItem
                              disabled={self}
                              onSelect={() => void setRole(user, "user")}
                            >
                              <UserIcon />
                              Make a user
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => void setRole(user, "admin")}>
                              <ShieldIcon />
                              Make an admin
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={self}
                            onSelect={() =>
                              setTimeout(() => {
                                setDeleting(user);
                                setDeleteOpen(true);
                              }, 0)
                            }
                          >
                            <Trash2Icon />
                            Remove
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add user</DialogTitle>
            <DialogDescription>
              Anyone can sign in with Google as a user. Add someone here to give them a role before
              they first sign in.
            </DialogDescription>
          </DialogHeader>
          {adding && <AddUserForm done={() => setAdding(false)} />}
        </DialogContent>
      </Dialog>
      <ConfirmDelete
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Remove ${deleting?.email ?? "user"}?`}
        description="They're signed out. If they sign in with Google again, they come back as a user."
        confirmLabel="Remove"
        busyLabel="Removing…"
        onConfirm={async () => {
          if (!deleting) return;
          const result = await removeUser({ id: deleting.id });
          if (!result.ok) toast.error(result.error);
          else {
            toast.success(`${deleting.email} removed`);
            router.refresh();
          }
        }}
      />
    </div>
  );
}
