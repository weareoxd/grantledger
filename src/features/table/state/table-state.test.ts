import { describe, expect, it } from "vitest";

import type { TableSearch } from "./schema";
import { resolveTableState, searchUpdates } from "./table-state";

const defaults = { sort: "-start_date", cols: ["recipient", "value"] };
const filter = {
  operator: "and" as const,
  constraints: [{ matchMode: "gte" as const, value: "10" }],
};

describe("resolveTableState", () => {
  it("fills in the defaults", () => {
    expect(resolveTableState({}, defaults)).toEqual({
      page: 1,
      size: 25,
      sort: "-start_date",
      cols: ["recipient", "value"],
      filters: {},
      // Every fiscal year, and every row
      fiscalYear: undefined,
      hidePlaceholders: false,
      includeSuperseded: false,
    });
  });

  it("reads the fiscal year and toggles", () => {
    expect(
      resolveTableState({ fy: 2024, hide_placeholders: 1, include_superseded: 1 }, defaults),
    ).toMatchObject({
      fiscalYear: 2024,
      hidePlaceholders: true,
      includeSuperseded: true,
    });
  });
});

describe("searchUpdates", () => {
  const onPage3: TableSearch = { page: 3, size: 50, filters: { value: filter } };

  it("goes back to the first page when anything but the page changes", () => {
    expect(searchUpdates.sort("-value", defaults)(onPage3).page).toBeUndefined();
    expect(searchUpdates.size(10)(onPage3).page).toBeUndefined();
    expect(searchUpdates.filter("recipient", filter)(onPage3).page).toBeUndefined();
    expect(searchUpdates.fiscalYear(2024)(onPage3).page).toBeUndefined();
    expect(searchUpdates.toggle("hide_placeholders", true)(onPage3).page).toBeUndefined();
    // Removing a filter too
    expect(searchUpdates.filter("value", undefined)(onPage3)).toEqual({
      size: 50,
      page: undefined,
      filters: undefined,
    });
    expect(searchUpdates.page(4)(onPage3).page).toBe(4);
  });

  it("keeps defaults out of the URL", () => {
    expect(searchUpdates.page(1)({ page: 2 }).page).toBeUndefined();
    expect(searchUpdates.size(25)({ size: 50 }).size).toBeUndefined();
    expect(searchUpdates.sort("-start_date", defaults)({ sort: "-value" }).sort).toBeUndefined();
    expect(searchUpdates.sort(undefined, defaults)({ sort: "-value" }).sort).toBeUndefined();
    expect(
      searchUpdates.cols(["value", "recipient"], defaults, ["recipient"])({
        cols: ["recipient"],
      }).cols,
    ).toBeUndefined();
  });

  it("picks a fiscal year, or every year", () => {
    expect(searchUpdates.fiscalYear(2024)({ size: 50 })).toEqual({
      size: 50,
      page: undefined,
      fy: 2024,
    });
    expect(searchUpdates.fiscalYear(undefined)({ fy: 2024 }).fy).toBeUndefined();
  });

  it("turns a toggle on, and off out of the URL", () => {
    const on = searchUpdates.toggle("include_superseded", true)({ fy: 2024 });
    expect(on).toEqual({ fy: 2024, page: undefined, include_superseded: 1 });
    expect(
      searchUpdates.toggle("include_superseded", false)(on).include_superseded,
    ).toBeUndefined();
    // Each on its own
    expect(
      searchUpdates.toggle("hide_placeholders", true)({ include_superseded: 1 }),
    ).toMatchObject({ hide_placeholders: 1, include_superseded: 1 });
  });

  it("keeps the fiscal year and toggles through other changes", () => {
    const scoped: TableSearch = {
      fy: 2024,
      hide_placeholders: 1,
      include_superseded: 1,
    };
    for (const next of [
      searchUpdates.sort("-value", defaults)(scoped),
      searchUpdates.filter("recipient", filter)(scoped),
      searchUpdates.clearFilters()(scoped),
      searchUpdates.cols(["recipient"], defaults, defaults.cols)(scoped),
    ]) {
      expect(next).toMatchObject(scoped);
    }
  });

  it("drops a hidden column's filter", () => {
    const next = searchUpdates.cols(
      ["recipient"],
      defaults,
      defaults.cols,
    )({
      page: 2,
      filters: { value: filter, recipient: filter },
    });
    expect(next).toEqual({
      page: undefined,
      cols: ["recipient"],
      filters: { recipient: filter },
    });
  });

  it("keeps the filter and sort of a field that wasn't shown", () => {
    // From a link (an overview's "Data loaded", say): hiding another column
    // doesn't lose them
    const next = searchUpdates.cols(
      ["recipient"],
      defaults,
      defaults.cols,
    )({
      page: 2,
      sort: "-import_date",
      filters: { value: filter, import_date: filter, recipient_id: filter },
    });
    expect(next).toEqual({
      page: undefined,
      sort: "-import_date",
      cols: ["recipient"],
      filters: { import_date: filter, recipient_id: filter },
    });
  });

  it("goes by the columns on screen, not the address's", () => {
    // `cols` naming none of this list's columns: its defaults are shown,
    // and hiding one of them drops its sort and filter
    const next = searchUpdates.cols(
      ["recipient"],
      defaults,
      defaults.cols,
    )({
      cols: ["not_a_column"],
      sort: "-value",
      filters: { value: filter, not_a_column: filter },
    });
    expect(next.sort).toBeUndefined();
    expect(next.filters).toEqual({ not_a_column: filter });
  });

  it("keeps the page when hiding an unfiltered column", () => {
    expect(searchUpdates.cols(["recipient"], defaults, defaults.cols)({ page: 2 }).page).toBe(2);
  });

  it("drops a hidden column's sort, which no header would show", () => {
    const hide = searchUpdates.cols(["recipient"], defaults, defaults.cols);
    expect(hide({ page: 2, sort: "-value" })).toMatchObject({
      page: undefined,
      sort: undefined,
    });
    expect(hide({ page: 2, sort: "-recipient" })).toMatchObject({
      page: 2,
      sort: "-recipient",
    });
  });
});
