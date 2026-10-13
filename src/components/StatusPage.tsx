import type { ReactNode } from "react";

import { Logo } from "@/app-shell/Logo";

/**
 * A page outside the app shell (404, errors): the app's
 * name, a heading, and what to do next, centred on the page background
 */
export function StatusPage({
  title,
  description,
  children,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-sidebar p-6 text-center">
      <div className="flex items-center gap-2 font-medium text-sm">
        <Logo />
        GrantLedger
      </div>
      <div className="flex max-w-sm flex-col items-center gap-2">
        <h1 className="font-semibold text-xl tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground text-sm">{description}</p>}
        {children}
      </div>
      {actions && <div className="flex flex-wrap justify-center gap-2">{actions}</div>}
    </div>
  );
}
