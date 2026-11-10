"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LogOutIcon, UserIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { authClient } from "@/lib/auth/client";

import type { ShellUser } from "./AppShell";

/** Who is signed in, and signing out */
export function UserMenu({ user }: { user: ShellUser }) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const signOut = async () => {
    const { error } = await authClient.signOut().catch(() => ({ error: { status: 0 } }));
    if (error) {
      toast.error("Couldn't sign out. Try again in a moment.");
      return;
    }
    // Nothing kept for whoever signs in next
    queryClient.clear();
    router.replace("/sign-in");
    router.refresh();
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Account">
          {user.image ? (
            // Google's avatar; no referrer, as its image host asks
            <img
              src={user.image}
              alt=""
              referrerPolicy="no-referrer"
              className="size-6 rounded-full"
            />
          ) : (
            <UserIcon />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="flex flex-col gap-0.5 font-normal text-muted-foreground">
          <span className="font-medium text-foreground">{user.name}</span>
          {user.name !== user.email && <span className="text-xs">{user.email}</span>}
          <span className="text-xs">{user.role === "admin" ? "Administrator" : "User"}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut()}>
          <LogOutIcon />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
