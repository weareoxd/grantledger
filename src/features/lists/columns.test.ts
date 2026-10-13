import { describe, expect, it } from "vitest";

import { defaultColumnIds, listColumns } from "./columns";
import {
  awardsList,
  ministriesList,
  organizationsList,
  programRecipientAwardsList,
  recipientsList,
} from "./configs";

const ids = (columns: { id: string }[]) => columns.map(({ id }) => id);
const headers = (columns: { id: string; header: string }[]) =>
  Object.fromEntries(columns.map(({ id, header }) => [id, header]));

// The columns only one government's data has
const AGREEMENT_ONLY = [
  "reference",
  "agreement_number",
  "end_date",
  "agreement_type",
  "title",
  "description",
  "recipient_type",
  "recipient_province",
  "recipient_city",
  "naics",
  "amendment_number",
  "amendment_date",
  "is_current",
];
const PAYMENT_ONLY = ["lottery_fund", "business_unit", "start_date_estimated"];

describe("listColumns", () => {
  it("offers the federal-only columns to agreements only", () => {
    const agreements = ids(listColumns(awardsList, "agreement"));
    expect(agreements).toEqual(expect.arrayContaining(AGREEMENT_ONLY));
    for (const id of PAYMENT_ONLY) expect(agreements).not.toContain(id);
  });

  it("offers the Alberta-only columns to payments only", () => {
    const payments = ids(listColumns(awardsList, "payment"));
    expect(payments).toEqual(expect.arrayContaining(PAYMENT_ONLY));
    for (const id of AGREEMENT_ONLY) expect(payments).not.toContain(id);
  });

  it("offers only the columns both have until the organization is known", () => {
    expect(ids(listColumns(awardsList, undefined))).toEqual([
      "recipient",
      "ministry",
      "program",
      "value",
      "start_date",
      "fiscal_year",
      "source_file",
      "import_date",
    ]);
  });

  it("puts the defaults first, in order, then the extras", () => {
    const columns = listColumns(awardsList, "agreement");
    expect(ids(columns).slice(0, 10)).toEqual([
      "recipient",
      "ministry",
      "program",
      "reference",
      "value",
      "start_date",
      "end_date",
      "fiscal_year",
      "agreement_type",
      "title",
    ]);
    expect(ids(columns).at(-1)).toBe("import_date");
    expect(defaultColumnIds(columns, awardsList)).toEqual(ids(columns).slice(0, 10));
  });

  it("heads each column as the organization's records call it", () => {
    expect(headers(listColumns(awardsList, "agreement"))).toMatchObject({
      ministry: "Department",
      value: "Agreement value",
      start_date: "Start date",
    });
    expect(headers(listColumns(awardsList, "payment"))).toMatchObject({
      ministry: "Ministry",
      value: "Amount paid",
      start_date: "Payment date",
    });
    expect(headers(listColumns(awardsList, undefined))).toMatchObject({
      ministry: "Ministry",
      value: "Value",
      start_date: "Start date",
    });
    expect(headers(listColumns(organizationsList, undefined))).toEqual({
      name: "Name",
      measure: "Measure",
      ministry_count: "Ministries",
      recipient_count: "Recipients",
      award_count: "Awards",
      award_value: "Value",
    });
    expect(headers(listColumns(recipientsList, "agreement"))).toEqual({
      name: "Name",
      ministry_count: "Departments",
      award_count: "Agreements",
      award_value: "Agreement value",
    });
    expect(headers(listColumns(ministriesList, "payment"))).toEqual({
      name: "Name",
      program_count: "Programs",
      recipient_count: "Recipients",
      award_count: "Payments",
      award_value: "Amount paid",
    });
  });

  it("keeps each column's link", () => {
    const [recipient, ministry, program] = listColumns(awardsList, "payment");
    expect([recipient, ministry, program].map((column) => column?.id)).toEqual([
      "recipient",
      "ministry",
      "program",
    ]);
    for (const column of [recipient, ministry, program]) {
      expect(column?.link).toBeTypeOf("function");
    }
    // Inside one program and recipient, nothing to lead to
    expect(listColumns(programRecipientAwardsList, "agreement").some(({ link }) => link)).toBe(
      false,
    );
  });

  it("freezes the column that names each row", () => {
    expect(listColumns(awardsList, "agreement")[0]).toMatchObject({
      id: "recipient",
      frozen: true,
    });
    expect(listColumns(ministriesList, "agreement")[0]).toMatchObject({
      id: "name",
      frozen: true,
    });
  });
});

describe("defaultColumnIds", () => {
  it("shows the amendment columns with superseded amendments", () => {
    const agreements = listColumns(awardsList, "agreement");
    const shown = defaultColumnIds(agreements, awardsList, {
      includeSuperseded: true,
    });
    expect(shown).toEqual([
      ...defaultColumnIds(agreements, awardsList),
      "amendment_number",
      "amendment_date",
      "is_current",
    ]);
  });

  it("adds none where the organization's records have none", () => {
    const payments = listColumns(awardsList, "payment");
    expect(defaultColumnIds(payments, awardsList, { includeSuperseded: true })).toEqual(
      defaultColumnIds(payments, awardsList),
    );
    expect(defaultColumnIds(payments, awardsList)).toEqual([
      "recipient",
      "ministry",
      "program",
      "value",
      "start_date",
      "fiscal_year",
      "lottery_fund",
    ]);
  });
});
