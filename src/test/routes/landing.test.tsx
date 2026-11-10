import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw/http";
import { beforeEach, describe, expect, it } from "vitest";

import { basis, envelope, summary } from "@/test/fixtures";
import { api } from "@/test/msw/api";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/next-router";

// A federal department, and an Alberta ministry
const heritage = {
  id: 16,
  name: "Canadian Heritage",
  program_count: 41,
  recipient_count: 3820,
  award_count: 7310,
  award_value: 1_382_406_118.6,
};
const culture = {
  id: 21,
  name: "Arts, Culture and Status of Women",
  program_count: 9,
  recipient_count: 2140,
  award_count: 18_400,
  award_value: 412_000_000,
};
// One of the department's programs
const artsFund = {
  id: 5,
  name: "Canada Arts Presentation Fund",
  recipient_count: 410,
  award_count: 1220,
  award_value: 98_400_000,
};
// A recipient of its funding
const council = {
  id: 42,
  key: "NORTHERN LIGHTS ARTS COUNCIL",
  name: "NORTHERN LIGHTS ARTS COUNCIL",
  is_placeholder: false,
  ministry_count: 3,
  award_count: 12,
  award_value: 345_000,
};

let rowQueries: URLSearchParams[];

beforeEach(() => {
  rowQueries = [];
  server.use(
    // Each overview reads its row of the list it's in
    api.get("/api/organization/:organization_id/ministry", ({ request, params }) => {
      rowQueries.push(new URL(request.url).searchParams);
      return HttpResponse.json(envelope([params.organization_id === "1" ? culture : heritage]));
    }),
    api.get("/api/organization/:organization_id/ministry/:ministry_id/program", ({ request }) => {
      rowQueries.push(new URL(request.url).searchParams);
      // Scoped to the ministry, so it names it
      return HttpResponse.json(
        envelope([artsFund], {
          organization: "Government of Canada",
          ministry: "Canadian Heritage",
        }),
      );
    }),
    api.get("/api/organization/:organization_id/recipient", ({ request }) => {
      rowQueries.push(new URL(request.url).searchParams);
      return HttpResponse.json(envelope([council]));
    }),
  );
});

/** The page's cards that lead somewhere, by their title: where, and what
 * they say */
async function cards() {
  const main = screen.getByRole("heading", { level: 1 }).closest("section")!;
  await waitFor(() => expect(main.querySelector('[data-slot="skeleton"]')).toBeNull());
  return Object.fromEntries(
    within(main)
      .getAllByRole("listitem")
      .map((item) => {
        const link = item.querySelector("a");
        const title = item.querySelector('[data-slot="card-title"]')!;
        return [
          title.textContent,
          {
            href: link?.getAttribute("href") ?? null,
            text: item.textContent!.replace(title.textContent!, ""),
          },
        ];
      }),
  );
}

/** The sidebar's headings: each a name, leading to its own page */
const sidebarHeadings = () =>
  [...document.querySelectorAll('a[data-sidebar="group-label"]')].map((link) => [
    link.textContent,
    link.getAttribute("href"),
  ]);

describe("an organization's page", () => {
  it("leads to its lists, with what's in them", async () => {
    renderApp("/organization/2");
    expect(await screen.findByRole("heading", { name: "Government of Canada" })).toBeVisible();
    expect(await cards()).toEqual({
      Agreements: { href: "/organization/2/award", text: "1,204,877$412.30B" },
      Departments: { href: "/organization/2/ministry", text: "104" },
      Recipients: { href: "/organization/2/recipient", text: "187,350" },
    });
    // Where the data comes from
    expect(
      screen.getByRole("link", {
        name: "Proactive Disclosure - Grants and Contributions (Treasury Board of Canada Secretariat)",
      }),
    ).toHaveAttribute(
      "href",
      "https://open.canada.ca/data/en/dataset/432527ab-7aac-45b5-81d6-7597107a7013",
    );
    expect(document.title).toBe("Government of Canada · GrantLedger");
  });

  it("calls Alberta's records payments, and its ministries ministries", async () => {
    renderApp("/organization/1");
    expect(await screen.findByRole("heading", { name: "Government of Alberta" })).toBeVisible();
    expect(await cards()).toEqual({
      Payments: { href: "/organization/1/award", text: "2,031,552$96.48B" },
      Ministries: { href: "/organization/1/ministry", text: "26" },
      Recipients: { href: "/organization/1/recipient", text: "61,048" },
    });
    expect(screen.getByText("Grant Payments Disclosure (Government of Alberta)")).toHaveAttribute(
      "href",
      "https://open.alberta.ca/dataset/grant-disclosure",
    );
  });

  it("isn't there for an organization there isn't", async () => {
    renderApp("/organization/99");
    expect(await screen.findByText("Page not found")).toBeVisible();
  });

  it("says when the organizations couldn't be loaded, and tries again", async () => {
    let failing = true;
    server.use(
      api.get("/api/organization", () =>
        failing ? HttpResponse.json(null, { status: 500 }) : undefined,
      ),
    );
    const { user } = renderApp("/organization/2");
    expect(await screen.findByText("Couldn't load this page")).toBeVisible();
    expect(
      screen.getByText("The server couldn't complete the request. Try again in a moment."),
    ).toBeVisible();
    failing = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Government of Canada" })).toBeVisible();
  });
});

describe("an overview", () => {
  it("isn't there for an id that isn't one", async () => {
    for (const url of [
      "/organization/two",
      "/organization/2/ministry/heritage",
      "/organization/2/ministry/16/program/arts",
      "/organization/2/recipient/abc",
    ]) {
      const { unmount } = renderApp(url);
      expect(await screen.findByText("Page not found")).toBeVisible();
      unmount();
    }
  });
});

describe("a ministry's page", () => {
  it("leads to its lists, from its row of the departments", async () => {
    renderApp("/organization/2/ministry/16");
    expect(await screen.findByRole("heading", { name: "Canadian Heritage" })).toBeVisible();
    expect(screen.getByText("Department")).toBeVisible();
    expect(await cards()).toEqual({
      Agreements: {
        href: "/organization/2/ministry/16/award",
        text: "7,310$1.38B",
      },
      Programs: { href: "/organization/2/ministry/16/program", text: "41" },
      Recipients: {
        href: "/organization/2/ministry/16/recipient",
        text: "3,820",
      },
    });
    // Its row only
    expect(Object.fromEntries(rowQueries[0]!)).toMatchObject({
      page_size: "1",
      "id[0][value]": "16",
      "id[0][matchMode]": "equals",
    });
    expect(document.title).toBe("Canadian Heritage · GrantLedger");
  });

  it("is named in the navigation, which leads back to it", async () => {
    renderApp("/organization/2/ministry/16");
    // The sidebar's headings: the organization's and the department's
    await waitFor(() =>
      expect(sidebarHeadings()).toEqual([
        ["Government of Canada", "/organization/2"],
        ["Canadian Heritage", "/organization/2/ministry/16"],
      ]),
    );
  });

  it("is a ministry in Alberta, whose records are payments", async () => {
    renderApp("/organization/1/ministry/21");
    expect(
      await screen.findByRole("heading", {
        name: "Arts, Culture and Status of Women",
      }),
    ).toBeVisible();
    expect(screen.getByText("Ministry")).toBeVisible();
    expect(Object.keys(await cards())).toEqual(["Payments", "Programs", "Recipients"]);
  });

  it("says when its row couldn't be loaded, and tries again", async () => {
    let failing = true;
    server.use(
      api.get("/api/organization/:organization_id/ministry", () =>
        failing
          ? HttpResponse.json(null, { status: 500 })
          : HttpResponse.json(envelope([heritage])),
      ),
    );
    const { user } = renderApp("/organization/2/ministry/16");
    expect(await screen.findByText("Couldn't load this page")).toBeVisible();
    failing = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Canadian Heritage" })).toBeVisible();
  });

  it("isn't there for a ministry of another organization", async () => {
    server.use(
      api.get("/api/organization/:organization_id/ministry", () => HttpResponse.json(envelope([]))),
    );
    renderApp("/organization/2/ministry/21");
    expect(await screen.findByText("Page not found")).toBeVisible();
  });
});

describe("a program's page", () => {
  it("leads to its lists, from its row of the department's programs", async () => {
    renderApp("/organization/2/ministry/16/program/5");
    expect(
      await screen.findByRole("heading", {
        name: "Canada Arts Presentation Fund",
      }),
    ).toBeVisible();
    expect(screen.getByText("Program")).toBeVisible();
    expect(await cards()).toEqual({
      Agreements: {
        href: "/organization/2/ministry/16/program/5/award",
        text: "1,220$98.40M",
      },
      Recipients: {
        href: "/organization/2/ministry/16/program/5/recipient",
        text: "410",
      },
    });
    expect(Object.fromEntries(rowQueries[0]!)).toMatchObject({
      page_size: "1",
      "id[0][value]": "5",
    });
    expect(document.title).toBe("Canada Arts Presentation Fund · GrantLedger");
  });

  it("names its department, from its row's list", async () => {
    // Nothing loads the department's own row: the programs list names it
    const departments: string[] = [];
    server.use(
      api.get("/api/organization/:organization_id/ministry", ({ request }) => {
        departments.push(request.url);
        return HttpResponse.json(envelope([heritage]));
      }),
    );
    renderApp("/organization/2/ministry/16/program/5");
    const breadcrumb = await screen.findByRole("navigation", {
      name: "breadcrumb",
    });
    expect(
      await within(breadcrumb).findByRole("link", { name: "Canadian Heritage" }),
    ).toHaveAttribute("href", "/organization/2/ministry/16");
    // The whole trail, the program last
    expect(
      within(breadcrumb)
        .getAllByRole("link")
        .map((crumb) => crumb.textContent),
    ).toEqual([
      "Organizations",
      "Government of Canada",
      "Departments",
      "Canadian Heritage",
      "Programs",
      "Canada Arts Presentation Fund",
    ]);
    await waitFor(() =>
      expect(sidebarHeadings()).toEqual([
        ["Government of Canada", "/organization/2"],
        ["Canadian Heritage", "/organization/2/ministry/16"],
        ["Canada Arts Presentation Fund", "/organization/2/ministry/16/program/5"],
      ]),
    );
    expect(departments).toEqual([]);
  });

  it("isn't there for a program the department doesn't have", async () => {
    server.use(
      api.get("/api/organization/:organization_id/ministry/:ministry_id/program", () =>
        HttpResponse.json(envelope([], { ministry: "Canadian Heritage" })),
      ),
    );
    renderApp("/organization/2/ministry/16/program/6");
    expect(await screen.findByText("Page not found")).toBeVisible();
  });
});

describe("a recipient's page", () => {
  it("leads to its lists, with what's in them", async () => {
    renderApp("/organization/2/recipient/42");
    expect(
      await screen.findByRole("heading", {
        name: "NORTHERN LIGHTS ARTS COUNCIL",
      }),
    ).toBeVisible();
    expect(await cards()).toEqual({
      Agreements: {
        href: "/organization/2/recipient/42/awards",
        text: "12$345K",
      },
      Departments: {
        href: "/organization/2/recipient/42/ministries",
        text: "3",
      },
    });
  });

  it("says what a placeholder recipient is", async () => {
    server.use(
      api.get("/api/organization/:organization_id/recipient", () =>
        HttpResponse.json(
          envelope([
            {
              ...council,
              id: 9,
              key: "INDIVIDUAL RECIPIENT (NAME WITHHELD)",
              name: "INDIVIDUAL RECIPIENT (NAME WITHHELD)",
              is_placeholder: true,
            },
          ]),
        ),
      ),
    );
    renderApp("/organization/2/recipient/9");
    await screen.findByRole("heading", {
      name: "INDIVIDUAL RECIPIENT (NAME WITHHELD)",
    });
    expect(screen.getByText(/^Not a real recipient: amounts the publisher released/)).toBeVisible();
  });

  it("isn't there once its row is gone", async () => {
    // Opened, then the data loaded again without it (its row gone on refetch)
    let gone = false;
    server.use(
      api.get("/api/organization/:organization_id/recipient", () =>
        HttpResponse.json(envelope(gone ? [] : [council])),
      ),
    );
    const { queryClient } = renderApp("/organization/2/recipient/42");
    await screen.findByRole("heading", { name: "NORTHERN LIGHTS ARTS COUNCIL" });
    gone = true;
    await queryClient.invalidateQueries({ queryKey: ["list"] });
    expect(await screen.findByText("Page not found")).toBeVisible();
  });

  it("doesn't lead to a list with nothing in it", async () => {
    server.use(
      api.get("/api/organization/:organization_id/recipient", () =>
        HttpResponse.json(envelope([{ ...council, ministry_count: 0 }])),
      ),
    );
    renderApp("/organization/2/recipient/42");
    await screen.findByRole("heading", { name: "NORTHERN LIGHTS ARTS COUNCIL" });
    expect((await cards()).Departments).toEqual({ href: null, text: "0" });
  });

  it("isn't there for a recipient the organization hasn't funded", async () => {
    server.use(
      api.get("/api/organization/:organization_id/recipient", () =>
        HttpResponse.json(envelope([])),
      ),
    );
    renderApp("/organization/2/recipient/42");
    expect(await screen.findByText("Page not found")).toBeVisible();
  });
});

/** An analytics panel, by its title, once loaded */
async function panel(title: string) {
  const card = await waitFor(() => {
    const heading = screen.getByText(title, {
      selector: '[data-slot="card-title"]',
    });
    const card = heading.closest<HTMLElement>('[data-slot="card"]')!;
    expect(card.querySelector('[data-slot="skeleton"]')).toBeNull();
    return card;
  });
  return within(card);
}

/** A table's rows, as their cells' text */
function rows(table: HTMLElement) {
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    );
}

const headers = (table: HTMLElement) =>
  within(table)
    .getAllByRole("columnheader")
    .map((header) => header.textContent);

// Agreements by type: grants and contributions
const mix = {
  groups: [
    { key: "G", label: "Grant" },
    { key: "C", label: "Contribution" },
  ],
  by_year: [
    { fiscal_year: 2025, group: "G", count: 1800, value: 1 },
    { fiscal_year: 2025, group: "C", count: 2200, value: 1 },
    { fiscal_year: 2026, group: "G", count: 350, value: 1 },
    { fiscal_year: 2026, group: "C", count: 600, value: 1 },
  ],
};

const latest = [
  {
    id: 9,
    reference: "GC-0009",
    start_date: "2026-08-01",
    value: 50_000,
    agreement_type: "G",
    recipient_id: 42,
    recipient_name: "NORTHERN LIGHTS ARTS COUNCIL",
    recipient_is_placeholder: false,
    ministry_id: 16,
    ministry_name: "Canadian Heritage",
  },
];

const newcomers = {
  count: 96,
  top: [
    {
      id: 43,
      name: "PRAIRIE FOOD BANK SOCIETY",
      first_start_date: "2026-04-16",
      count: 1,
      value: 31_200_000,
    },
  ],
};

const movers = [
  [42, "NORTHERN LIGHTS ARTS COUNCIL", 210_000_000, 70_000_000, 1],
  [43, "PRAIRIE FOOD BANK SOCIETY", 31_200_000, 0, 0],
  [44, "RIVERSIDE COMMUNITY HEALTH CENTRE", 21_000_000, 600_000, 1],
  [45, "MAPLE LEAF YOUTH ASSOCIATION", 24_010_000, 24_000_000, 1],
  [46, "COASTAL RESEARCH INSTITUTE", 14_850_000, 15_000_000, 1],
  // An agreement last year, but worth nothing: not new
  [47, "QUIET VALLEY HOUSING CO-OPERATIVE", 8_000_000, 0, 1],
].map(([id, name, value, previous_value, previous_count]) => ({
  id: id as number,
  name: name as string,
  value: value as number,
  count: 1,
  previous_value: previous_value as number,
  previous_count: previous_count as number,
}));

const largest = {
  id: 7,
  reference: "GC-0007",
  value: 150_000_000,
  year_value: 150_000_000,
  recipient_id: 42,
  recipient_name: "NORTHERN LIGHTS ARTS COUNCIL",
  recipient_is_placeholder: false,
};

/** Agreements' values in the year they started */
const started = basis({
  ytd: {
    value: 412_000_000,
    count: 945,
    previous_value: 368_000_000,
    previous_count: 1673,
    largest,
  },
  by_year: [
    { fiscal_year: 2024, value: 2_810_000_000, count: 5660, largest_value: 1 },
    { fiscal_year: 2025, value: 2_530_000_000, count: 4000, largest_value: 2 },
    {
      fiscal_year: 2026,
      value: 412_000_000,
      count: 945,
      largest_value: 150_000_000,
    },
  ],
  new: newcomers,
  movers,
});

/** Spread over their terms, as the page first shows them */
const annualized = basis({
  ytd: {
    value: 500_000_000,
    count: 2310,
    previous_value: 400_000_000,
    previous_count: 2250,
    // Part of a bigger agreement
    largest: { ...largest, value: 600_000_000 },
  },
  by_year: [
    [2024, 2_700_000_000, 8000, 50_000_000],
    [2025, 2_900_000_000, 8495, 60_000_000],
    [2026, 500_000_000, 2310, 150_000_000],
  ].map(([fiscal_year, value, count, largest_value]) => ({
    fiscal_year: fiscal_year!,
    value: value!,
    count: count!,
    largest_value: largest_value!,
  })),
  new: newcomers,
  movers,
});

const federal = summary({
  started,
  annualized,
  latest,
  last_import: {
    date: "2026-09-16",
    count: 2870,
    value: 4_120_000_000,
    files: 12,
  },
  mix,
});

// The agreements behind this year's figures: running in it, or started
const active = "sort=-value&f=start_date:lte:2026-06-30&f=end_date:gte:2026-04-01";
const startedThen = "sort=-value&f=start_date:between:2026-04-01,2026-06-30";

describe("an overview's figures", () => {
  beforeEach(() => {
    server.use(
      api.get("/api/organization/:organization_id/summary", () => HttpResponse.json(federal)),
    );
  });

  it("compares this year to date with the same point last year, either way", async () => {
    const { user } = renderApp("/organization/2");
    const funding = await panel("Funding over time");
    // Spread over agreements' terms, unless the user picked otherwise
    expect(screen.getByRole("radio", { name: "Annualized" })).toBeChecked();
    expect(
      screen.getByText("Each agreement's value is spread evenly over its term."),
    ).toBeVisible();
    expect(funding.getByText(/in FY2026 to 2026-06-30/).textContent).toBe(
      "$500.00M in FY2026 to 2026-06-30, up 25% on the same point in FY2025 ($400.00M)",
    );
    expect(funding.getByText(/^2,310 agreements/)).toHaveTextContent(
      "2,310 agreements active, up 3% (2,250)",
    );
    // Part of one agreement, 30% of it
    expect(funding.getByText(/^Includes/)).toHaveTextContent(
      "Includes $150.00M (30% of it) from one $600.00M agreement, to NORTHERN LIGHTS ARTS COUNCIL.",
    );
    let table = funding.getByRole("table", {
      name: "Value of agreements by fiscal year",
    });
    expect(headers(table)).toEqual([
      "Fiscal year",
      "Value",
      "Agreements active",
      "Largest from one agreement",
    ]);
    // This year marked as so far
    expect(rows(table)).toEqual([
      ["FY2024", "$2.70B", "8,000", "$50.00M"],
      ["FY2025", "$2.90B", "8,495", "$60.00M"],
      ["FY2026 (to date)", "$500.00M", "2,310", "$150.00M"],
    ]);

    // By the year agreements started
    await user.click(screen.getByRole("radio", { name: "By start year" }));
    expect(funding.getByText(/in FY2026 to 2026-06-30/).textContent).toBe(
      "$412.00M in FY2026 to 2026-06-30, up 12% on the same point in FY2025 ($368.00M)",
    );
    expect(funding.getByText(/^945 agreements/)).toHaveTextContent(
      "945 agreements started, down 44% (1,673)",
    );
    // One agreement, a third of it
    expect(funding.getByText(/^Includes/)).toHaveTextContent(
      "Includes one $150.00M agreement (36% of it), to NORTHERN LIGHTS ARTS COUNCIL.",
    );
    table = funding.getByRole("table", {
      name: "Value of agreements by fiscal year",
    });
    expect(headers(table)).toEqual([
      "Fiscal year",
      "Value",
      "Agreements started",
      "Largest agreement",
    ]);
    expect(rows(table)).toEqual([
      ["FY2024", "$2.81B", "5,660", "$1.00"],
      ["FY2025", "$2.53B", "4,000", "$2.00"],
      ["FY2026 (to date)", "$412.00M", "945", "$150.00M"],
    ]);
    expect(
      screen.getByText("Each agreement's value counts in the fiscal year it started."),
    ).toBeVisible();
  });

  it("remembers which way the user picked", async () => {
    const { user } = renderApp("/organization/2");
    await panel("Funding over time");
    await user.click(screen.getByRole("radio", { name: "By start year" }));
    // Picking it again leaves it picked
    await user.click(screen.getByRole("radio", { name: "By start year" }));
    expect(screen.getByRole("radio", { name: "By start year" })).toBeChecked();
    expect(localStorage.getItem("overview.basis")).toBe("started");
  });

  it("opens on the way the user picked last", async () => {
    localStorage.setItem("overview.basis", "started");
    renderApp("/organization/2");
    const funding = await panel("Funding over time");
    expect(screen.getByRole("radio", { name: "By start year" })).toBeChecked();
    expect(funding.getByText(/^945 agreements started/)).toBeVisible();
  });

  it("says what's new, leading to it", async () => {
    renderApp("/organization/2");
    const news = await panel("What's new");
    // The agreements it brought
    expect(news.getByRole("link", { name: "2026-09-16" })).toHaveAttribute(
      "href",
      "/organization/2/award?f=import_date:equals:2026-09-16",
    );
    expect(news.getByText(/from 12 files/).textContent).toBe(
      "Data loaded 2026-09-16: 2,870 agreements ($4.12B) from 12 files",
    );
    const latest = news.getByRole("table", { name: "Latest agreements" });
    expect(rows(latest)).toEqual([
      ["NORTHERN LIGHTS ARTS COUNCILStarted 2026-08-01 · Canadian Heritage", "$50K"],
    ]);
    // The agreement, among the department's agreements with the recipient
    expect(
      within(latest).getByRole("link", { name: "NORTHERN LIGHTS ARTS COUNCIL" }),
    ).toHaveAttribute(
      "href",
      "/organization/2/ministry/16/recipient/42?f=reference:equals:GC-0009",
    );
    // The latest first, up to the server's today (not the future-dated ones)
    expect(news.getByRole("link", { name: "See all" })).toHaveAttribute(
      "href",
      `/organization/2/award?sort=-start_date&f=start_date:lte:${federal.today}`,
    );

    const newcomers = await panel("New recipients");
    expect(newcomers.getByText(/so far this year/)).toHaveTextContent(
      "96 recipients so far this year",
    );
    expect(newcomers.getByText("First agreements in FY2026 to 2026-06-30")).toBeVisible();
    // Its agreements this year
    expect(newcomers.getByRole("link", { name: "PRAIRIE FOOD BANK SOCIETY" })).toHaveAttribute(
      "href",
      `/organization/2/recipient/43/awards?${active}`,
    );
  });

  it("marks a placeholder among the latest", async () => {
    server.use(
      api.get("/api/organization/:organization_id/summary", () =>
        HttpResponse.json(
          summary({
            ...federal,
            latest: [
              {
                ...latest[0]!,
                id: 10,
                recipient_id: 9,
                recipient_name: "INDIVIDUAL RECIPIENT (NAME WITHHELD)",
                recipient_is_placeholder: true,
              },
              latest[0]!,
            ],
          }),
        ),
      ),
    );
    renderApp("/organization/2");
    const table = (await panel("What's new")).getByRole("table", {
      name: "Latest agreements",
    });
    const [withheld, named] = within(table).getAllByRole("row").slice(1);
    expect(within(withheld!).getByText("Placeholder")).toBeVisible();
    expect(within(named!).queryByText("Placeholder")).toBeNull();
  });

  it("ranks this year's biggest recipients against last year", async () => {
    const { user } = renderApp("/organization/2");
    const biggest = await panel("Biggest recipients this year");
    expect(
      biggest.getByText(
        "By agreements' value in FY2026 to 2026-06-30, spread over their terms, against the same point in FY2025",
      ),
    ).toBeVisible();
    const table = biggest.getByRole("table", {
      name: "Biggest recipients this year",
    });
    expect(rows(table).map((row) => [row[0], row.at(-1)])).toEqual([
      ["NORTHERN LIGHTS ARTS COUNCIL1 agreement active", "▲ 200%"],
      ["PRAIRIE FOOD BANK SOCIETY1 agreement active", "New"],
      ["RIVERSIDE COMMUNITY HEALTH CENTRE1 agreement active", "▲ 35×"],
      ["MAPLE LEAF YOUTH ASSOCIATION1 agreement active", "Unchanged"],
      ["COASTAL RESEARCH INSTITUTE1 agreement active", "▼ 1%"],
      ["QUIET VALLEY HOUSING CO-OPERATIVE1 agreement active", "–"],
    ]);
    // Its agreements behind the figures, running this year
    const riverside = within(table).getByRole("link", {
      name: "RIVERSIDE COMMUNITY HEALTH CENTRE",
    });
    expect(riverside).toHaveAttribute("href", `/organization/2/recipient/44/awards?${active}`);
    // Or started this year
    await user.click(screen.getByRole("radio", { name: "By start year" }));
    expect(
      within(table).getByRole("link", {
        name: "RIVERSIDE COMMUNITY HEALTH CENTRE",
      }),
    ).toHaveAttribute("href", `/organization/2/recipient/44/awards?${startedThen}`);
  });

  it("shows grants against contributions, for agreements", async () => {
    renderApp("/organization/2");
    const mixed = await panel("Grants and contributions");
    expect(mixed.getByText(/of agreements so far this year/)).toHaveTextContent(
      "Grant: 37% of agreements so far this year (45% in FY2025)",
    );
    const table = mixed.getByRole("table", { name: "Agreements by type" });
    expect(headers(table)).toEqual(["Fiscal year", "Grant", "Contribution"]);
    expect(rows(table)).toEqual([
      ["FY2025", "1,800 (45%)", "2,200 (55%)"],
      ["FY2026 (to date)", "350 (37%)", "600 (63%)"],
    ]);
    expect(mixed.getByText("* FY2026 so far.")).toBeVisible();
  });

  it("leaves out a mix of one, and says when there's nothing yet", async () => {
    server.use(
      api.get("/api/organization/:organization_id/summary", () =>
        HttpResponse.json(
          summary({
            annualized: basis({
              ytd: { ...annualized.ytd, value: 0, count: 0, largest: null },
              by_year: annualized.by_year.slice(0, 2),
            }),
          }),
        ),
      ),
    );
    renderApp("/organization/2");
    const funding = await panel("Funding over time");
    expect(funding.getByText(/^No agreements/)).toHaveTextContent(
      "No agreements active yet in FY2026. By this point in FY2025: $400.00M (2,250 agreements).",
    );
    expect(
      (await panel("Biggest recipients this year")).getByText("No agreements so far this year."),
    ).toBeVisible();
    expect((await panel("What's new")).getByText("No agreements yet.")).toBeVisible();
    expect(screen.queryByText("Grants and contributions")).not.toBeInTheDocument();
  });

  it("notes the yearly totals published without a date", async () => {
    server.use(
      api.get("/api/organization/:organization_id/summary", () =>
        HttpResponse.json(
          summary({
            ...federal,
            undated: {
              value: 12_500_000,
              count: 40,
              previous_value: 11_000_000,
              previous_count: 38,
            },
          }),
        ),
      ),
    );
    renderApp("/organization/2");
    const funding = await panel("Funding over time");
    expect(funding.getByText(/^Leaves out/)).toHaveTextContent(
      "Leaves out yearly totals published without a date: $12.50M in FY2026 and $11.00M in FY2025. The chart includes them.",
    );
  });

  it("says nothing of undated totals when there are none", async () => {
    renderApp("/organization/2");
    const funding = await panel("Funding over time");
    expect(funding.queryByText(/without a date/)).toBeNull();
  });

  it("counts Alberta's payments on the day they were made", async () => {
    // No term to spread them over: one way to count them, whatever the user
    // picked for agreements
    server.use(
      api.get("/api/organization/:organization_id/summary", () =>
        HttpResponse.json(
          summary({
            started,
            // Not what the page shows for payments
            annualized,
            latest: [
              {
                ...latest[0]!,
                reference: null,
                agreement_type: null,
                ministry_id: 21,
                ministry_name: "Arts, Culture and Status of Women",
              },
            ],
            last_import: federal.last_import,
            mix: null,
          }),
        ),
      ),
    );
    renderApp("/organization/1");
    const funding = await panel("Funding over time");
    expect(screen.queryByRole("radio", { name: "Annualized" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "By start year" })).not.toBeInTheDocument();
    expect(
      funding.getByText("Payments by the fiscal year they were made in, to 2026-06-30"),
    ).toBeVisible();
    expect(funding.getByText(/in FY2026 to 2026-06-30/).textContent).toBe(
      "$412.00M in FY2026 to 2026-06-30, up 12% on the same point in FY2025 ($368.00M)",
    );
    expect(funding.getByText(/^945 payments/)).toHaveTextContent("945 payments, down 44% (1,673)");
    expect(funding.getByText(/^Includes/)).toHaveTextContent(
      "Includes one $150.00M payment (36% of it), to NORTHERN LIGHTS ARTS COUNCIL.",
    );
    const table = funding.getByRole("table", {
      name: "Value of payments by fiscal year",
    });
    expect(headers(table)).toEqual(["Fiscal year", "Value", "Payments", "Largest payment"]);

    const news = await panel("What's new");
    expect(news.getByText(/from 12 files/).textContent).toBe(
      "Data loaded 2026-09-16: 2,870 payments ($4.12B) from 12 files",
    );
    expect(rows(news.getByRole("table", { name: "Latest payments" }))).toEqual([
      ["NORTHERN LIGHTS ARTS COUNCILPaid 2026-08-01 · Arts, Culture and Status of Women", "$50K"],
    ]);
    // A payment by the day it was made, which is all that names one
    expect(news.getByRole("link", { name: "NORTHERN LIGHTS ARTS COUNCIL" })).toHaveAttribute(
      "href",
      "/organization/1/ministry/21/recipient/42?f=start_date:equals:2026-08-01",
    );

    const biggest = await panel("Biggest recipients this year");
    expect(
      biggest.getByText("By payments in FY2026 to 2026-06-30, against the same point in FY2025"),
    ).toBeVisible();
    const table2 = biggest.getByRole("table", {
      name: "Biggest recipients this year",
    });
    expect(rows(table2)[0]![0]).toBe("NORTHERN LIGHTS ARTS COUNCIL1 payment");
    // Its payments this year, leaving out the yearly totals without a date
    expect(
      within(table2).getByRole("link", {
        name: "RIVERSIDE COMMUNITY HEALTH CENTRE",
      }),
    ).toHaveAttribute(
      "href",
      `/organization/1/recipient/44/awards?${startedThen}&f=start_date_estimated:equals:false`,
    );
    expect(
      (await panel("New recipients")).getByText("First payments in FY2026 to 2026-06-30"),
    ).toBeVisible();
    // Payments have no types to compare
    expect(screen.queryByText("Grants and contributions")).not.toBeInTheDocument();
  });

  it("on a department's page, leads to a recipient's agreements with it", async () => {
    server.use(
      api.get("/api/organization/:organization_id/ministry/:ministry_id/summary", () =>
        HttpResponse.json(
          summary({
            scope: "ministry",
            annualized: basis({ ytd: annualized.ytd, movers: [movers[2]!] }),
            latest,
          }),
        ),
      ),
    );
    renderApp("/organization/2/ministry/16");
    expect(
      (await panel("Biggest recipients this year")).getByRole("link", {
        name: "RIVERSIDE COMMUNITY HEALTH CENTRE",
      }),
    ).toHaveAttribute("href", `/organization/2/ministry/16/recipient/44?${active}`);
    const news = await panel("What's new");
    // Within the department: not named again
    expect(rows(news.getByRole("table", { name: "Latest agreements" }))).toEqual([
      ["NORTHERN LIGHTS ARTS COUNCILStarted 2026-08-01", "$50K"],
    ]);
    expect(news.getByRole("link", { name: "See all" })).toHaveAttribute(
      "href",
      "/organization/2/ministry/16/award?sort=-start_date&f=start_date:lte:2026-10-07",
    );
  });

  it("on a program's page, leads to a recipient's agreements in it", async () => {
    server.use(
      api.get(
        "/api/organization/:organization_id/ministry/:ministry_id/program/:program_id/summary",
        () =>
          HttpResponse.json(
            summary({
              scope: "program",
              annualized: basis({
                ytd: annualized.ytd,
                movers: [movers[2]!],
                new: newcomers,
              }),
              latest,
            }),
          ),
      ),
    );
    renderApp("/organization/2/ministry/16/program/5");
    expect(
      (await panel("Biggest recipients this year")).getByRole("link", {
        name: "RIVERSIDE COMMUNITY HEALTH CENTRE",
      }),
    ).toHaveAttribute("href", `/organization/2/ministry/16/program/5/recipient/44?${active}`);
    expect(
      (await panel("New recipients")).getByRole("link", {
        name: "PRAIRIE FOOD BANK SOCIETY",
      }),
    ).toHaveAttribute("href", `/organization/2/ministry/16/program/5/recipient/43?${active}`);
    expect((await panel("What's new")).getByRole("link", { name: "See all" })).toHaveAttribute(
      "href",
      "/organization/2/ministry/16/program/5/award?sort=-start_date&f=start_date:lte:2026-10-07",
    );
  });

  it("on a recipient's page, follows its departments", async () => {
    server.use(
      api.get("/api/organization/:organization_id/recipient/:recipient_id/summary", () =>
        HttpResponse.json(
          summary({
            scope: "recipient",
            counterpart: "ministry",
            // Without a reference
            latest: [{ ...latest[0]!, reference: null }],
            annualized: basis({
              ytd: annualized.ytd,
              movers: [{ ...movers[0]!, id: 16, name: "Canadian Heritage" }],
            }),
          }),
        ),
      ),
    );
    renderApp("/organization/2/recipient/42");
    // Its agreements with the department behind the figures
    const departments = await panel("Biggest departments this year");
    expect(departments.getByRole("columnheader", { name: "Department" })).toBeVisible();
    expect(departments.getByRole("link", { name: "Canadian Heritage" })).toHaveAttribute(
      "href",
      `/organization/2/ministry/16/recipient/42?${active}`,
    );
    const newest = (await panel("What's new")).getByRole("table", {
      name: "Latest agreements",
    });
    // The department, not the recipient whose page it is; the agreement by
    // the day it started
    expect(rows(newest)).toEqual([["Canadian HeritageStarted 2026-08-01", "$50K"]]);
    expect(within(newest).getByRole("link", { name: "Canadian Heritage" })).toHaveAttribute(
      "href",
      "/organization/2/ministry/16/recipient/42?f=start_date:equals:2026-08-01",
    );
    expect((await panel("First-time departments")).getByText(/so far this year/)).toHaveTextContent(
      "0 departments so far this year",
    );
    // Its own agreement, not named again
    expect((await panel("Funding over time")).getByText(/^Includes/)).toHaveTextContent(
      "Includes $150.00M (30% of it) from one $600.00M agreement.",
    );
  });

  it("draws its charts, marking the year so far", async () => {
    renderApp("/organization/2");
    const funding = await panel("Funding over time");
    const chart = funding.getByRole("img", {
      name: /^Value of agreements by fiscal year/,
    });
    expect(await within(chart).findByText("FY26*")).toBeInTheDocument();
    expect(within(chart).getByText("FY25")).toBeInTheDocument();
    // This year's bar, lighter (once the bars have grown in)
    await waitFor(() => {
      const bars = chart.querySelectorAll(".recharts-bar-rectangle path");
      expect(bars).toHaveLength(3);
      expect([...bars].map((bar) => bar.getAttribute("fill-opacity") ?? "1")).toEqual([
        "1",
        "1",
        "0.45",
      ]);
    });
  });

  it("speaks of a finished year by its name", async () => {
    // Data published a quarter late runs to March 31, the end of FY2025,
    // which is over
    server.use(
      api.get("/api/organization/:organization_id/summary", () =>
        HttpResponse.json(
          summary({
            ...federal,
            fiscal_year: 2025,
            through: "2026-03-31",
            previous_through: "2025-03-31",
            annualized: basis({
              ...annualized,
              by_year: annualized.by_year.slice(0, 2),
            }),
          }),
        ),
      ),
    );
    renderApp("/organization/2");
    const funding = await panel("Funding over time");
    expect(funding.getByText(/in FY2025, /).textContent).toBe(
      "$500.00M in FY2025, up 25% on FY2024 ($400.00M)",
    );
    expect(
      rows(
        funding.getByRole("table", {
          name: "Value of agreements by fiscal year",
        }),
      ).map(([year]) => year),
    ).toEqual(["FY2024", "FY2025"]);
    expect(funding.getByText("Fiscal years run April to March.")).toBeVisible();
    await panel("Biggest recipients in FY2025");
    expect((await panel("New recipients")).getByText(/^recipients in FY2025$/)).toBeVisible();
  });

  it("titles a recipient's panels for its departments while they load", async () => {
    server.use(
      api.get(
        "/api/organization/:organization_id/recipient/:recipient_id/summary",
        () => new Promise<never>(() => {}),
      ),
    );
    renderApp("/organization/2/recipient/42");
    expect(
      await screen.findByText("Biggest departments this year", {
        selector: '[data-slot="card-title"]',
      }),
    ).toBeVisible();
    expect(
      screen.getByText("First-time departments", {
        selector: '[data-slot="card-title"]',
      }),
    ).toBeVisible();
  });

  it("keeps the page's cards when its figures can't be loaded", async () => {
    let failing = true;
    server.use(
      api.get("/api/organization/:organization_id/summary", () =>
        failing ? HttpResponse.json(null, { status: 500 }) : HttpResponse.json(federal),
      ),
    );
    const { user } = renderApp("/organization/2");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This page's figures couldn't be loaded.");
    expect(Object.keys(await cards())).toEqual(["Agreements", "Departments", "Recipients"]);
    failing = false;
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await panel("Funding over time")).toBeTruthy();
  });
});
