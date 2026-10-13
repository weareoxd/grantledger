"use client";

import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import {
  ActivityIcon,
  Building2Icon,
  FileTextIcon,
  LandmarkIcon,
  LayersIcon,
  type LucideIcon,
  ShieldIcon,
  UsersIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { type Organization, organizationsQueryOptions } from "@/features/lists/organizations";
import type { LinkTarget } from "@/features/lists/types";
import { kindText } from "@/lib/record-kind";
import { AppLink, href } from "@/lib/routes";

import type { ShellUser } from "./AppShell";
import { Logo } from "./Logo";
import { useScope } from "./scope";

type NavItem = {
  label: string;
  icon: LucideIcon;
  link: LinkTarget;
  /** Active on its pages below too, not only its own */
  section?: boolean;
};

/**
 * Navigation for the organization, ministry, program and recipient in view:
 * their award, ministry, program and recipient lists
 */
export function AppSidebar({ user }: { user: ShellUser }) {
  const { params, names, kind, organization } = useScope();
  const { organization_id, ministry_id, program_id, recipient_id } = params;
  const awards = kindText(
    { agreement: "Agreements", payment: "Payments", unknown: "Awards" },
    kind,
  );
  const ministries = kindText(
    { agreement: "Departments", payment: "Ministries", unknown: "Ministries" },
    kind,
  );

  return (
    <Sidebar collapsible="icon" variant="inset">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {/* The app's name, not a menu item: no hover highlight */}
            <SidebarMenuButton
              size="lg"
              asChild
              className="hover:bg-transparent hover:text-sidebar-foreground active:bg-transparent active:text-sidebar-foreground group-data-[collapsible=icon]:p-0!"
            >
              <Link href="/">
                {/* Menu buttons force icons to 16px squares, hence the
                    overrides. Collapsed to icons it is a fixed 32px wide, the
                    rail's width: sized to the button instead, it would balloon
                    while the sidebar's width animates down */}
                <Logo className="h-2.5! w-auto! group-data-[collapsible=icon]:h-auto! group-data-[collapsible=icon]:w-8!" />
                <span className="truncate font-medium text-sm">GrantLedger</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup
          title={null}
          items={[
            {
              label: "Organizations",
              icon: Building2Icon,
              link: { to: "/", params: {} },
            },
            // The worker and the admin pages are for admins
            ...(user.role === "admin"
              ? [
                  {
                    label: "Worker",
                    icon: ActivityIcon,
                    link: { to: "/worker", params: {} },
                    section: true,
                  } satisfies NavItem,
                  {
                    label: "Admin",
                    icon: ShieldIcon,
                    link: { to: "/admin", params: {} },
                    section: true,
                  } satisfies NavItem,
                ]
              : []),
          ]}
        />
        {organization_id && (
          <NavGroup
            title={names.organization}
            link={{
              to: "/organization/$organization_id",
              params: { organization_id },
            }}
            items={[
              {
                label: awards,
                icon: FileTextIcon,
                link: {
                  to: "/organization/$organization_id/award",
                  params: { organization_id },
                },
              },
              {
                label: ministries,
                icon: LandmarkIcon,
                link: {
                  to: "/organization/$organization_id/ministry",
                  params: { organization_id },
                },
              },
              {
                label: "Recipients",
                icon: UsersIcon,
                link: {
                  to: "/organization/$organization_id/recipient",
                  params: { organization_id },
                },
              },
            ]}
          />
        )}
        {organization_id && ministry_id && (
          <NavGroup
            title={names.ministry}
            link={{
              to: "/organization/$organization_id/ministry/$ministry_id",
              params: { organization_id, ministry_id },
            }}
            items={[
              {
                label: awards,
                icon: FileTextIcon,
                link: {
                  to: "/organization/$organization_id/ministry/$ministry_id/award",
                  params: { organization_id, ministry_id },
                },
              },
              {
                label: "Programs",
                icon: LayersIcon,
                link: {
                  to: "/organization/$organization_id/ministry/$ministry_id/program",
                  params: { organization_id, ministry_id },
                },
              },
              {
                label: "Recipients",
                icon: UsersIcon,
                link: {
                  to: "/organization/$organization_id/ministry/$ministry_id/recipient",
                  params: { organization_id, ministry_id },
                },
              },
            ]}
          />
        )}
        {organization_id && ministry_id && program_id && (
          <NavGroup
            title={names.program}
            link={{
              to: "/organization/$organization_id/ministry/$ministry_id/program/$program_id",
              params: { organization_id, ministry_id, program_id },
            }}
            items={[
              {
                label: awards,
                icon: FileTextIcon,
                link: {
                  to: "/organization/$organization_id/ministry/$ministry_id/program/$program_id/award",
                  params: { organization_id, ministry_id, program_id },
                },
              },
              {
                label: "Recipients",
                icon: UsersIcon,
                link: {
                  to: "/organization/$organization_id/ministry/$ministry_id/program/$program_id/recipient",
                  params: { organization_id, ministry_id, program_id },
                },
              },
            ]}
          />
        )}
        {organization_id && recipient_id && (
          <NavGroup
            title={names.recipient}
            link={{
              to: "/organization/$organization_id/recipient/$recipient_id",
              params: { organization_id, recipient_id },
            }}
            items={[
              {
                label: awards,
                icon: FileTextIcon,
                link: {
                  to: "/organization/$organization_id/recipient/$recipient_id/awards",
                  params: { organization_id, recipient_id },
                },
              },
              {
                label: ministries,
                icon: LandmarkIcon,
                link: {
                  to: "/organization/$organization_id/recipient/$recipient_id/ministries",
                  params: { organization_id, recipient_id },
                },
              },
            ]}
          />
        )}
      </SidebarContent>
      <SidebarFooter className="group-data-[collapsible=icon]:hidden">
        <Attribution organization={organization} scoped={Boolean(organization_id)} />
      </SidebarFooter>
    </Sidebar>
  );
}

/**
 * What the data's licences ask of anyone showing it: the in-scope
 * organization's attribution, or on the pages about both, both
 */
function Attribution({
  organization,
  scoped,
}: {
  organization: Organization | undefined;
  scoped: boolean;
}) {
  const organizations = useQuery({
    ...organizationsQueryOptions,
    enabled: !scoped,
  });
  const shown = scoped ? (organization ? [organization] : []) : (organizations.data ?? []);
  if (shown.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5 px-2 pb-1 text-muted-foreground text-xs leading-snug">
      {shown.map((each) => (
        <p key={each.id}>
          {each.licence_url ? (
            <a href={each.licence_url} target="_blank" rel="noreferrer" className="link">
              {each.attribution}
            </a>
          ) : (
            each.attribution
          )}
        </p>
      ))}
    </div>
  );
}

function NavGroup({
  title,
  link,
  items,
}: {
  /** null for no heading; undefined while the name loads */
  title: string | null | undefined;
  /** Its own page (an organization's, ministry's, program's or recipient's) */
  link?: NavItem["link"];
  items: NavItem[];
}) {
  const pathname = usePathname();
  const isActive = ({ link, section }: Pick<NavItem, "link" | "section">) => {
    const path = href(link);
    return pathname === path || Boolean(section && pathname?.startsWith(`${path}/`));
  };

  return (
    <SidebarGroup>
      {title !== null &&
        (title ? (
          // Long names (ministries and programs especially) wrap. Collapsed to icons, the
          // label is hidden by sliding it up one line, so it goes back to
          // one clipped line there
          <SidebarGroupLabel
            asChild={Boolean(link)}
            className={cn(
              "h-auto min-h-8 py-1.5 leading-snug group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:overflow-hidden",
              // Its own page: a link, out of reach while it's hidden
              link &&
                "hover:text-sidebar-foreground data-[status=active]:text-sidebar-foreground group-data-[collapsible=icon]:invisible",
            )}
          >
            {link ? (
              <AppLink
                to={link.to}
                params={link.params}
                data-status={isActive({ link }) ? "active" : undefined}
              >
                {title}
              </AppLink>
            ) : (
              title
            )}
          </SidebarGroupLabel>
        ) : (
          <SidebarMenuSkeleton className="h-8" />
        ))}
      {/* Collapsed to icons, the heading is hidden: a line marks where its
          section starts instead */}
      {title !== null && (
        <SidebarSeparator className="mx-0 mb-2 hidden group-data-[collapsible=icon]:block" />
      )}
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map(({ label, icon: Icon, link, section }) => (
            <SidebarMenuItem key={link.to}>
              <SidebarMenuButton asChild tooltip={label} isActive={isActive({ link, section })}>
                <AppLink to={link.to} params={link.params}>
                  <Icon />
                  <span>{label}</span>
                </AppLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
