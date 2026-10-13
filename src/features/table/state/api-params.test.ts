import { describe, expect, it } from "vitest";

import { toApiParams } from "./api-params";

const decode = (params: URLSearchParams) => decodeURIComponent(params.toString());

/** A table's state: the first page in the list's own order, every fiscal
 * year and every row, unless given */
const state = (extra: Partial<Parameters<typeof toApiParams>[0]> = {}) => ({
  page: 1,
  size: 25 as const,
  sort: undefined,
  filters: {},
  fiscalYear: undefined,
  hidePlaceholders: false,
  includeSuperseded: false,
  ...extra,
});

describe("toApiParams", () => {
  it("sends paging and sort in the API's terms", () => {
    expect(decode(toApiParams(state({ page: 3, size: 50, sort: "-value" })))).toBe(
      "page=3&page_size=50&sort=value&sort_order=desc",
    );
    expect(decode(toApiParams(state({ sort: "name" })))).toBe(
      "page=1&page_size=25&sort=name&sort_order=asc",
    );
  });

  it("leaves out the sort when there is none", () => {
    expect(decode(toApiParams(state()))).toBe("page=1&page_size=25");
  });

  it("writes conditions in the bracketed grammar", () => {
    const params = toApiParams(
      state({
        filters: {
          recipient: {
            operator: "or",
            constraints: [
              { matchMode: "contains", value: "society" },
              { matchMode: "startsWith", value: "friends of, the" },
            ],
          },
          value: {
            operator: "and",
            constraints: [{ matchMode: "between", value: "1000,5000" }],
          },
        },
      }),
    );
    expect(Object.fromEntries(params)).toEqual({
      page: "1",
      page_size: "25",
      "recipient[0][value]": "society",
      "recipient[0][matchMode]": "contains",
      "recipient[1][value]": "friends of, the",
      "recipient[1][matchMode]": "startsWith",
      "recipient[operator]": "or",
      "value[0][value]": "1000,5000",
      "value[0][matchMode]": "between",
      "value[operator]": "and",
    });
  });

  it("sends the fiscal year and the toggles that are on, flat", () => {
    expect(
      Object.fromEntries(
        toApiParams(
          state({
            fiscalYear: 2024,
            hidePlaceholders: true,
            includeSuperseded: true,
          }),
        ),
      ),
    ).toEqual({
      page: "1",
      page_size: "25",
      fiscal_year: "2024",
      hide_placeholders: "true",
      include_superseded: "true",
    });
    // Off: not sent, as the API's default
    const params = toApiParams(state({ fiscalYear: 2025 }));
    expect(params.has("hide_placeholders")).toBe(false);
    expect(params.has("include_superseded")).toBe(false);
  });

  it("sends a yes/no column's filter as any other", () => {
    const params = toApiParams(
      state({
        filters: {
          lottery_fund: {
            operator: "and",
            constraints: [{ matchMode: "equals", value: "true" }],
          },
          is_current: {
            operator: "and",
            constraints: [{ matchMode: "equals", value: "false" }],
          },
        },
      }),
    );
    expect(Object.fromEntries(params)).toMatchObject({
      "lottery_fund[0][value]": "true",
      "lottery_fund[0][matchMode]": "equals",
      "is_current[0][value]": "false",
    });
    expect(params.has("lottery_fund")).toBe(false);
    expect(params.has("is_current")).toBe(false);
  });
});
