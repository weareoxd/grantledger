"use client";

import { useParams, usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";

import { useEntityName } from "@/features/lists/names";
import { useOrganization } from "@/features/lists/organizations";
import type { ScopeParams } from "@/features/lists/types";

/**
 * Which list the current page shows, from its route; or, for one
 * organization, ministry, program or recipient, its overview
 */
export type PageKind =
  | "organizations"
  | "awards"
  | "ministries"
  | "programs"
  | "recipients"
  | "organization"
  | "ministry"
  | "program"
  | "recipient"
  | "worker"
  | "admin"
  | "other";

/**
 * The organization, ministry, program and recipient the current page is
 * about, with their names once known, and the organization's kind of record
 */
export function useScope() {
  const params = useScopeParams();
  const organization = useOrganization(params.organization_id);
  const ministry = useEntityName("ministry", params.ministry_id);
  const program = useEntityName("program", params.program_id);
  const recipient = useEntityName("recipient", params.recipient_id);
  const pathname = usePathname();

  return {
    params,
    page: pageKind(pathname ?? "/"),
    kind: organization.kind,
    organization: organization.organization,
    names: {
      organization: organization.organization?.name,
      ministry,
      program,
      recipient,
    },
  };
}

/**
 * The current page's path params: the organization, ministry, program and recipient ids it has
 * (the same object while they stay the same)
 */
export function useScopeParams(): ScopeParams {
  const params = useParams<Record<string, string | string[]>>();
  const pick = (name: string) => {
    const value = params?.[name];
    return typeof value === "string" ? value : undefined;
  };
  const organization_id = pick("organization_id");
  const ministry_id = pick("ministry_id");
  const program_id = pick("program_id");
  const recipient_id = pick("recipient_id");
  return useMemo(() => {
    const scope: ScopeParams = {};
    if (organization_id) scope.organization_id = organization_id;
    if (ministry_id) scope.ministry_id = ministry_id;
    if (program_id) scope.program_id = program_id;
    if (recipient_id) scope.recipient_id = recipient_id;
    return scope;
  }, [organization_id, ministry_id, program_id, recipient_id]);
}

// Each page's path, its ids as `$`, and what it shows
const PAGE_KINDS: Record<string, PageKind> = {
  "/": "organizations",
  // The overviews
  "/organization/$": "organization",
  "/organization/$/ministry/$": "ministry",
  "/organization/$/ministry/$/program/$": "program",
  "/organization/$/recipient/$": "recipient",
  // The lists
  "/organization/$/award": "awards",
  "/organization/$/ministry": "ministries",
  "/organization/$/recipient": "recipients",
  "/organization/$/ministry/$/award": "awards",
  "/organization/$/ministry/$/program": "programs",
  "/organization/$/ministry/$/recipient": "recipients",
  // A ministry's or program's recipient shows that recipient's awards there
  "/organization/$/ministry/$/recipient/$": "awards",
  "/organization/$/ministry/$/program/$/award": "awards",
  "/organization/$/ministry/$/program/$/recipient": "recipients",
  "/organization/$/ministry/$/program/$/recipient/$": "awards",
  "/organization/$/recipient/$/awards": "awards",
  "/organization/$/recipient/$/ministries": "ministries",
};

/**
 * The page's kind, from its path (`/organization/12/ministry/3/program/4` is a program's
 * overview). Under /organization, every other segment is an id.
 */
export function pageKind(pathname: string): PageKind {
  const segments = pathname.split("/").filter(Boolean);
  // The worker's and the admin pages, whichever of them
  if (segments[0] === "worker" || segments[0] === "admin") return segments[0];
  if (segments.length > 0 && segments[0] !== "organization") return "other";
  const template = `/${segments.map((segment, index) => (index % 2 === 1 ? "$" : segment)).join("/")}`;
  return PAGE_KINDS[template] ?? "other";
}

/**
 * The browser tab's title: the page's (a list's, if it has one), then the
 * most specific thing it's about (the breadcrumbs show the rest)
 */
export function useDocumentTitle(pageTitle?: string) {
  const { params, names } = useScope();
  const scopeName =
    (params.recipient_id && names.recipient) ||
    (params.program_id && names.program) ||
    (params.ministry_id && names.ministry) ||
    (params.organization_id && names.organization) ||
    undefined;
  useEffect(() => {
    document.title = [pageTitle, scopeName, "GrantLedger"].filter(Boolean).join(" · ");
  }, [pageTitle, scopeName]);
}
