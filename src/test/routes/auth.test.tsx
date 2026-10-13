import { screen } from "@testing-library/react";
import { HttpResponse } from "msw/http";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SignInPage from "@/app/sign-in/page";
import { describeSignInError } from "@/features/auth/SignInForm";
import { safeRedirect } from "@/features/auth/session";
import { googleConfigured } from "@/lib/auth/auth";
import { getSessionUser } from "@/lib/auth/session";
import { envelope, organizations } from "@/test/fixtures";
import { api } from "@/test/msw/api";
import { server } from "@/test/msw/server";
import { RedirectError } from "@/test/navigation";
import { renderApp } from "@/test/next-router";

// The sign-in page asks the server who is signed in, and whether Google sign-in is set up
vi.mock("@/lib/auth/session", () => ({ getSessionUser: vi.fn() }));
vi.mock("@/lib/auth/auth", () => ({
  googleConfigured: vi.fn(() => true),
}));

beforeEach(() => {
  vi.mocked(getSessionUser).mockResolvedValue(null);
  vi.mocked(googleConfigured).mockReturnValue(true);
});

/** Renders the sign-in page as the server would, for a URL's search params. */
async function renderSignIn(search = "") {
  const params = Object.fromEntries(new URLSearchParams(search));
  const page = (await SignInPage({ searchParams: Promise.resolve(params) })) as ReactElement;
  return renderApp(`/sign-in${search ? `?${search}` : ""}`, { page });
}

describe("signing in", () => {
  it("goes to Google, to come back to the page that sent you", async () => {
    const requests: unknown[] = [];
    server.use(
      api.post("/api/auth/sign-in/social", async ({ request }) => {
        requests.push(await request.json());
        // Better Auth's client follows `url` when `redirect` is true; jsdom can't, so not here
        return HttpResponse.json({
          url: "https://accounts.google.com/o/oauth2/auth",
          redirect: false,
        });
      }),
    );
    const { user } = await renderSignIn(
      `redirect=${encodeURIComponent("/organization/2?sort=-value")}`,
    );
    await user.click(await screen.findByRole("button", { name: "Continue with Google" }));
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({
      provider: "google",
      callbackURL: "/organization/2?sort=-value",
      errorCallbackURL: `/sign-in?redirect=${encodeURIComponent("/organization/2?sort=-value")}`,
    });
  });

  it("says why Google sign-in was refused", async () => {
    await renderSignIn("error=unverified_email");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Google hasn't verified that account's email address, so it can't be used to sign in.",
    );
    expect(describeSignInError("access_denied")).toBe("Google sign-in was cancelled.");
    expect(describeSignInError("something_else")).toBe(
      "Sign-in didn't work. Try again in a moment.",
    );
  });

  it("says nothing about who may sign in: anyone with a Google account can", async () => {
    await renderSignIn();
    expect(await screen.findByRole("button", { name: "Continue with Google" })).toBeVisible();
    expect(screen.queryByText(/admin has added/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says when Google sign-in isn't set up", async () => {
    vi.mocked(googleConfigured).mockReturnValue(false);
    await renderSignIn();
    expect(await screen.findByRole("alert")).toHaveTextContent("Google sign-in isn't set up");
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
  });

  it("isn't asked for again when signed in", async () => {
    vi.mocked(getSessionUser).mockResolvedValue({
      id: "user-1",
      email: "analyst@example.org",
      name: "Ana Lyst",
      image: null,
      role: "user",
    });
    const page = SignInPage({ searchParams: Promise.resolve({ redirect: "/organization/2" }) });
    await expect(page).rejects.toThrow(RedirectError);
    await expect(page).rejects.toMatchObject({ url: "/organization/2" });
  });

  it("goes on to the home page from a link to another site", async () => {
    const page = (await SignInPage({
      searchParams: Promise.resolve({ redirect: "//elsewhere.example" }),
    })) as ReactElement<{ redirect: string }>;
    expect(page.props.redirect).toBe("/");
  });

  it("never goes on to another site", () => {
    expect(safeRedirect("/organization/2?fy=2024")).toBe("/organization/2?fy=2024");
    expect(safeRedirect("https://elsewhere.example")).toBe("/");
    expect(safeRedirect("//elsewhere.example")).toBe("/");
    expect(safeRedirect("/\\elsewhere.example")).toBe("/");
    expect(safeRedirect(["/a", "/b"])).toBe("/");
    expect(safeRedirect(undefined)).toBe("/");
  });
});

describe("signing out", () => {
  it("goes to the sign-in page", async () => {
    let signedOutCalls = 0;
    let refused = 0;
    server.use(
      api.post("/api/auth/sign-out", () => {
        signedOutCalls += 1;
        return HttpResponse.json({ success: true });
      }),
      // Signed out, the API refuses the page's requests
      api.get("/api/organization", () => {
        if (!signedOutCalls) return HttpResponse.json(envelope(organizations));
        refused += 1;
        return HttpResponse.json({ detail: "Not signed in." }, { status: 401 });
      }),
    );
    const { router, user } = renderApp("/");
    await user.click(await screen.findByRole("button", { name: "Account" }));
    expect(await screen.findByText("Ana Lyst")).toBeVisible();
    expect(screen.getByText("analyst@example.org")).toBeVisible();
    expect(screen.getByText("User")).toBeVisible();
    await user.click(screen.getByRole("menuitem", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(signedOutCalls).toBe(1);
    // The page it left asks for nothing more
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(refused).toBe(0);
    expect(router.state.location.href).toBe("/sign-in");
  });

  it("says who is signed in, and as what", async () => {
    const { user } = renderApp("/", {
      user: { email: "root@example.org", name: "Root", image: null, role: "admin" },
    });
    await user.click(await screen.findByRole("button", { name: "Account" }));
    expect(await screen.findByText("Root")).toBeVisible();
    expect(screen.getByText("Administrator")).toBeVisible();
  });
});

describe("a session that ends", () => {
  it("goes to the sign-in page, and back after", async () => {
    // The session ends before the page's list loads
    server.use(
      api.get("/api/organization", () =>
        HttpResponse.json(
          { detail: "Authentication credentials were not provided." },
          { status: 401 },
        ),
      ),
    );
    const { router } = renderApp("/?sort=name");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeVisible();
    expect(router.state.location.search).toEqual({ redirect: "/?sort=name" });
  });
});
