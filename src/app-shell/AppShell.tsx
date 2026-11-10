"use client";

import { usePathname } from "next/navigation";
import { type ReactNode, useLayoutEffect, useRef } from "react";

import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { useSignInOnExpiry } from "@/features/auth/useSignInOnExpiry";
import type { UserRole } from "@/lib/domain";

import { AppSidebar } from "./AppSidebar";
import { Breadcrumbs } from "./Breadcrumbs";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "./UserMenu";

/** Whoever is signed in, as the shell shows them */
export type ShellUser = { email: string; name: string; image: string | null; role: UserRole };

export function AppShell({
  user,
  defaultSidebarOpen = true,
  headerExtras,
  children,
}: {
  user: ShellUser;
  /** Whether the sidebar starts open (it remembers being collapsed in a cookie) */
  defaultSidebarOpen?: boolean;
  /** More controls for the header, before the theme toggle (the worker's status, say) */
  headerExtras?: ReactNode;
  children: ReactNode;
}) {
  useSignInOnExpiry();

  // Another page starts at the top. (Changing the page, sort or filters of a
  // list doesn't)
  const pathname = usePathname();
  const content = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs for each new path
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [pathname]);

  return (
    <SidebarProvider defaultOpen={defaultSidebarOpen}>
      <AppSidebar user={user} />
      <SidebarInset className="h-svh min-w-0 overflow-hidden md:h-[calc(100svh-1rem)] md:border md:border-sidebar-border">
        <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/80">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mr-1 data-vertical:h-4 data-vertical:self-center"
          />
          <Breadcrumbs />
          <div className="ml-auto flex items-center gap-1">
            {headerExtras}
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>
        <div
          ref={content}
          className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-auto p-4 md:p-6"
        >
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
