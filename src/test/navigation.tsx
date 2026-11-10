/**
 * `next/navigation` and `next/link` for UI tests (mocked in setup.ts): an in-memory history, the
 * browser's address kept in step. No app imports here: the app's modules import these.
 */
import { type AnchorHTMLAttributes, type MouseEvent, type Ref, useSyncExternalStore } from "react";

// History

type Entry = { pathname: string; search: string };

function toEntry(url: string): Entry {
  const parsed = new URL(url, "http://localhost");
  return { pathname: parsed.pathname, search: parsed.search };
}

export const history = {
  entries: [toEntry("/")],
  index: 0,
  listeners: new Set<() => void>(),
  get current() {
    return this.entries[this.index] ?? toEntry("/");
  },
  reset(url: string) {
    this.entries = [toEntry(url)];
    this.index = 0;
    this.changed();
  },
  push(url: string) {
    this.entries = [...this.entries.slice(0, this.index + 1), toEntry(url)];
    this.index = this.entries.length - 1;
    this.changed();
  },
  replace(url: string) {
    this.entries = this.entries.map((entry, index) =>
      index === this.index ? toEntry(url) : entry,
    );
    this.changed();
  },
  go(delta: number) {
    const index = this.index + delta;
    if (index < 0 || index >= this.entries.length) return;
    this.index = index;
    this.changed();
  },
  changed() {
    // The browser's address too: code that reads window.location sees the page's
    const { pathname, search } = this.current;
    window.history.replaceState(null, "", pathname + search);
    for (const listener of this.listeners) listener();
  },
  subscribe(listener: () => void) {
    history.listeners.add(listener);
    return () => history.listeners.delete(listener);
  },
};

export const useEntry = () =>
  useSyncExternalStore(
    history.subscribe,
    () => history.current,
    () => history.current,
  );

/** How many times a page asked for the server's part of the pages again (`router.refresh()`) */
export const refreshes = { count: 0 };

// The app's pages' path patterns (src/app/**/page.tsx)

export type Params = Record<string, string>;

const O = "/organization/[organization_id]";
const M = `${O}/ministry/[ministry_id]`;
const P = `${M}/program/[program_id]`;

export const PAGE_PATTERNS = [
  "/",
  O,
  `${O}/award`,
  `${O}/ministry`,
  `${O}/recipient`,
  M,
  `${M}/award`,
  `${M}/program`,
  `${M}/recipient`,
  `${M}/recipient/[recipient_id]`,
  P,
  `${P}/award`,
  `${P}/recipient`,
  `${P}/recipient/[recipient_id]`,
  `${O}/recipient/[recipient_id]`,
  `${O}/recipient/[recipient_id]/awards`,
  `${O}/recipient/[recipient_id]/ministries`,
] as const;

export type PagePattern = (typeof PAGE_PATTERNS)[number];

function match(pattern: string, pathname: string): Params | null {
  const want = pattern.split("/").filter(Boolean);
  const have = pathname.split("/").filter(Boolean);
  if (want.length !== have.length) return null;
  const params: Params = {};
  for (const [index, segment] of want.entries()) {
    const value = have[index] ?? "";
    const name = /^\[(.+)\]$/.exec(segment)?.[1];
    if (name) params[name] = decodeURIComponent(value);
    else if (segment !== value) return null;
  }
  return params;
}

/** The page a path leads to, and its params; null for none */
export function findPage(pathname: string): { pattern: PagePattern; params: Params } | null {
  for (const pattern of PAGE_PATTERNS) {
    const params = match(pattern, pathname);
    if (params) return { pattern, params };
  }
  return null;
}

// next/navigation

const router = {
  push: (url: string) => history.push(url),
  replace: (url: string) => history.replace(url),
  back: () => history.go(-1),
  forward: () => history.go(1),
  refresh: () => {
    refreshes.count += 1;
  },
  prefetch: () => {},
};

let lastSearch: { search: string; params: URLSearchParams } | undefined;
let lastParams: { pathname: string; params: Params } | undefined;

export const navigationMock = {
  useRouter: () => router,
  usePathname: () => useEntry().pathname,
  useSearchParams: () => {
    const { search } = useEntry();
    if (lastSearch?.search !== search) lastSearch = { search, params: new URLSearchParams(search) };
    return lastSearch.params;
  },
  useParams: () => {
    const { pathname } = useEntry();
    if (lastParams?.pathname !== pathname) {
      lastParams = { pathname, params: findPage(pathname)?.params ?? {} };
    }
    return lastParams.params;
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
};

/** What the mocked `redirect()` throws: where it sends the browser */
export class RedirectError extends Error {
  constructor(readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

// next/link

function Link({
  href,
  replace,
  scroll: _scroll,
  prefetch: _prefetch,
  onClick,
  ref,
  ...props
}: AnchorHTMLAttributes<HTMLAnchorElement> & {
  href: string;
  replace?: boolean;
  scroll?: boolean;
  prefetch?: boolean | null;
  ref?: Ref<HTMLAnchorElement>;
}) {
  const navigate = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      props.target === "_blank"
    ) {
      return;
    }
    event.preventDefault();
    if (replace) history.replace(href);
    else history.push(href);
  };
  return <a {...props} ref={ref} href={href} onClick={navigate} />;
}

export const linkMock = { __esModule: true, default: Link };
