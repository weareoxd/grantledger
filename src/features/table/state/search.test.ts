import { describe, expect, it } from "vitest";

import { MAX_CONSTRAINTS, tableSearchSchema } from "./schema";

import { parseSearch, stringifySearch } from "./search";

describe("search codec", () => {
  it("writes table state as readable params", () => {
    const search = {
      page: 2,
      size: 50,
      sort: "-value",
      cols: ["recipient", "value"],
      filters: {
        recipient: {
          operator: "or",
          constraints: [
            { matchMode: "contains", value: "society" },
            { matchMode: "contains", value: "food bank" },
          ],
        },
        value: {
          operator: "and",
          constraints: [{ matchMode: "between", value: "1000,5000" }],
        },
      },
    };

    const url = stringifySearch(search);

    expect(url).toBe(
      "?page=2&size=50&sort=-value&cols=recipient,value" +
        "&f=recipient:contains:society&f=recipient:contains:food%20bank" +
        "&f=value:between:1000,5000&op=recipient:or",
    );
    expect(parseSearch(url)).toEqual(search);
  });

  it("writes the fiscal year and toggles as numbers, in their place", () => {
    const search = {
      include_superseded: 1,
      filters: {
        fiscal_year: {
          operator: "and",
          constraints: [{ matchMode: "equals", value: "2024" }],
        },
      },
      hide_placeholders: 1,
      fy: 2024,
      page: 3,
    };

    const url = stringifySearch(search);

    // In one order, however they were set, so the same state is one URL
    expect(url).toBe(
      "?page=3&fy=2024&hide_placeholders=1&include_superseded=1" + "&f=fiscal_year:equals:2024",
    );
    expect(parseSearch(url)).toEqual(search);
  });

  it("keeps everything after the second colon as the value", () => {
    expect(parseSearch("?f=title:contains:a:b%26c")).toEqual({
      filters: {
        title: {
          operator: "and",
          constraints: [{ matchMode: "contains", value: "a:b&c" }],
        },
      },
    });
  });

  it("drops malformed conditions and stray operators", () => {
    expect(
      parseSearch(
        "?f=recipient:bogus:x&f=Recipient:contains:x&f=recipient:contains:&f=value&op=value:or&op=recipient:xor",
      ),
    ).toEqual({});
  });

  it("caps conditions per field", () => {
    const params = Array.from({ length: MAX_CONSTRAINTS + 2 }, (_, i) => `f=value:gt:${i}`);
    const filters = parseSearch(`?${params.join("&")}`).filters as Record<
      string,
      { constraints: unknown[] }
    >;
    expect(filters.value!.constraints).toHaveLength(MAX_CONSTRAINTS);
  });

  it("drops fields named as objects' own properties", () => {
    // {}.constructor is a function: read as a filter, the app didn't load
    expect(
      parseSearch(
        "?f=constructor:equals:x&f=__proto__:equals:y&op=__proto__:or&f=recipient:contains:a",
      ),
    ).toEqual({
      filters: {
        recipient: {
          operator: "and",
          constraints: [{ matchMode: "contains", value: "a" }],
        },
      },
    });
    expect(({} as Record<string, unknown>).operator).toBeUndefined();
  });

  it("passes other params through as strings", () => {
    const search = parseSearch(
      "?utm_source=newsletter&back=%2Forganization%2F2%2Faward%3Fpage%3D2",
    );
    expect(search).toEqual({
      utm_source: "newsletter",
      back: "/organization/2/award?page=2",
    });
    expect(parseSearch(stringifySearch(search))).toEqual(search);
  });

  it("leaves non-numeric numbers for validation to reject", () => {
    expect(parseSearch("?page=two&size=25&fy=FY2024&hide_placeholders=yes")).toEqual({
      page: "two",
      size: 25,
      fy: "FY2024",
      hide_placeholders: "yes",
    });
  });

  it("omits empty values", () => {
    expect(
      stringifySearch({
        page: undefined,
        cols: [],
        filters: {},
        fy: undefined,
        hide_placeholders: undefined,
        next: null,
      }),
    ).toBe("");
  });
});

describe("table search validation", () => {
  it("drops a bad column or filter name, keeping the others", () => {
    // An old link's, say: one bad name doesn't take the rest with it
    const filter = {
      operator: "and" as const,
      constraints: [{ matchMode: "contains" as const, value: "a" }],
    };
    const { cols, filters } = tableSearchSchema.parse({
      cols: ["recipient", "Bad Name", "constructor"],
      filters: { recipient: filter, constructor: filter, "Bad Name": filter },
    });
    expect(cols).toEqual(["recipient"]);
    expect(Object.keys(filters!)).toEqual(["recipient"]);
  });

  it("drops a bad filter, keeping the others", () => {
    const { filters } = tableSearchSchema.parse({
      filters: {
        recipient: {
          operator: "and",
          constraints: [{ matchMode: "contains", value: "a" }],
        },
        value: {
          operator: "and",
          constraints: [{ matchMode: "regex", value: "b" }],
        },
      },
    });
    expect(Object.keys(filters!)).toEqual(["recipient"]);
  });

  it("keeps a fiscal year and the toggles when they're on", () => {
    expect(
      tableSearchSchema.parse({
        fy: 2024,
        hide_placeholders: 1,
        include_superseded: 1,
      }),
    ).toEqual({ fy: 2024, hide_placeholders: 1, include_superseded: 1 });
  });

  it("drops a fiscal year or toggle that can't be one", () => {
    // Hand-edited: the list totals every year, with every row
    expect(
      tableSearchSchema.parse({
        fy: "FY2024",
        hide_placeholders: 0,
        include_superseded: "yes",
      }),
    ).toEqual({
      fy: undefined,
      hide_placeholders: undefined,
      include_superseded: undefined,
    });
    expect(tableSearchSchema.parse({ fy: 1066 }).fy).toBeUndefined();
    expect(tableSearchSchema.parse({ fy: 2024.5 }).fy).toBeUndefined();
  });
});
