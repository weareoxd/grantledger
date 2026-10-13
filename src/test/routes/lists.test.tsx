import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw/http";
import { describe, expect, it, vi } from "vitest";

import type { Award } from "@/lib/api/types";
import { award, envelope } from "@/test/fixtures";
import { api } from "@/test/msw/api";
import { server } from "@/test/msw/server";
import { renderApp } from "@/test/next-router";

const AWARDS = "/api/organization/:organization_id/award";

/** An Alberta payment: cash on a date, to a ministry's recipient */
const payment = (id: number, overrides: Partial<Award> = {}) =>
  award(id, {
    record_kind: "payment",
    reference: null,
    agreement_number: null,
    ministry: "Arts, Culture and Status of Women",
    ministry_id: 21,
    program: "Community Facility Enhancement Program",
    program_id: 30,
    end_date: null,
    agreement_type: null,
    title: null,
    description: null,
    recipient_type: null,
    recipient_province: null,
    recipient_city: null,
    amendment_number: null,
    ...overrides,
  });

/** Serve award lists, recording each request's query */
function serveAwards(
  respond: (query: URLSearchParams) => Response | object = () =>
    envelope([award(1), award(2)], {
      organization: "Government of Canada",
      footer_totals: { value: 3000 },
    }),
) {
  const requests: URLSearchParams[] = [];
  server.use(
    api.get(AWARDS, ({ request }) => {
      const query = new URL(request.url).searchParams;
      requests.push(query);
      const result = respond(query);
      return result instanceof Response ? result : HttpResponse.json(result);
    }),
  );
  return requests;
}

/** Answer exports with a CSV, as the API streams it, recording each one */
function serveExports(headers: Record<string, string>) {
  const exported: { query: Record<string, string>; body: unknown }[] = [];
  server.use(
    api.post(AWARDS, async ({ request }) => {
      exported.push({
        query: Object.fromEntries(new URL(request.url).searchParams),
        body: await request.json(),
      });
      return new HttpResponse("\ufeffRecipient\r\nRECIPIENT 1\r\n", {
        headers: { "Content-Type": "text/csv; charset=utf-8", ...headers },
      }) as never;
    }),
  );
  return exported;
}

/** Catch the file an export saves, rather than download it */
function catchDownloads() {
  const createObjectURL = vi.fn((_: Blob) => "blob:export");
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  return { createObjectURL, click };
}

const lastRequest = (requests: URLSearchParams[]) => Object.fromEntries(requests.at(-1)!);

/** The table's column headers, in order */
const columnHeaders = () => screen.getAllByRole("columnheader").map((header) => header.textContent);

describe("an award list", () => {
  it("loads the first page in the default order, with totals", async () => {
    const requests = serveAwards();
    renderApp("/organization/2/award");

    expect(await screen.findByText("RECIPIENT 1")).toBeVisible();
    // The latest first
    expect(lastRequest(requests)).toEqual({
      page: "1",
      page_size: "25",
      sort: "start_date",
      sort_order: "desc",
    });
    const footer = screen.getAllByRole("rowgroup").at(-1)!;
    expect(within(footer).getByText("$3,000.00")).toBeVisible();
    expect(screen.getByText("1–2 of 2 agreements")).toBeVisible();
    expect(screen.getByRole("heading", { level: 1, name: "Agreements (2)" })).toBeVisible();
    expect(document.title).toBe("Agreements · Government of Canada · GrantLedger");
  });

  it("shows the columns of the organization's kind of record", async () => {
    // Federal agreements: a value committed over a term, with a reference
    serveAwards();
    const { unmount } = renderApp("/organization/2/award");
    await screen.findByText("RECIPIENT 1");
    expect(columnHeaders()).toEqual([
      "Recipient",
      "Department",
      "Program",
      "Reference",
      "Agreement value",
      "Start date",
      "End date",
      "Fiscal year",
      "Agreement type",
      "Title",
    ]);
    // Its type by name, not code
    const first = screen.getByText("RECIPIENT 1").closest("tr")!;
    expect(within(first).getByText("Grant")).toBeVisible();
    unmount();

    // Alberta's payments: cash on a date
    serveAwards(() => envelope([payment(1)], { organization: "Government of Alberta" }));
    renderApp("/organization/1/award");
    await screen.findByText("RECIPIENT 1");
    expect(columnHeaders()).toEqual([
      "Recipient",
      "Ministry",
      "Program",
      "Amount paid",
      "Payment date",
      "Fiscal year",
      "Lottery fund",
    ]);
    expect(screen.getByRole("heading", { level: 1, name: "Payments (1)" })).toBeVisible();
    expect(screen.getByText("1–1 of 1 payment")).toBeVisible();
  });

  it("marks a payment published without a date, and a placeholder recipient", async () => {
    serveAwards(() =>
      envelope(
        [
          payment(1, {
            start_date: "2024-04-01",
            start_date_estimated: true,
          }),
          payment(2, {
            recipient: "INDIVIDUAL RECIPIENT (NAME WITHHELD)",
            recipient_is_placeholder: true,
          }),
        ],
        { organization: "Government of Alberta" },
      ),
    );
    renderApp("/organization/1/award");
    const estimated = (await screen.findByText("RECIPIENT 1")).closest("tr")!;
    // The first day of its fiscal year, which the importer gave it
    expect(within(estimated).getByText(/^2024-04-01/)).toHaveTextContent("2024-04-01 (est.)");
    expect(within(estimated).queryByText("Placeholder")).toBeNull();

    const withheld = screen.getByText("INDIVIDUAL RECIPIENT (NAME WITHHELD)").closest("td")!;
    expect(within(withheld).getByText("Placeholder")).toBeVisible();
  });

  it("sorts by a column, largest amounts first", async () => {
    const requests = serveAwards();
    const { user, router } = renderApp("/organization/2/award");
    await screen.findByText("RECIPIENT 1");

    await user.click(screen.getByRole("button", { name: /^Agreement value/ }));

    await waitFor(() => expect(router.state.location.searchStr).toBe("?sort=-value"));
    await waitFor(() =>
      expect(lastRequest(requests)).toMatchObject({
        sort: "value",
        sort_order: "desc",
      }),
    );
    expect(screen.getByRole("columnheader", { name: /Agreement value/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });

  it("filters from a column header, back on the first page", async () => {
    const requests = serveAwards();
    const { user, router } = renderApp("/organization/2/award?page=3");
    await screen.findByText("RECIPIENT 1");

    await user.click(screen.getByRole("button", { name: "Filter by Recipient" }));
    await user.type(await screen.findByRole("textbox", { name: "Value" }), "society");
    await user.click(screen.getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(router.state.location.searchStr).toBe("?f=recipient:contains:society"),
    );
    await waitFor(() =>
      expect(lastRequest(requests)).toMatchObject({
        page: "1",
        "recipient[0][value]": "society",
        "recipient[0][matchMode]": "contains",
      }),
    );
    // Shown above the table, where it can only be removed: it's changed
    // from the column's filter button
    const chips = await screen.findByLabelText("Filters");
    expect(within(chips).getByText("Recipient contains “society”")).toBeVisible();
    expect(
      within(chips)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label") ?? button.textContent),
    ).toEqual(["Remove filter: Recipient contains “society”", "Clear filters"]);
  });

  it("resizes a column, and remembers its width", async () => {
    serveAwards();
    const { user, unmount } = renderApp("/organization/2/award");
    await screen.findByText("RECIPIENT 1");
    // Widths are set on the table, for its cells to read
    const width = (id: string) => screen.getByRole("table").style.getPropertyValue(`--width-${id}`);
    const remembered = () =>
      Object.values({ ...localStorage }).find((value) => value.includes('"recipient"'));

    const handle = screen.getByRole("separator", {
      name: "Resize Agreement value",
    });
    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 100 } },
      { coords: { clientX: 220 } },
      { keys: "[/MouseLeft]" },
    ]);
    // (jsdom lays nothing out: the column starts at no width)
    expect(width("value")).toBe("120px");
    expect(handle.closest("th")!.style.width).toBe("var(--width-value)");

    // The frozen column too, which stays in view at its new width. Its
    // cells follow the pointer before it's let go, and it's remembered once
    // it is
    const recipient = screen.getByRole("separator", {
      name: "Resize Recipient",
    });
    const cell = screen.getByText("RECIPIENT 1").closest("td")!;
    await user.pointer([
      { keys: "[MouseLeft>]", target: recipient, coords: { clientX: 100 } },
      { coords: { clientX: 400 } },
    ]);
    await waitFor(() => expect(width("recipient")).toBe("300px"));
    expect(cell.style.width).toBe("var(--width-recipient)");
    expect(remembered()).toBeUndefined();
    await user.pointer({ keys: "[/MouseLeft]" });
    expect(remembered()).toContain('"recipient":300');

    // A click on the edge, even one that wobbles, changes nothing
    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 100 } },
      { coords: { clientX: 102 } },
      { keys: "[/MouseLeft]" },
    ]);
    expect(width("value")).toBe("120px");

    // Kept for award lists, next time: a ministry's too
    unmount();
    server.use(
      api.get("/api/organization/:organization_id/ministry/:ministry_id/award", () =>
        HttpResponse.json(
          envelope([award(1)], {
            organization: "Government of Canada",
            ministry: "Canadian Heritage",
          }),
        ),
      ),
    );
    renderApp("/organization/2/ministry/16/award");
    await screen.findByText("RECIPIENT 1");
    expect(width("value")).toBe("120px");

    // Double-click: fits its content again
    await user.dblClick(screen.getByRole("separator", { name: "Resize Agreement value" }));
    expect(width("value")).toBe("");
  });

  it("stops resizing once the button's up, wherever that was heard", async () => {
    serveAwards();
    const { user } = renderApp("/organization/2/award");
    await screen.findByText("RECIPIENT 1");
    const handle = screen.getByRole("separator", {
      name: "Resize Agreement value",
    });
    const width = () => screen.getByRole("table").style.getPropertyValue("--width-value");

    await user.pointer([
      { keys: "[MouseLeft>]", target: handle, coords: { clientX: 100 } },
      { coords: { clientX: 200 } },
    ]);
    await waitFor(() => expect(width()).toBe("100px"));
    // Another pointer (a second finger) doesn't move it
    fireEvent.pointerMove(window, { pointerId: 2, buttons: 1, clientX: 500 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(width()).toBe("100px");
    // Let go over a context menu: the next move has no button down
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 0, clientX: 300 });
    fireEvent.pointerMove(window, { pointerId: 1, buttons: 1, clientX: 400 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(width()).toBe("100px");
  });

  it("keeps the first column in view", async () => {
    serveAwards();
    const { unmount } = renderApp("/organization/2/award");
    const table = () => screen.getByRole("table");
    const row = (await screen.findByText("RECIPIENT 1")).closest("tr")!;
    const [recipient, department] = row.children as unknown as HTMLElement[];
    expect(recipient!.style.position).toBe("sticky");
    expect(recipient!.style.left).toBe("var(--left-recipient)");
    expect(table().style.getPropertyValue("--left-recipient")).toBe("0px");
    // At its own width, until it's given another
    expect(table().style.getPropertyValue("--width-recipient")).toBe("260px");
    // The rest scroll under it
    expect(department!.style.position).toBe("");
    unmount();

    // With the recipient column hidden, the first one shown stays instead
    renderApp("/organization/2/award?cols=ministry,value");
    const ministry = (await screen.findAllByText("Canadian Heritage"))
      .map((element) => element.closest("td"))
      .find(Boolean)!;
    expect(ministry.style.position).toBe("sticky");
    expect(table().style.getPropertyValue("--left-ministry")).toBe("0px");
    expect(table().style.getPropertyValue("--width-ministry")).toBe("220px");
  });

  it("leaves the width the columns don't fill to an empty last one", async () => {
    // (so columns given widths aren't stretched past them: jsdom lays
    // nothing out, but the column must be there, in every row)
    serveAwards();
    const { unmount } = renderApp("/organization/2/award");
    await screen.findByText("RECIPIENT 1");
    const table = screen.getByRole("table");
    const headerCells = table.querySelector("thead tr")!.children;
    for (const row of table.querySelectorAll("tr")) {
      expect(row.lastElementChild).toHaveAttribute("aria-hidden", "true");
      expect(row.children).toHaveLength(headerCells.length);
    }
    unmount();

    // And across the message of an empty list
    serveAwards(() => envelope([], { organization: "Government of Canada" }));
    renderApp("/organization/2/award");
    const empty = (await screen.findByText("No agreements")).closest("td")!;
    expect(empty).toHaveAttribute(
      "colspan",
      String(screen.getByRole("table").querySelector("thead tr")!.children.length),
    );
  });

  it("wraps text, but not numbers or dates", async () => {
    serveAwards();
    renderApp("/organization/2/award");
    const recipient = (await screen.findByText("RECIPIENT 1")).closest("td")!;
    const row = recipient.closest("tr")!;
    const headers = screen.getAllByRole("columnheader");
    const cellUnder = (header: string) =>
      row.children[headers.findIndex((th) => th.textContent?.startsWith(header))]!;
    // Long words too
    expect(recipient).toHaveClass("wrap-anywhere");
    expect(recipient).not.toHaveClass("whitespace-nowrap");
    expect(cellUnder("Agreement value")).toHaveClass("whitespace-nowrap");
    expect(cellUnder("Start date")).toHaveClass("whitespace-nowrap");
    expect(cellUnder("Fiscal year")).toHaveClass("whitespace-nowrap");
  });

  it("removes a filter from its chip, back on the first page", async () => {
    serveAwards();
    const { user, router } = renderApp("/organization/2/award?page=2&f=value:gte:1000");
    await screen.findByText("RECIPIENT 1");

    await user.click(
      screen.getByRole("button", {
        name: "Remove filter: Agreement value ≥ $1,000.00",
      }),
    );

    await waitFor(() => expect(router.state.location.searchStr).toBe(""));
  });

  it("points out a filter the API rejects", async () => {
    serveAwards((query) =>
      query.has("value[0][value]")
        ? HttpResponse.json({ value: ["Invalid value for 'value'."] }, { status: 400 })
        : envelope([award(1)], { organization: "Government of Canada" }),
    );
    renderApp("/organization/2/award?f=value:gte:abc");

    expect(await screen.findByText(/Some filters aren't valid/)).toBeVisible();
    expect(screen.getByTitle("Invalid value for 'value'.")).toBeVisible();
  });

  it("goes to the first page when the page is past the end", async () => {
    serveAwards((query) =>
      query.get("page") === "9"
        ? HttpResponse.json({ detail: "Invalid page." }, { status: 404 })
        : envelope([award(1)], { organization: "Government of Canada" }),
    );
    const { router } = renderApp("/organization/2/award?page=9");

    await waitFor(() => expect(router.state.location.searchStr).toBe(""));
    expect(await screen.findByText("RECIPIENT 1")).toBeVisible();
  });

  it("exports every matching row as the API writes it", async () => {
    const rows = Array.from({ length: 7 }, (_, i) => award(i + 1));
    serveAwards(() => envelope(rows, { organization: "Government of Canada" }));
    const exported = serveExports({
      "X-Total-Count": "7",
      "X-Export-Rows": "7",
      "X-Export-Truncated": "false",
    });
    const { createObjectURL, click } = catchDownloads();
    const { user } = renderApp("/organization/2/award?f=recipient:contains:recipient");
    await screen.findByText("RECIPIENT 7");

    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(await screen.findByText("Exported 7 rows")).toBeVisible();
    // The list's filters and sort, and no paging: the API streams every row.
    // The columns shown go in the body, as there can be more than a URL holds
    expect(exported).toHaveLength(1);
    expect(exported[0]!.query).toEqual({
      sort: "start_date",
      sort_order: "desc",
      "recipient[0][value]": "recipient",
      "recipient[0][matchMode]": "contains",
      "recipient[operator]": "and",
    });
    expect(exported[0]!.body).toEqual({
      columns: [
        { id: "recipient", header: "Recipient" },
        { id: "ministry", header: "Department" },
        { id: "program", header: "Program" },
        { id: "reference", header: "Reference" },
        { id: "value", header: "Agreement value" },
        { id: "start_date", header: "Start date" },
        { id: "end_date", header: "End date" },
        { id: "fiscal_year", header: "Fiscal year" },
        { id: "agreement_type", header: "Agreement type" },
        { id: "title", header: "Title" },
      ],
    });
    expect(click).toHaveBeenCalledTimes(1);
    const file = createObjectURL.mock.calls[0]![0];
    expect(await file.text()).toContain("RECIPIENT 1");
  });

  it("exports the fiscal year and toggles too", async () => {
    serveAwards();
    const exported = serveExports({
      "X-Export-Rows": "2",
      "X-Export-Truncated": "false",
    });
    catchDownloads();
    const { user } = renderApp(
      "/organization/2/award?fy=2024&hide_placeholders=1&include_superseded=1",
    );
    await screen.findByText("RECIPIENT 1");

    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(await screen.findByText("Exported 2 rows")).toBeVisible();
    expect(exported[0]!.query).toEqual({
      sort: "start_date",
      sort_order: "desc",
      fiscal_year: "2024",
      hide_placeholders: "true",
      include_superseded: "true",
    });
  });

  it("says why an export failed", async () => {
    serveAwards();
    server.use(
      api.post(AWARDS, () =>
        HttpResponse.json(
          {
            detail: "This query took too long. Narrow the filters or choose a fiscal year.",
          },
          { status: 503 },
        ),
      ),
    );
    const { createObjectURL } = catchDownloads();
    const { user } = renderApp("/organization/2/award");
    await screen.findByText("RECIPIENT 2");

    await user.click(screen.getByRole("button", { name: "Export" }));

    expect(await screen.findByText("Export failed")).toBeVisible();
    expect(
      screen.getByText("This query took too long. Narrow the filters or choose a fiscal year."),
    ).toBeVisible();
    expect(createObjectURL).not.toHaveBeenCalled();
    // Ready to try again
    expect(screen.getByRole("button", { name: "Export" })).toBeEnabled();
  });

  it("asks before a large export, which can be called off", async () => {
    serveAwards(() =>
      envelope([award(1)], {
        count: 60_000,
        organization: "Government of Canada",
      }),
    );
    const exported = serveExports({});
    const { user } = renderApp("/organization/2/award");
    await screen.findByText("RECIPIENT 1");

    await user.click(screen.getByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Export 60,000 rows?",
    });
    // A spreadsheet holds them all
    expect(dialog).not.toHaveTextContent(/Excel/);
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(exported).toEqual([]);
  });

  it("warns when an export stops where Excel does", async () => {
    // Alberta's payments: more than a sheet holds
    serveAwards(() =>
      envelope([payment(1)], {
        count: 2_031_552,
        organization: "Government of Alberta",
      }),
    );
    const exported = serveExports({
      "X-Total-Count": "2031552",
      "X-Export-Rows": "1048575",
      "X-Export-Truncated": "true",
    });
    catchDownloads();
    const { user } = renderApp("/organization/1/award");
    await screen.findByText("RECIPIENT 1");

    await user.click(screen.getByRole("button", { name: "Export" }));
    const dialog = await screen.findByRole("alertdialog", {
      name: "Export 2,031,552 rows?",
    });
    expect(dialog).toHaveTextContent(
      "Excel opens at most 1,048,575 rows, so the file stops there.",
    );
    expect(exported).toEqual([]);
    await user.click(within(dialog).getByRole("button", { name: "Export" }));

    expect(await screen.findByText("Exported the first 1,048,575 rows")).toBeVisible();
    expect(
      screen.getByText(
        "That's as many as Excel opens. Filters narrow the export to the rows you need.",
      ),
    ).toBeVisible();
    expect(exported).toHaveLength(1);
  });

  it("shows an on-or-before date filter in its editor", async () => {
    // As the overviews' "See all" links write it
    serveAwards();
    const { user } = renderApp("/organization/2/award?f=start_date:lte:2026-10-07");
    await screen.findByText("RECIPIENT 1");

    await user.click(screen.getByRole("button", { name: "Filter by Start date (filtered)" }));
    expect(await screen.findByRole("combobox", { name: "Condition 1" })).toHaveTextContent(
      "is on or before",
    );
  });

  it("says a recipient that's gone isn't there, rather than offering a retry", async () => {
    // Since the link was made, the data was loaded again without it
    server.use(
      api.get("/api/organization/:organization_id/recipient/:recipient_id/award", () =>
        HttpResponse.json({ detail: "Recipient not found." }, { status: 404 }),
      ),
    );
    renderApp("/organization/2/recipient/42/awards");

    expect(await screen.findByText("Page not found")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("loads with a filter named as an object's own property", async () => {
    // {}.constructor is a function: read as a filter, the app didn't load
    serveAwards();
    renderApp("/organization/2/award?f=constructor:equals:x&op=__proto__:or");
    expect(await screen.findByText("RECIPIENT 1")).toBeVisible();
  });

  it("says an id that isn't one isn't there", async () => {
    serveAwards();
    for (const url of [
      "/organization/2/recipient/abc/awards",
      "/organization/two/award",
      "/organization/2/ministry/16/program/none/award",
    ]) {
      const { unmount } = renderApp(url);
      expect(await screen.findByText("Page not found")).toBeVisible();
      unmount();
    }
  });

  it("hides a column, and drops its filter", async () => {
    serveAwards();
    const { user, router } = renderApp("/organization/2/award?f=program:contains:x");
    await screen.findByText("RECIPIENT 1");

    await user.click(screen.getByRole("button", { name: /Columns/ }));
    await user.click(await screen.findByRole("option", { name: "Program" }));

    await waitFor(() => {
      const search = router.state.location.search as {
        cols?: string[];
        filters?: object;
      };
      expect(search.cols).not.toContain("program");
      expect(search.cols).toContain("recipient");
      expect(search.filters).toBeUndefined();
    });
    expect(screen.queryByRole("columnheader", { name: /Program/ })).not.toBeInTheDocument();
  });

  it("shows and removes a filter on a field the list doesn't show", async () => {
    // From an old link: no column, and the API refuses it
    const requests = serveAwards((query) =>
      query.has("bogus[0][value]")
        ? HttpResponse.json({ bogus: ["Unknown filter field 'bogus'."] }, { status: 400 })
        : envelope([award(1)], { organization: "Government of Canada" }),
    );
    const { user } = renderApp("/organization/2/award?f=bogus:contains:x");

    const remove = await screen.findByRole("button", {
      name: "Remove filter: bogus contains “x”",
    });
    await user.click(remove);
    expect(await screen.findByText("RECIPIENT 1")).toBeVisible();
    expect(lastRequest(requests)).not.toHaveProperty("bogus[0][value]");
  });

  it("offers the usual order when the sort isn't the list's", async () => {
    const requests = serveAwards((query) =>
      query.get("sort") === "bogus"
        ? HttpResponse.json({ sort: ["Unknown sort field 'bogus'."] }, { status: 400 })
        : envelope([award(1)], { organization: "Government of Canada" }),
    );
    const { user } = renderApp("/organization/2/award?sort=bogus");

    expect(await screen.findByText("This list can't be sorted that way.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Sort as usual" }));
    expect(await screen.findByText("RECIPIENT 1")).toBeVisible();
    expect(lastRequest(requests)).toMatchObject({
      sort: "start_date",
      sort_order: "desc",
    });
  });

  it("drops the sort of a column it hides", async () => {
    serveAwards();
    const { user, router } = renderApp("/organization/2/award?sort=-program");
    await screen.findByText("RECIPIENT 1");

    await user.click(screen.getByRole("button", { name: /Columns/ }));
    await user.click(await screen.findByRole("option", { name: "Program" }));

    await waitFor(() =>
      expect((router.state.location.search as { sort?: string }).sort).toBeUndefined(),
    );
  });

  it("shows its rows when the organizations can't be loaded", async () => {
    serveAwards();
    server.use(api.get("/api/organization", () => HttpResponse.json(null, { status: 500 })));
    renderApp("/organization/2/award");
    expect(await screen.findByText("RECIPIENT 1")).toBeVisible();
    // In the columns either kind of record has, as either calls them
    expect(columnHeaders()).toEqual([
      "Recipient",
      "Ministry",
      "Program",
      "Value",
      "Start date",
      "Fiscal year",
    ]);
  });

  it("doesn't start loading the page a link leads to on hover", async () => {
    // A count's link is a whole list (Alberta's: two million payments), a
    // name's an overview: not for a passing mouse
    serveAwards();
    const { user } = renderApp("/organization/2/award");
    await screen.findByText("RECIPIENT 1");
    const link = screen
      .getAllByRole("link")
      .find((link) => link.getAttribute("href")?.includes("/ministry/"))!;

    const requests: string[] = [];
    const record = ({ request }: { request: Request }) => {
      requests.push(request.url);
    };
    server.events.on("request:start", record);
    try {
      await user.hover(link);
      await new Promise((resolve) => setTimeout(resolve, 150));
    } finally {
      server.events.removeListener("request:start", record);
    }
    expect(requests).toEqual([]);
  });

  it("goes back to the top for each new page of rows", async () => {
    serveAwards(() =>
      envelope([award(1), award(2)], {
        count: 60,
        organization: "Government of Canada",
      }),
    );
    const { user, router } = renderApp("/organization/2/award");
    await screen.findByText("RECIPIENT 1");
    const table = screen.getByRole("table").parentElement!;
    const scroll = trackScroll(table, { top: 400, left: 300 });

    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => expect(router.state.location.searchStr).toBe("?page=2"));
    expect(scroll.top).toBe(0);
    // Sideways stays, so the column being read stays in view
    expect(scroll.left).toBe(300);
  });

  it("starts another page at the top", async () => {
    serveAwards();
    const { user } = renderApp("/organization/2/award");
    await screen.findByText("RECIPIENT 1");
    const content = screen.getByRole("main").lastElementChild as HTMLElement;
    const scroll = trackScroll(content, { top: 500, left: 0 });

    const breadcrumb = screen.getByRole("navigation", { name: "breadcrumb" });
    await user.click(within(breadcrumb).getByRole("link", { name: "Organizations" }));

    await screen.findByText("Government of Alberta");
    expect(scroll.top).toBe(0);
  });
});

describe("a list's own controls", () => {
  // Canadian Heritage, in the federal departments
  const heritage = {
    id: 16,
    name: "Canadian Heritage",
    program_count: 41,
    recipient_count: 3820,
    award_count: 9115,
    award_value: 1_870_000_000,
  };

  it("total a fiscal year, whose counts lead to that year's", async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      api.get("/api/organization/:organization_id/ministry", ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return HttpResponse.json(
          envelope([heritage], {
            organization: "Government of Canada",
            footer_totals: { award_count: 9115, award_value: 1_870_000_000 },
          }),
        );
      }),
    );
    const { user, router } = renderApp("/organization/2/ministry");
    await screen.findByText("Canadian Heritage");
    // Every year to begin with
    expect(lastRequest(requests)).not.toHaveProperty("fiscal_year");
    const select = screen.getByRole("combobox", { name: "Fiscal year" });
    expect(select).toHaveTextContent("All fiscal years");

    await user.click(select);
    // The organization's years with data, newest first
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual([
      "All fiscal years",
      "FY2025",
      "FY2024",
      "FY2023",
      "FY2022",
    ]);
    await user.click(screen.getByRole("option", { name: "FY2024" }));

    await waitFor(() => expect(router.state.location.searchStr).toBe("?fy=2024"));
    await waitFor(() => expect(lastRequest(requests)).toMatchObject({ fiscal_year: "2024" }));
    expect(select).toHaveTextContent("FY2024");
    // A count leads to its list for the year: one that totals by year takes
    // it as its own, awards are filtered to it. The name, to the overview
    await waitFor(() =>
      expect(
        within(screen.getByText("Canadian Heritage").closest("tr")!)
          .getAllByRole("link")
          .map((link) => link.getAttribute("href")),
      ).toEqual([
        "/organization/2/ministry/16",
        "/organization/2/ministry/16/program?fy=2024",
        "/organization/2/ministry/16/recipient?fy=2024",
        "/organization/2/ministry/16/award?f=fiscal_year:equals:2024",
      ]),
    );
  });

  it("total a fiscal year of either organization on the organizations list", async () => {
    const requests: URLSearchParams[] = [];
    server.use(
      // Recorded, then answered as usual (by the default handler)
      api.get("/api/organization", ({ request }) => {
        requests.push(new URL(request.url).searchParams);
        return undefined;
      }),
    );
    const { user, router } = renderApp("/");
    await screen.findByText("Government of Alberta");

    await user.click(screen.getByRole("combobox", { name: "Fiscal year" }));
    expect((await screen.findAllByRole("option")).map((option) => option.textContent)).toEqual(
      expect.arrayContaining(["FY2023", "FY2022"]),
    );
    await user.click(screen.getByRole("option", { name: "FY2023" }));

    await waitFor(() => expect(router.state.location.searchStr).toBe("?fy=2023"));
    await waitFor(() =>
      expect(requests.map((query) => query.get("fiscal_year"))).toContain("2023"),
    );
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "2,031,552" })).toHaveAttribute(
        "href",
        "/organization/1/award?f=fiscal_year:equals:2023",
      ),
    );
  });

  it("hide placeholder recipients, and show agreements' superseded amendments", async () => {
    const requests = serveAwards((query) =>
      envelope([award(1), award(2)], {
        organization: "Government of Canada",
        // Each amendment restates its agreement's value: no total of them
        footer_totals: query.has("include_superseded") ? {} : { value: 3000 },
      }),
    );
    const { user, router } = renderApp("/organization/2/award");
    await screen.findByText("RECIPIENT 1");
    const placeholders = screen.getByRole("switch", {
      name: "Hide placeholders",
    });
    const superseded = screen.getByRole("switch", {
      name: "Superseded amendments",
    });
    expect(placeholders).not.toBeChecked();
    expect(superseded).not.toBeChecked();

    await user.click(placeholders);
    await waitFor(() => expect(router.state.location.searchStr).toBe("?hide_placeholders=1"));
    await waitFor(() => expect(lastRequest(requests)).toMatchObject({ hide_placeholders: "true" }));
    expect(lastRequest(requests)).not.toHaveProperty("include_superseded");

    await user.click(superseded);
    await waitFor(() =>
      expect(router.state.location.searchStr).toBe("?hide_placeholders=1&include_superseded=1"),
    );
    await waitFor(() =>
      expect(lastRequest(requests)).toMatchObject({
        hide_placeholders: "true",
        include_superseded: "true",
      }),
    );
    expect(superseded).toBeChecked();
    // With the columns that tell an agreement's versions apart, and no total
    expect(columnHeaders().slice(-3)).toEqual(["Amendment", "Amendment date", "Latest amendment"]);
    await waitFor(() => expect(screen.queryByText("$3,000.00")).not.toBeInTheDocument());

    // Off again: the latest version of each, as usual
    await user.click(superseded);
    await waitFor(() => expect(router.state.location.searchStr).toBe("?hide_placeholders=1"));
    expect(screen.queryByRole("columnheader", { name: /amendment/i })).not.toBeInTheDocument();
  });

  it("offer superseded amendments for agreements only", async () => {
    serveAwards(() => envelope([payment(1)], { organization: "Government of Alberta" }));
    renderApp("/organization/1/award");
    await screen.findByText("RECIPIENT 1");
    expect(screen.getByRole("switch", { name: "Hide placeholders" })).toBeVisible();
    expect(screen.queryByRole("switch", { name: "Superseded amendments" })).not.toBeInTheDocument();
  });

  it.each([
    // An organization's departments total by year: no placeholders in them
    ["/organization/2/ministry", ["Fiscal year"]],
    ["/organization/2/recipient", ["Fiscal year", "Hide placeholders"]],
    ["/organization/2/ministry/16/program", ["Fiscal year", "Hide placeholders"]],
    // A recipient's own: nothing to hide or everything
    ["/organization/2/recipient/42/ministries", ["Fiscal year"]],
    ["/organization/2/recipient/42/awards", ["Superseded amendments"]],
    ["/organization/2/ministry/16/recipient/42", ["Superseded amendments"]],
    ["/organization/2/ministry/16/program/5/award", ["Hide placeholders", "Superseded amendments"]],
  ])("on %s are %j", async (url, controls) => {
    server.use(
      api.get("/api/organization/:organization_id/*", () =>
        HttpResponse.json(
          envelope([{ ...award(1), name: "ROW 1", award_count: 1 }], {
            organization: "Government of Canada",
          }),
        ),
      ),
    );
    renderApp(url);
    await screen.findByRole("heading", { level: 1, name: /\(1\)$/ });
    // Once the organization is known: agreements can be amended
    await waitFor(() => expect(document.title).toContain("Government of Canada"));
    const shown = [
      ...screen.queryAllByRole("combobox", { name: "Fiscal year" }).map(() => "Fiscal year"),
      ...screen.queryAllByRole("switch").map((toggle) => toggle.closest("div")!.textContent),
    ];
    expect(shown).toEqual(controls);
  });
});

describe("an aggregated list", () => {
  it("lists the organizations, with what each publishes", async () => {
    renderApp("/");
    const alberta = (await screen.findByText("Government of Alberta")).closest("tr")!;
    expect(within(alberta).getByRole("link", { name: "Government of Alberta" })).toHaveAttribute(
      "href",
      "/organization/1",
    );
    expect(within(alberta).getByText("Payments (cash paid)")).toBeVisible();
    // Both kinds of record: headed for neither
    expect(columnHeaders()).toEqual([
      "Name",
      "Measure",
      "Ministries",
      "Recipients",
      "Awards",
      "Value",
    ]);
    // Their awards, counted together
    const footer = screen.getAllByRole("rowgroup").at(-1)!;
    expect(within(footer).getByText("3,236,429")).toBeVisible();
    expect(document.title).toBe("Organizations · GrantLedger");
  });

  it("marks placeholder recipients", async () => {
    server.use(
      api.get("/api/organization/:organization_id/recipient", () =>
        HttpResponse.json(
          envelope(
            [
              {
                id: 9,
                key: "INDIVIDUAL RECIPIENT (NAME WITHHELD)",
                name: "INDIVIDUAL RECIPIENT (NAME WITHHELD)",
                is_placeholder: true,
                ministry_count: 12,
                award_count: 5120,
                award_value: 48_000_000,
              },
              {
                id: 42,
                key: "NORTHERN LIGHTS ARTS COUNCIL",
                name: "NORTHERN LIGHTS ARTS COUNCIL",
                is_placeholder: false,
                ministry_count: 2,
                award_count: 6,
                award_value: 345_000,
              },
            ],
            { organization: "Government of Canada" },
          ),
        ),
      ),
    );
    renderApp("/organization/2/recipient");
    const withheld = (await screen.findByText("INDIVIDUAL RECIPIENT (NAME WITHHELD)")).closest(
      "td",
    )!;
    expect(within(withheld).getByText("Placeholder")).toBeVisible();
    // Its own page, as any recipient's
    expect(within(withheld).getByRole("link")).toHaveAttribute(
      "href",
      "/organization/2/recipient/9",
    );
    const named = screen.getByText("NORTHERN LIGHTS ARTS COUNCIL").closest("td")!;
    expect(within(named).queryByText("Placeholder")).toBeNull();
    expect(screen.getByRole("columnheader", { name: /^Departments/ })).toBeVisible();
  });

  it("names (No program), which has no page", async () => {
    server.use(
      api.get("/api/organization/:organization_id/ministry/:ministry_id/program", () =>
        HttpResponse.json(
          envelope(
            [
              {
                id: 5,
                name: "Canada Arts Presentation Fund",
                recipient_count: 410,
                award_count: 1220,
                award_value: 98_400_000,
              },
              {
                id: null,
                name: "(No program)",
                recipient_count: 12,
                award_count: 40,
                award_value: 1_200_000,
              },
            ],
            {
              organization: "Government of Canada",
              ministry: "Canadian Heritage",
            },
          ),
        ),
      ),
    );
    renderApp("/organization/2/ministry/16/program");
    const none = (await screen.findByText("(No program)")).closest("tr")!;
    expect(within(none).queryAllByRole("link")).toEqual([]);
    const fund = screen.getByText("Canada Arts Presentation Fund").closest("tr")!;
    expect(
      within(fund)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual([
      "/organization/2/ministry/16/program/5",
      "/organization/2/ministry/16/program/5/recipient",
      "/organization/2/ministry/16/program/5/award",
    ]);
  });
});

/** jsdom doesn't lay out or scroll: record an element's scroll position */
function trackScroll(element: HTMLElement, start: { top: number; left: number }) {
  const scroll = { ...start };
  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get: () => scroll.top,
    set: (value: number) => (scroll.top = value),
  });
  Object.defineProperty(element, "scrollLeft", {
    configurable: true,
    get: () => scroll.left,
    set: (value: number) => (scroll.left = value),
  });
  return scroll;
}
