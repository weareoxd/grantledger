import { describe, expect, it } from "vitest";

import type { RecordKind } from "@/lib/record-kind";

import { COLUMNS, type ColumnId, columnFor, resolveColumn } from "./columns/registry";
import { describeFilter, fromDraft, toDraft } from "./filters";

/** A column as a list shows it, for an organization's kind of record */
const column = (id: ColumnId, kind?: RecordKind) => resolveColumn(COLUMNS[id], kind);

describe("filter drafts", () => {
  it("starts with one empty condition in the column's default mode", () => {
    expect(toDraft(column("value"))).toEqual({
      operator: "and",
      conditions: [{ mode: "gte", value: "", to: "" }],
    });
    expect(toDraft(column("recipient")).operator).toBe("or");
    // A yes/no has one condition, which is all it needs
    expect(toDraft(column("lottery_fund", "payment"))).toEqual({
      operator: "and",
      conditions: [{ mode: "equals", value: "", to: "" }],
    });
  });

  it("starts a second condition from the kind's operator", () => {
    const one = {
      operator: "and" as const,
      constraints: [{ matchMode: "contains" as const, value: "society" }],
    };
    expect(toDraft(column("recipient"), one).operator).toBe("or");
  });

  it("splits and rejoins ranges", () => {
    const filter = {
      operator: "and" as const,
      constraints: [{ matchMode: "between" as const, value: "100,200" }],
    };
    const draft = toDraft(column("value"), filter);
    expect(draft.conditions).toEqual([{ mode: "between", value: "100", to: "200" }]);
    expect(fromDraft(draft)).toEqual(filter);
  });

  it("turns a range with one end into a comparison", () => {
    expect(
      fromDraft({
        operator: "and",
        conditions: [
          { mode: "between", value: "2024-04-01", to: "" },
          { mode: "between", value: "", to: "2025-03-31" },
        ],
      }),
    ).toEqual({
      operator: "and",
      constraints: [
        { matchMode: "gte", value: "2024-04-01" },
        { matchMode: "lte", value: "2025-03-31" },
      ],
    });
  });

  it("drops blank conditions, and the filter when none are left", () => {
    expect(
      fromDraft({
        operator: "or",
        conditions: [
          { mode: "contains", value: "  ", to: "" },
          { mode: "contains", value: " society ", to: "" },
        ],
      }),
    ).toEqual({
      operator: "or",
      constraints: [{ matchMode: "contains", value: "society" }],
    });
    expect(
      fromDraft({
        operator: "or",
        conditions: [{ mode: "contains", value: "", to: "" }],
      }),
    ).toBeUndefined();
  });

  it("keeps an exact value exactly, spaces and all", () => {
    // Some published names end in a space, as links to them do
    const value = "Community Facility Enhancement Program ";
    expect(
      fromDraft({
        operator: "and",
        conditions: [{ mode: "equals", value, to: "" }],
      }),
    ).toEqual({
      operator: "and",
      constraints: [{ matchMode: "equals", value }],
    });
    expect(
      fromDraft({
        operator: "and",
        conditions: [{ mode: "equals", value: "  ", to: "" }],
      }),
    ).toBeUndefined();
  });
});

describe("describeFilter", () => {
  it.each([
    [
      column("recipient"),
      {
        operator: "or" as const,
        constraints: [
          { matchMode: "contains" as const, value: "society" },
          { matchMode: "contains" as const, value: "centre" },
        ],
      },
      "Recipient contains “society” or “centre”",
    ],
    [
      column("value", "agreement"),
      {
        operator: "and" as const,
        constraints: [{ matchMode: "between" as const, value: "1000,25000" }],
      },
      "Agreement value between $1,000.00 and $25K",
    ],
    [
      column("value", "payment"),
      {
        operator: "and" as const,
        constraints: [{ matchMode: "gte" as const, value: "10000" }],
      },
      "Amount paid ≥ $10K",
    ],
    // Before the organization is known
    [
      column("value"),
      {
        operator: "and" as const,
        constraints: [{ matchMode: "lt" as const, value: "500" }],
      },
      "Value < $500.00",
    ],
    [
      column("start_date", "agreement"),
      {
        operator: "and" as const,
        constraints: [
          { matchMode: "gt" as const, value: "2024-04-01" },
          { matchMode: "lt" as const, value: "2025-04-01" },
        ],
      },
      "Start date is after 2024-04-01 and is before 2025-04-01",
    ],
    [
      column("start_date", "payment"),
      {
        operator: "and" as const,
        constraints: [{ matchMode: "between" as const, value: "2024-04-01,2025-03-31" }],
      },
      "Payment date is between 2024-04-01 and 2025-03-31",
    ],
    [
      column("fiscal_year"),
      {
        operator: "or" as const,
        constraints: [
          { matchMode: "equals" as const, value: "2023" },
          { matchMode: "equals" as const, value: "2024" },
        ],
      },
      "Fiscal year = FY2023 or FY2024",
    ],
    [
      column("agreement_type", "agreement"),
      {
        operator: "or" as const,
        constraints: [
          { matchMode: "equals" as const, value: "G" },
          { matchMode: "equals" as const, value: "C" },
        ],
      },
      "Agreement type is Grant or Contribution",
    ],
    [
      column("ministry", "agreement"),
      {
        operator: "and" as const,
        constraints: [{ matchMode: "equals" as const, value: "Canadian Heritage" }],
      },
      "Department is “Canadian Heritage”",
    ],
    [
      column("ministry", "payment"),
      {
        operator: "and" as const,
        constraints: [{ matchMode: "notContains" as const, value: "Advanced Education" }],
      },
      "Ministry doesn't contain “Advanced Education”",
    ],
    // A yes/no, by what it says
    [
      column("lottery_fund", "payment"),
      {
        operator: "and" as const,
        constraints: [{ matchMode: "equals" as const, value: "true" }],
      },
      "Lottery funded",
    ],
    [
      column("lottery_fund", "payment"),
      {
        operator: "and" as const,
        constraints: [{ matchMode: "equals" as const, value: "false" }],
      },
      "Not lottery funded",
    ],
    [
      column("start_date_estimated", "payment"),
      {
        operator: "and" as const,
        constraints: [{ matchMode: "equals" as const, value: "true" }],
      },
      "Undated (date estimated)",
    ],
    [
      column("is_current", "agreement"),
      {
        operator: "and" as const,
        constraints: [{ matchMode: "equals" as const, value: "false" }],
      },
      "Superseded amendment",
    ],
  ])("%#", (column, filter, expected) => {
    expect(describeFilter(column, filter)).toBe(expected);
  });
});

describe("a filter's column", () => {
  it("is the list's, if it shows it", () => {
    const shown = { ...column("recipient"), header: "Who" };
    expect(columnFor([shown], "recipient", "agreement")).toBe(shown);
  });

  it("is the app's, for the organization, if the list doesn't show it", () => {
    // From an overview's link, say
    expect(columnFor([], "start_date", "payment").header).toBe("Payment date");
    expect(columnFor([], "end_date", "agreement")).toMatchObject({
      id: "end_date",
      header: "End date",
      kind: "date",
    });
  });

  it("is named after the field, if the app has none", () => {
    // An old link's
    expect(columnFor([], "recipient_id", "agreement")).toEqual({
      id: "recipient_id",
      header: "recipient id",
      kind: "text",
      sortable: false,
      filterable: false,
    });
    // Not one of every object's own properties
    expect(columnFor([], "constructor").header).toBe("constructor");
  });
});
