import { describe, expect, it } from "vitest";

import {
  awardsList,
  ministriesList,
  ministryAwardsList,
  ministryProgramsList,
  ministryRecipientAwardsList,
  ministryRecipientsList,
  organizationsList,
  programAwardsList,
  programRecipientAwardsList,
  programRecipientsList,
  recipientAwardsList,
  recipientMinistriesList,
  recipientsList,
} from "./configs";
import type { LinkContext, ListConfig, ListRow } from "./types";

// A row of any list: its own id, an award's ministry, program and recipient,
// and a count of each
const row: ListRow = {
  id: 7,
  ministry_id: 16,
  program_id: 5,
  recipient_id: 42,
  ministry_count: 2,
  program_count: 3,
  recipient_count: 4,
  award_count: 6,
};
// The page's: each list reads only the ids its own path has
const scope = {
  organization_id: "2",
  ministry_id: "11",
  program_id: "8",
  recipient_id: "99",
};
// Every fiscal year, and every row
const everything: LinkContext = { hidePlaceholders: false };

/** Where a column's cells lead from `row`, or null if nowhere */
function target(
  config: ListConfig,
  column: string,
  context: LinkContext = everything,
  from: ListRow = row,
) {
  const spec = config.columns.find((spec) => typeof spec !== "string" && spec.id === column);
  if (!spec || typeof spec === "string" || !spec.link) return null;
  return spec.link(from, scope, context);
}

const ministryPage = (ministry_id: string) => ({
  to: "/organization/$organization_id/ministry/$ministry_id",
  params: { organization_id: "2", ministry_id },
});
const programPage = (ministry_id: string, program_id: string) => ({
  to: "/organization/$organization_id/ministry/$ministry_id/program/$program_id",
  params: { organization_id: "2", ministry_id, program_id },
});
const recipientPage = (recipient_id: string) => ({
  to: "/organization/$organization_id/recipient/$recipient_id",
  params: { organization_id: "2", recipient_id },
});

describe("list links", () => {
  it.each([
    [
      "name",
      "organizations",
      organizationsList,
      {
        to: "/organization/$organization_id",
        params: { organization_id: "7" },
      },
    ],
    ["name", "ministries", ministriesList, ministryPage("7")],
    ["name", "a recipient's ministries", recipientMinistriesList, ministryPage("7")],
    // Within its ministry
    ["name", "a ministry's programs", ministryProgramsList, programPage("11", "7")],
    ["name", "recipients", recipientsList, recipientPage("7")],
    // Within a ministry or program too: the recipient's own page
    ["name", "a ministry's recipients", ministryRecipientsList, recipientPage("7")],
    ["name", "a program's recipients", programRecipientsList, recipientPage("7")],
    // An award's recipient, ministry and program
    ["recipient", "awards", awardsList, recipientPage("42")],
    ["ministry", "awards", awardsList, ministryPage("16")],
    ["program", "awards", awardsList, programPage("16", "5")],
    ["recipient", "a ministry's awards", ministryAwardsList, recipientPage("42")],
    ["program", "a ministry's awards", ministryAwardsList, programPage("16", "5")],
    ["recipient", "a program's awards", programAwardsList, recipientPage("42")],
    ["ministry", "a recipient's awards", recipientAwardsList, ministryPage("16")],
    ["program", "a recipient's awards", recipientAwardsList, programPage("16", "5")],
    [
      "program",
      "a ministry's awards to a recipient",
      ministryRecipientAwardsList,
      programPage("16", "5"),
    ],
  ])("lead the %s on %s to its own page", (column, _, config, expected) => {
    // Nothing carried: an overview has no fiscal year or toggles
    expect(target(config, column)).toEqual({ ...expected, search: undefined });
  });

  it.each([
    [
      "ministry_count",
      "organizations",
      organizationsList,
      "/organization/$organization_id/ministry",
      { organization_id: "7" },
    ],
    [
      "recipient_count",
      "organizations",
      organizationsList,
      "/organization/$organization_id/recipient",
      { organization_id: "7" },
    ],
    [
      "award_count",
      "organizations",
      organizationsList,
      "/organization/$organization_id/award",
      { organization_id: "7" },
    ],
    [
      "program_count",
      "ministries",
      ministriesList,
      "/organization/$organization_id/ministry/$ministry_id/program",
      { organization_id: "2", ministry_id: "7" },
    ],
    [
      "recipient_count",
      "ministries",
      ministriesList,
      "/organization/$organization_id/ministry/$ministry_id/recipient",
      { organization_id: "2", ministry_id: "7" },
    ],
    [
      "award_count",
      "ministries",
      ministriesList,
      "/organization/$organization_id/ministry/$ministry_id/award",
      { organization_id: "2", ministry_id: "7" },
    ],
    [
      "recipient_count",
      "a ministry's programs",
      ministryProgramsList,
      "/organization/$organization_id/ministry/$ministry_id/program/$program_id/recipient",
      { organization_id: "2", ministry_id: "11", program_id: "7" },
    ],
    [
      "award_count",
      "a ministry's programs",
      ministryProgramsList,
      "/organization/$organization_id/ministry/$ministry_id/program/$program_id/award",
      { organization_id: "2", ministry_id: "11", program_id: "7" },
    ],
    // Within a ministry: the recipient's awards from it
    [
      "award_count",
      "a ministry's recipients",
      ministryRecipientsList,
      "/organization/$organization_id/ministry/$ministry_id/recipient/$recipient_id",
      { organization_id: "2", ministry_id: "11", recipient_id: "7" },
    ],
    [
      "award_count",
      "a program's recipients",
      programRecipientsList,
      "/organization/$organization_id/ministry/$ministry_id/program/$program_id/recipient/$recipient_id",
      {
        organization_id: "2",
        ministry_id: "11",
        program_id: "8",
        recipient_id: "7",
      },
    ],
    [
      "ministry_count",
      "recipients",
      recipientsList,
      "/organization/$organization_id/recipient/$recipient_id/ministries",
      { organization_id: "2", recipient_id: "7" },
    ],
    [
      "award_count",
      "recipients",
      recipientsList,
      "/organization/$organization_id/recipient/$recipient_id/awards",
      { organization_id: "2", recipient_id: "7" },
    ],
    // The ministry's awards to the recipient whose page it is
    [
      "award_count",
      "a recipient's ministries",
      recipientMinistriesList,
      "/organization/$organization_id/ministry/$ministry_id/recipient/$recipient_id",
      { organization_id: "2", ministry_id: "7", recipient_id: "99" },
    ],
  ])("lead the %s on %s to the list it counts", (column, _, config, to, params) => {
    expect(target(config, column)).toMatchObject({ to, params });
  });

  it("lead nowhere from an award list inside one program and recipient", () => {
    expect(
      programRecipientAwardsList.columns.filter((spec) => typeof spec !== "string" && spec.link),
    ).toEqual([]);
  });

  it("lead nowhere from a count of nothing", () => {
    const none = { ...row, ministry_count: 0, recipient_count: 0 };
    expect(target(organizationsList, "ministry_count", everything, none)).toBeNull();
    expect(target(recipientsList, "ministry_count", everything, none)).toBeNull();
    expect(target(ministriesList, "recipient_count", everything, none)).toBeNull();
    // A count that's missing is none too
    expect(target(ministriesList, "award_count", everything, { id: 7 })).toBeNull();
  });

  it("lead nowhere from (No program), which has no page", () => {
    // A ministry's awards without a program, gathered in a row with no id
    const noProgram = {
      id: null as unknown as number,
      name: "(No program)",
      recipient_count: 12,
      award_count: 40,
    };
    for (const column of ["name", "recipient_count", "award_count"]) {
      expect(target(ministryProgramsList, column, everything, noProgram)).toBeNull();
    }
    // Nor from an award without one
    const unprogrammed = { ...row, program: null, program_id: null };
    for (const config of [
      awardsList,
      ministryAwardsList,
      recipientAwardsList,
      ministryRecipientAwardsList,
    ]) {
      expect(target(config, "program", everything, unprogrammed)).toBeNull();
      expect(target(config, "program")).not.toBeNull();
    }
  });
});

describe("a count's link", () => {
  /** A list's links scoped to FY2024 and, if it can hide them, without its
   * placeholder recipients */
  const narrowed = (config: ListConfig): LinkContext => ({
    fiscalYear: 2024,
    hidePlaceholders: Boolean(config.toggles?.placeholders),
  });
  const inFiscalYear = (year: number) => ({
    fiscal_year: {
      operator: "and",
      constraints: [{ matchMode: "equals", value: String(year) }],
    },
  });

  it("carries nothing from a list of every year and every row", () => {
    for (const [config, column] of [
      [organizationsList, "recipient_count"],
      [organizationsList, "award_count"],
      [ministryProgramsList, "recipient_count"],
      [recipientsList, "award_count"],
    ] as const) {
      expect(target(config, column)?.search).toEqual({});
    }
  });

  it.each([
    // To a list that totals by year: the year, as its own
    ["ministry_count", "organizations", organizationsList, { fy: 2024 }],
    ["recipient_count", "organizations", organizationsList, { fy: 2024 }],
    ["program_count", "ministries", ministriesList, { fy: 2024 }],
    ["recipient_count", "ministries", ministriesList, { fy: 2024 }],
    ["ministry_count", "recipients", recipientsList, { fy: 2024 }],
    // Placeholders hidden, to a list that can hide them too
    [
      "recipient_count",
      "a ministry's programs",
      ministryProgramsList,
      { fy: 2024, hide_placeholders: 1 },
    ],
    // To awards: a filter on their fiscal year
    ["award_count", "organizations", organizationsList, { filters: inFiscalYear(2024) }],
    ["award_count", "ministries", ministriesList, { filters: inFiscalYear(2024) }],
    [
      "award_count",
      "a ministry's programs",
      ministryProgramsList,
      { filters: inFiscalYear(2024), hide_placeholders: 1 },
    ],
    // One recipient's awards, which have no placeholders to hide
    ["award_count", "recipients", recipientsList, { filters: inFiscalYear(2024) }],
    [
      "award_count",
      "a ministry's recipients",
      ministryRecipientsList,
      { filters: inFiscalYear(2024) },
    ],
    [
      "award_count",
      "a program's recipients",
      programRecipientsList,
      { filters: inFiscalYear(2024) },
    ],
    [
      "award_count",
      "a recipient's ministries",
      recipientMinistriesList,
      { filters: inFiscalYear(2024) },
    ],
  ])(
    "on %s, from %s, carries the fiscal year, and hidden placeholders if both lists hide them",
    (column, _, config, search) => {
      expect(target(config, column, narrowed(config))?.search).toEqual(search);
    },
  );

  it("carries hidden placeholders only to a list that can hide them", () => {
    // From lists hiding them: to a program's awards, which can hide them
    // too, but not to one recipient's awards or ministries
    const hidden: LinkContext = { hidePlaceholders: true };
    expect(target(ministryProgramsList, "award_count", hidden)?.search).toEqual({
      hide_placeholders: 1,
    });
    expect(target(ministryRecipientsList, "award_count", hidden)?.search).toEqual({});
    expect(target(recipientsList, "ministry_count", hidden)?.search).toEqual({});
  });
});
