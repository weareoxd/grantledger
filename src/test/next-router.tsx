/**
 * The app as the browser shows it, for UI tests: `renderApp(url)` renders the page a URL leads to,
 * in the app's shell, as the root and (app) layouts and the page would (src/app). Navigation is
 * in memory (navigation.tsx, mocked in for next/navigation and next/link in setup.ts).
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";

import { AppShell, type ShellUser } from "@/app-shell/AppShell";
import { ThemeProvider } from "@/app-shell/theme";
import { NotFound } from "@/components/NotFound";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SignInForm } from "@/features/auth/SignInForm";
import { safeRedirect } from "@/features/auth/session";
import {
  MinistryOverview,
  OrganizationOverview,
  ProgramOverview,
  RecipientOverview,
} from "@/features/landing/overviews";
import { type ListName, NamedListPage } from "@/features/lists/ListPage";
import { parseSearch } from "@/features/table/state/search";

import {
  findPage,
  history,
  type PagePattern,
  type Params,
  refreshes,
  useEntry,
} from "./navigation";

const list = (name: ListName) => () => <NamedListPage list={name} />;

/** What each page renders, as its page.tsx does */
const PAGES: Record<PagePattern, (params: Params) => ReactElement> = {
  "/": list("organizationsList"),
  "/organization/[organization_id]": (p) => (
    <OrganizationOverview organizationId={p.organization_id ?? ""} />
  ),
  "/organization/[organization_id]/award": list("awardsList"),
  "/organization/[organization_id]/ministry": list("ministriesList"),
  "/organization/[organization_id]/recipient": list("recipientsList"),
  "/organization/[organization_id]/ministry/[ministry_id]": (p) => (
    <MinistryOverview organizationId={p.organization_id ?? ""} ministryId={p.ministry_id ?? ""} />
  ),
  "/organization/[organization_id]/ministry/[ministry_id]/award": list("ministryAwardsList"),
  "/organization/[organization_id]/ministry/[ministry_id]/program": list("ministryProgramsList"),
  "/organization/[organization_id]/ministry/[ministry_id]/recipient":
    list("ministryRecipientsList"),
  "/organization/[organization_id]/ministry/[ministry_id]/recipient/[recipient_id]": list(
    "ministryRecipientAwardsList",
  ),
  "/organization/[organization_id]/ministry/[ministry_id]/program/[program_id]": (p) => (
    <ProgramOverview
      organizationId={p.organization_id ?? ""}
      ministryId={p.ministry_id ?? ""}
      programId={p.program_id ?? ""}
    />
  ),
  "/organization/[organization_id]/ministry/[ministry_id]/program/[program_id]/award":
    list("programAwardsList"),
  "/organization/[organization_id]/ministry/[ministry_id]/program/[program_id]/recipient":
    list("programRecipientsList"),
  "/organization/[organization_id]/ministry/[ministry_id]/program/[program_id]/recipient/[recipient_id]":
    list("programRecipientAwardsList"),
  "/organization/[organization_id]/recipient/[recipient_id]": (p) => (
    <RecipientOverview
      organizationId={p.organization_id ?? ""}
      recipientId={p.recipient_id ?? ""}
    />
  ),
  "/organization/[organization_id]/recipient/[recipient_id]/awards": list("recipientAwardsList"),
  "/organization/[organization_id]/recipient/[recipient_id]/ministries":
    list("recipientMinistriesList"),
};

/** Who the tests are signed in as, unless they say */
export const testUser: ShellUser = {
  email: "analyst@example.org",
  name: "Ana Lyst",
  image: null,
  role: "user",
};

/** The page at the current URL, as the layouts and pages render it */
function TestApp({ user, page }: { user: ShellUser; page?: ReactNode }) {
  const { pathname, search } = useEntry();
  // A server page's output, rendered as given (the sign-in page, say)
  if (page && pathname === history.entries[0]?.pathname) return page;
  if (pathname === "/sign-in") {
    const redirect = new URLSearchParams(search).get("redirect") ?? undefined;
    return <SignInForm redirect={safeRedirect(redirect)} />;
  }
  const found = findPage(pathname);
  // As the pages check (scopeParams): ids are positive integers
  if (!found || Object.values(found.params).some((id) => !/^[1-9]\d*$/.test(id))) {
    return <NotFound />;
  }
  const defaultSidebarOpen = !document.cookie.split("; ").includes("sidebar_state=false");
  return (
    <AppShell user={user} defaultSidebarOpen={defaultSidebarOpen}>
      {/* Another path is another page (its own state); the same with another query isn't */}
      <Page key={pathname}>{PAGES[found.pattern](found.params)}</Page>
    </AppShell>
  );
}

function Page({ children }: { children: ReactNode }) {
  return children;
}

export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
      mutations: { retry: false },
    },
  });
}

/** The current location, as tests check it, and going elsewhere */
const testRouter = {
  state: {
    get location() {
      const { pathname, search } = history.current;
      return {
        pathname,
        searchStr: search,
        /** As the lists read it */
        search: parseSearch(search),
        href: pathname + search,
      };
    },
  },
  /** How many times the page asked for the server's part again (`router.refresh()`) */
  get refreshes() {
    return refreshes.count;
  },
  /** Go to `href`, as a link would */
  navigate: async ({ href, replace }: { href: string; replace?: boolean }) => {
    if (replace) history.replace(href);
    else history.push(href);
  },
  history: {
    back: () => history.go(-1),
    forward: () => history.go(1),
  },
};

/** Render the app at a URL, as the browser would load it */
export function renderApp(
  url: string,
  { user: shellUser = testUser, page }: { user?: ShellUser; page?: ReactNode } = {},
) {
  history.reset(url);
  refreshes.count = 0;
  const queryClient = createTestQueryClient();
  const user = userEvent.setup();
  const result = render(
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider delayDuration={0}>
          <TestApp user={shellUser} page={page} />
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { ...result, router: testRouter, queryClient, user };
}

/** Render one page's component at a URL, in the app's shell (an alias of `renderApp`) */
export const renderPage = renderApp;
