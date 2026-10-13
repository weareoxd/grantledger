"use client";

import { cn } from "cn";
import { Fragment } from "react";
import {
  Breadcrumb,
  BreadcrumbEllipsis,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import type { LinkTarget } from "@/features/lists/types";
import { kindText } from "@/lib/record-kind";
import { AppLink } from "@/lib/routes";

import { useScope } from "./scope";

type Crumb = { label: string | undefined; link?: LinkTarget };

/**
 * Where the page sits: organization, then ministry (and program) or
 * recipient, then the list. Each organization, ministry, program and
 * recipient links to its own page, and each list to itself. On one's own
 * page, the trail ends with it.
 */
export function Breadcrumbs() {
  const { params, page, names, kind } = useScope();
  const { organization_id, ministry_id, program_id, recipient_id } = params;
  const overview =
    page === "organization" || page === "ministry" || page === "program" || page === "recipient";
  const awards = kindText(
    { agreement: "Agreements", payment: "Payments", unknown: "Awards" },
    kind,
  );
  const ministries = kindText(
    { agreement: "Departments", payment: "Ministries", unknown: "Ministries" },
    kind,
  );
  const crumbs: Crumb[] =
    page === "worker"
      ? [{ label: "Worker", link: { to: "/worker", params: {} } }]
      : page === "admin"
        ? [{ label: "Admin", link: { to: "/admin", params: {} } }]
        : [{ label: "Organizations", link: { to: "/", params: {} } }];

  if (organization_id) {
    const inOrganization = { organization_id };
    crumbs.push({
      label: names.organization,
      link: { to: "/organization/$organization_id", params: inOrganization },
    });
    if (ministry_id) {
      const inMinistry = { organization_id, ministry_id };
      crumbs.push(
        {
          label: ministries,
          link: {
            to: "/organization/$organization_id/ministry",
            params: inOrganization,
          },
        },
        {
          label: names.ministry,
          link: {
            to: "/organization/$organization_id/ministry/$ministry_id",
            params: inMinistry,
          },
        },
      );
      if (program_id) {
        const inProgram = { ...inMinistry, program_id };
        crumbs.push(
          {
            label: "Programs",
            link: {
              to: "/organization/$organization_id/ministry/$ministry_id/program",
              params: inMinistry,
            },
          },
          {
            label: names.program,
            link: {
              to: "/organization/$organization_id/ministry/$ministry_id/program/$program_id",
              params: inProgram,
            },
          },
        );
        const recipients: Crumb = {
          label: "Recipients",
          link: {
            to: "/organization/$organization_id/ministry/$ministry_id/program/$program_id/recipient",
            params: inProgram,
          },
        };
        if (recipient_id) {
          crumbs.push(recipients, { label: names.recipient });
        } else if (overview) {
          // The program's own page: the trail ends with it
        } else if (page === "recipients") {
          crumbs.push(recipients);
        } else {
          crumbs.push({
            label: awards,
            link: {
              to: "/organization/$organization_id/ministry/$ministry_id/program/$program_id/award",
              params: inProgram,
            },
          });
        }
      } else {
        const recipients: Crumb = {
          label: "Recipients",
          link: {
            to: "/organization/$organization_id/ministry/$ministry_id/recipient",
            params: inMinistry,
          },
        };
        if (recipient_id) {
          crumbs.push(recipients, { label: names.recipient });
        } else if (overview) {
          // The ministry's own page: the trail ends with it
        } else if (page === "programs") {
          crumbs.push({
            label: "Programs",
            link: {
              to: "/organization/$organization_id/ministry/$ministry_id/program",
              params: inMinistry,
            },
          });
        } else if (page === "recipients") {
          crumbs.push(recipients);
        } else {
          crumbs.push({
            label: awards,
            link: {
              to: "/organization/$organization_id/ministry/$ministry_id/award",
              params: inMinistry,
            },
          });
        }
      }
    } else if (recipient_id) {
      const ofRecipient = { organization_id, recipient_id };
      crumbs.push(
        {
          label: "Recipients",
          link: {
            to: "/organization/$organization_id/recipient",
            params: inOrganization,
          },
        },
        {
          label: names.recipient,
          link: {
            to: "/organization/$organization_id/recipient/$recipient_id",
            params: ofRecipient,
          },
        },
      );
      if (!overview) {
        crumbs.push(
          page === "ministries"
            ? {
                label: ministries,
                link: {
                  to: "/organization/$organization_id/recipient/$recipient_id/ministries",
                  params: ofRecipient,
                },
              }
            : {
                label: awards,
                link: {
                  to: "/organization/$organization_id/recipient/$recipient_id/awards",
                  params: ofRecipient,
                },
              },
        );
      }
    } else if (!overview) {
      crumbs.push(
        page === "ministries"
          ? {
              label: ministries,
              link: {
                to: "/organization/$organization_id/ministry",
                params: inOrganization,
              },
            }
          : page === "recipients"
            ? {
                label: "Recipients",
                link: {
                  to: "/organization/$organization_id/recipient",
                  params: inOrganization,
                },
              }
            : {
                label: awards,
                link: {
                  to: "/organization/$organization_id/award",
                  params: inOrganization,
                },
              },
      );
    }
  }

  // The final crumb is the current page, not a link
  const current = crumbs.at(-1);
  if (current) delete current.link;

  // On small screens the levels between the first and the last two
  // collapse into a menu
  const collapsed = crumbs.length > 3 ? crumbs.slice(1, -2) : [];
  const isCollapsed = (index: number) =>
    collapsed.length > 0 && index > 0 && index < crumbs.length - 2;

  return (
    <Breadcrumb className="min-w-0">
      <BreadcrumbList className="flex-nowrap">
        {crumbs.map((crumb, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the trail's levels are positional
          <Fragment key={index}>
            {index === 1 && collapsed.length > 0 && (
              <>
                <BreadcrumbSeparator className="lg:hidden" />
                <BreadcrumbItem className="lg:hidden">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      className="flex items-center rounded-sm hover:text-foreground"
                      aria-label="Show the levels above"
                    >
                      <BreadcrumbEllipsis />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {collapsed.map((level, levelIndex) =>
                        level.link ? (
                          // biome-ignore lint/suspicious/noArrayIndexKey: levels are positional
                          <DropdownMenuItem key={levelIndex} asChild>
                            <AppLink to={level.link.to} params={level.link.params}>
                              {level.label ?? "…"}
                            </AppLink>
                          </DropdownMenuItem>
                        ) : null,
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </BreadcrumbItem>
              </>
            )}
            {index > 0 && (
              <BreadcrumbSeparator className={isCollapsed(index) ? "max-lg:hidden" : undefined} />
            )}
            <BreadcrumbItem className={cn("min-w-0", isCollapsed(index) && "max-lg:hidden")}>
              {crumb.label === undefined ? (
                <Skeleton className="h-4 w-24" />
              ) : crumb.link ? (
                <BreadcrumbLink asChild>
                  <AppLink
                    to={crumb.link.to}
                    params={crumb.link.params}
                    className="max-w-48 truncate"
                  >
                    {crumb.label}
                  </AppLink>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage className="max-w-64 truncate">{crumb.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
