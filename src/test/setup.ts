import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { toast } from "sonner";
import { afterAll, afterEach, vi } from "vitest";

import { server } from "./msw/server";

// As in the browser, which doesn't have the server's settings (.env): the
// auth client signs in on the page's own origin
for (const name of ["BETTER_AUTH_URL", "NEXT_PUBLIC_BETTER_AUTH_URL", "PUBLIC_BETTER_AUTH_URL"]) {
  delete process.env[name];
}

// The router: in memory (navigation.tsx)
vi.mock("next/navigation", async () => (await import("./navigation")).navigationMock);
vi.mock("next/link", async () => (await import("./navigation")).linkMock);

// Charts size themselves to their box, which jsdom doesn't lay out: draw
// them at a fixed size, so tests see their marks
vi.mock("recharts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("recharts")>()),
  ResponsiveContainer: ({
    children,
  }: {
    children: ReactElement<{ width?: number; height?: number }>;
  }) => cloneElement(children, { width: 640, height: 224 }),
}));

// Each test file's first page waits on its modules being compiled: under
// load (several suites, a dev server) that passes the 1s default
configure({ asyncUtilTimeout: 5000 });

// jsdom lacks APIs that Radix primitives and the theme provider use
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub;
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};
window.matchMedia ??= (query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as MediaQueryList;
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

// Mock requests from here, before any test file's modules load, so no
// request ever goes to the network
server.listen({ onUnhandledFrame: "error" });
afterEach(() => {
  // Toasts are kept outside React, and would show again in the next test
  toast.dismiss();
  cleanup();
  server.resetHandlers();
  localStorage.clear();
  document.cookie = "sidebar_state=; max-age=0; path=/";
});
afterAll(() => server.close());
