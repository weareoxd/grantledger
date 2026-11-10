import { act, screen, waitFor, within } from "@testing-library/react";
import { delay } from "msw";
import { HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it } from "vitest";

import { award, envelope, summary } from "@/test/fixtures";
import { api } from "@/test/msw/api";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/next-router";

// What each organization's lists name: one of its ministries, programs and
// recipients
const alberta = {
  organization: "Government of Alberta",
  ministry: "Arts, Culture and Status of Women",
  program: "Community Facility Enhancement Program",
  recipient: "PRAIRIE FOOD BANK SOCIETY",
};
const canada = {
  organization: "Government of Canada",
  ministry: "Canadian Heritage",
  program: "Canada Arts Presentation Fund",
  recipient: "NORTHERN LIGHTS ARTS COUNCIL",
};
const namesIn = (organizationId: unknown) => (organizationId === "1" ? alberta : canada);

beforeEach(() => {
  server.use(
    // A ministry's, program's and recipient's own pages read their rows of
    // these lists (a ministry's programs name the ministry)
    api.get("/api/organization/:organization_id/ministry", ({ params }) =>
      HttpResponse.json(
        envelope([
          {
            id: 16,
            name: namesIn(params.organization_id).ministry,
            award_count: 1,
          },
        ]),
      ),
    ),
    api.get("/api/organization/:organization_id/ministry/:ministry_id/program", ({ params }) => {
      const names = namesIn(params.organization_id);
      return HttpResponse.json(
        envelope([{ id: 5, name: names.program, award_count: 1 }], {
          organization: names.organization,
          ministry: names.ministry,
        }),
      );
    }),
    api.get("/api/organization/:organization_id/recipient", ({ params }) =>
      HttpResponse.json(
        envelope([
          {
            id: 42,
            name: namesIn(params.organization_id).recipient,
            is_placeholder: false,
            award_count: 1,
          },
        ]),
      ),
    ),
    // The overviews' figures
    api.get("/api/organization/:organization_id/*summary", () => HttpResponse.json(summary())),
    // Every other list, with the names of what it's in
    api.get("/api/organization/:organization_id/*", ({ params }) =>
      HttpResponse.json(envelope([award(1)], namesIn(params.organization_id))),
    ),
  );
});

/** The trail's links, by label: where each leads (the current page, the
 * last, isn't one) */
async function trail(url: string, last: string) {
  const { unmount } = renderApp(url);
  const breadcrumb = await screen.findByRole("navigation", {
    name: "breadcrumb",
  });
  await within(breadcrumb).findByText(last);
  // Every name loaded (they come with the list, after the page)
  await waitFor(() => expect(breadcrumb.querySelector('[data-slot="skeleton"]')).toBeNull());
  // Only the page itself is current, not a level above that its path starts
  // with (the last crumb, and any link leading to the page)
  const current = within(breadcrumb)
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page");
  expect(current.map((link) => link.textContent)).toContain(last);
  for (const link of current) {
    expect([null, url]).toContain(link.getAttribute("href"));
  }
  const links = Object.fromEntries(
    within(breadcrumb)
      .getAllByRole("link")
      .filter((link) => link.hasAttribute("href"))
      .map((link) => [link.textContent, link.getAttribute("href")]),
  );
  // Gone, for the next trail
  unmount();
  return links;
}

// The levels above a federal department's and program's pages
const inCanada = {
  Organizations: "/",
  "Government of Canada": "/organization/2",
};
const inHeritage = {
  ...inCanada,
  Departments: "/organization/2/ministry",
  "Canadian Heritage": "/organization/2/ministry/16",
};
const inArtsFund = {
  ...inHeritage,
  Programs: "/organization/2/ministry/16/program",
  "Canada Arts Presentation Fund": "/organization/2/ministry/16/program/5",
};
const ofCouncil = {
  ...inCanada,
  Recipients: "/organization/2/recipient",
  "NORTHERN LIGHTS ARTS COUNCIL": "/organization/2/recipient/42",
};

describe("breadcrumbs", () => {
  it("lead each organization, ministry, program and recipient to its own page", async () => {
    // A department's agreements with a recipient
    expect(await trail("/organization/2/ministry/16/recipient/42", canada.recipient)).toEqual({
      ...inHeritage,
      Recipients: "/organization/2/ministry/16/recipient",
    });
    // A program's
    expect(
      await trail("/organization/2/ministry/16/program/5/recipient/42", canada.recipient),
    ).toEqual({
      ...inArtsFund,
      Recipients: "/organization/2/ministry/16/program/5/recipient",
    });
    // A recipient's own lists
    expect(await trail("/organization/2/recipient/42/ministries", "Departments")).toEqual(
      ofCouncil,
    );
    expect(await trail("/organization/2/recipient/42/awards", "Agreements")).toEqual(ofCouncil);
  });

  it("lead each list to itself", async () => {
    for (const [url, last] of [
      ["/organization/2/award", "Agreements"],
      ["/organization/2/ministry", "Departments"],
      ["/organization/2/recipient", "Recipients"],
    ]) {
      expect(await trail(url!, last!)).toEqual(inCanada);
    }
    for (const [url, last] of [
      ["/organization/2/ministry/16/award", "Agreements"],
      ["/organization/2/ministry/16/program", "Programs"],
      ["/organization/2/ministry/16/recipient", "Recipients"],
    ]) {
      expect(await trail(url!, last!)).toEqual(inHeritage);
    }
    for (const [url, last] of [
      ["/organization/2/ministry/16/program/5/award", "Agreements"],
      ["/organization/2/ministry/16/program/5/recipient", "Recipients"],
    ]) {
      expect(await trail(url!, last!)).toEqual(inArtsFund);
    }
  });

  it("end with the organization, ministry, program or recipient on its own page", async () => {
    expect(await trail("/organization/2", canada.organization)).toEqual({
      Organizations: "/",
    });
    expect(await trail("/organization/2/ministry/16", canada.ministry)).toEqual({
      ...inCanada,
      Departments: "/organization/2/ministry",
    });
    expect(await trail("/organization/2/ministry/16/program/5", canada.program)).toEqual({
      ...inHeritage,
      Programs: "/organization/2/ministry/16/program",
    });
    expect(await trail("/organization/2/recipient/42", canada.recipient)).toEqual({
      ...inCanada,
      Recipients: "/organization/2/recipient",
    });
  });

  it("call Alberta's ministries ministries, and its records payments", async () => {
    const inAlberta = {
      Organizations: "/",
      "Government of Alberta": "/organization/1",
    };
    expect(await trail("/organization/1/ministry/16/award", "Payments")).toEqual({
      ...inAlberta,
      Ministries: "/organization/1/ministry",
      "Arts, Culture and Status of Women": "/organization/1/ministry/16",
    });
    expect(await trail("/organization/1/ministry", "Ministries")).toEqual(inAlberta);
    expect(await trail("/organization/1/recipient/42/ministries", "Ministries")).toEqual({
      ...inAlberta,
      Recipients: "/organization/1/recipient",
      "PRAIRIE FOOD BANK SOCIETY": "/organization/1/recipient/42",
    });
  });

  it("don't name a recipient after the one whose list was open before", async () => {
    // Its rows are shown while the next recipient's load: they aren't its
    server.use(
      api.get(
        "/api/organization/:organization_id/recipient/:recipient_id/award",
        async ({ params }) => {
          if (params.recipient_id === "42") {
            return HttpResponse.json(
              envelope([award(1)], {
                organization: "Government of Canada",
                recipient: "RECIPIENT FORTY-TWO",
              }),
            );
          }
          // Gone since the link was made (the data was loaded again)
          await delay(50);
          return HttpResponse.json({ detail: "Recipient not found." }, { status: 404 });
        },
      ),
    );
    const { router, queryClient } = renderApp("/organization/2/recipient/42/awards");
    const trail = await screen.findByRole("navigation", { name: "breadcrumb" });
    await within(trail).findByText("RECIPIENT FORTY-TWO");
    await act(() => router.navigate({ href: "/organization/2/recipient/17/awards" }));
    await screen.findByText("Page not found");
    expect(queryClient.getQueryData(["entity-name", "recipient", "17"])).toBeUndefined();
  });

  it("name the next recipient once its own rows load, and again going back", async () => {
    server.use(
      api.get(
        "/api/organization/:organization_id/recipient/:recipient_id/award",
        async ({ params }) => {
          if (params.recipient_id === "17") await delay(50);
          return HttpResponse.json(
            envelope([award(1)], {
              organization: "Government of Canada",
              recipient:
                params.recipient_id === "42" ? "RECIPIENT FORTY-TWO" : "RECIPIENT SEVENTEEN",
            }),
          );
        },
      ),
    );
    const { router, queryClient } = renderApp("/organization/2/recipient/42/awards");
    const trail = await screen.findByRole("navigation", { name: "breadcrumb" });
    await within(trail).findByText("RECIPIENT FORTY-TWO");

    await act(() => router.navigate({ href: "/organization/2/recipient/17/awards" }));
    expect(
      await within(screen.getByRole("navigation", { name: "breadcrumb" })).findByText(
        "RECIPIENT SEVENTEEN",
      ),
    ).toBeVisible();
    expect(queryClient.getQueryData(["entity-name", "recipient", "42"])).toBe(
      "RECIPIENT FORTY-TWO",
    );

    // Not in act: the page loads after it returns, and the find waits for it
    router.history.back();
    expect(
      await within(screen.getByRole("navigation", { name: "breadcrumb" })).findByText(
        "RECIPIENT FORTY-TWO",
      ),
    ).toBeVisible();
  });
});

/** The sidebar's sections: each one's heading (null for none), and where its
 * items lead, by label */
function sidebar() {
  return [...document.querySelectorAll('[data-sidebar="group"]')].map((group) => [
    group.querySelector('[data-sidebar="group-label"]')?.textContent ?? null,
    Object.fromEntries(
      [...group.querySelectorAll('[data-sidebar="menu-button"]')].map((item) => [
        item.textContent,
        item.getAttribute("href"),
      ]),
    ),
  ]);
}

/** The footer's attributions, and the licences they lead to */
const attributions = () =>
  [...document.querySelectorAll('[data-sidebar="footer"] a')].map((link) => [
    link.textContent,
    link.getAttribute("href"),
  ]);

describe("the sidebar", () => {
  it("leads to each level's lists, from the organization down", async () => {
    renderApp("/organization/2/ministry/16/program/5/recipient/42");
    await waitFor(() =>
      expect(sidebar()).toEqual([
        [null, { Organizations: "/" }],
        [
          "Government of Canada",
          {
            Agreements: "/organization/2/award",
            Departments: "/organization/2/ministry",
            Recipients: "/organization/2/recipient",
          },
        ],
        [
          "Canadian Heritage",
          {
            Agreements: "/organization/2/ministry/16/award",
            Programs: "/organization/2/ministry/16/program",
            Recipients: "/organization/2/ministry/16/recipient",
          },
        ],
        [
          "Canada Arts Presentation Fund",
          {
            Agreements: "/organization/2/ministry/16/program/5/award",
            Recipients: "/organization/2/ministry/16/program/5/recipient",
          },
        ],
        [
          "NORTHERN LIGHTS ARTS COUNCIL",
          {
            Agreements: "/organization/2/recipient/42/awards",
            Departments: "/organization/2/recipient/42/ministries",
          },
        ],
      ]),
    );
  });

  it("names Alberta's lists as Alberta does", async () => {
    renderApp("/organization/1/recipient/42");
    await waitFor(() =>
      expect(sidebar()).toEqual([
        [null, { Organizations: "/" }],
        [
          "Government of Alberta",
          {
            Payments: "/organization/1/award",
            Ministries: "/organization/1/ministry",
            Recipients: "/organization/1/recipient",
          },
        ],
        [
          "PRAIRIE FOOD BANK SOCIETY",
          {
            Payments: "/organization/1/recipient/42/awards",
            Ministries: "/organization/1/recipient/42/ministries",
          },
        ],
      ]),
    );
  });

  it("leads an admin, and only an admin, to the worker's page and the admin pages", async () => {
    const { unmount } = renderApp("/");
    await waitFor(() => expect(sidebar()[0]).toEqual([null, { Organizations: "/" }]));
    unmount();

    renderApp("/", {
      user: { email: "root@example.org", name: "Root", image: null, role: "admin" },
    });
    await waitFor(() =>
      expect(sidebar()[0]).toEqual([
        null,
        { Organizations: "/", Worker: "/worker", Admin: "/admin" },
      ]),
    );
  });

  it("credits the data as its licences ask", async () => {
    // Both organizations', on the pages about both
    const { unmount } = renderApp("/");
    await waitFor(() =>
      expect(attributions()).toEqual([
        [
          "Contains information licensed under the Open Government Licence – Alberta.",
          "https://open.alberta.ca/licence",
        ],
        [
          "Contains information licensed under the Open Government Licence – Canada.",
          "https://open.canada.ca/en/open-government-licence-canada",
        ],
      ]),
    );
    unmount();

    // One organization's, on its pages
    renderApp("/organization/2/award");
    await waitFor(() =>
      expect(attributions()).toEqual([
        [
          "Contains information licensed under the Open Government Licence – Canada.",
          "https://open.canada.ca/en/open-government-licence-canada",
        ],
      ]),
    );
  });
});
