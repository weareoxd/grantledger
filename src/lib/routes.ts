import Link from "next/link";
import { type ComponentProps, createElement } from "react";
import { stringifySearch } from "@/features/table/state/search";

/** The app's pages, as path templates: `$name` is a path param */
export const APP_PATHS = [
  "/",
  "/organization/$organization_id",
  "/organization/$organization_id/award",
  "/organization/$organization_id/ministry",
  "/organization/$organization_id/recipient",
  "/organization/$organization_id/ministry/$ministry_id",
  "/organization/$organization_id/ministry/$ministry_id/award",
  "/organization/$organization_id/ministry/$ministry_id/program",
  "/organization/$organization_id/ministry/$ministry_id/recipient",
  "/organization/$organization_id/ministry/$ministry_id/recipient/$recipient_id",
  "/organization/$organization_id/ministry/$ministry_id/program/$program_id",
  "/organization/$organization_id/ministry/$ministry_id/program/$program_id/award",
  "/organization/$organization_id/ministry/$ministry_id/program/$program_id/recipient",
  "/organization/$organization_id/ministry/$ministry_id/program/$program_id/recipient/$recipient_id",
  "/organization/$organization_id/recipient/$recipient_id",
  "/organization/$organization_id/recipient/$recipient_id/awards",
  "/organization/$organization_id/recipient/$recipient_id/ministries",
  "/sign-in",
  "/worker",
  "/admin",
] as const;

export type AppPath = (typeof APP_PATHS)[number];

/** Where a link leads: a page, its path params, and its table state (written as the lists' URLs) */
export type HrefTarget = {
  to: AppPath;
  params?: Record<string, string>;
  search?: object;
};

/** The URL of a page: `to` with its `$params` filled in, then `search` as a query string */
export function href({ to, params = {}, search }: HrefTarget): string {
  const path = to.replace(/\$([a-z_]+)/g, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`No ${name} for a link to ${to}`);
    return encodeURIComponent(value);
  });
  return search ? path + stringifySearch(search as Record<string, unknown>) : path;
}

type AppLinkProps = HrefTarget & Omit<ComponentProps<typeof Link>, "href">;

/** A link to one of the app's pages, by path template and params (like `href`) */
export function AppLink({ to, params, search, ...props }: AppLinkProps) {
  return createElement(Link, { ...props, href: href({ to, params, search }) });
}
