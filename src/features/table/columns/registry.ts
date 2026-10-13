import type { ListColumn } from "@/features/lists/types";
import { type KindText, kindText, type RecordKind } from "@/lib/record-kind";

import type { ColumnDefinition, ColumnKind, ColumnOption } from "./types";

/** A column as the registry holds it: a header per kind of record, and the
 * kinds whose data has it (both, unless it says) */
export type RegistryColumn = Omit<ColumnDefinition, "header"> & {
  header: string | KindText;
  kinds?: RecordKind[];
};

const AGREEMENTS: RecordKind[] = ["agreement"];
const PAYMENTS: RecordKind[] = ["payment"];

const AGREEMENT_TYPES: ColumnOption[] = [
  { value: "G", label: "Grant" },
  { value: "C", label: "Contribution" },
  { value: "O", label: "Other transfer payment" },
];

const RECIPIENT_TYPES: ColumnOption[] = [
  { value: "F", label: "For-profit organization" },
  { value: "N", label: "Not-for-profit organization or charity" },
  { value: "S", label: "Academia" },
  { value: "A", label: "Indigenous recipient" },
  { value: "G", label: "Government" },
  { value: "I", label: "International (non-government)" },
  { value: "P", label: "Individual or sole proprietorship" },
  { value: "O", label: "Other" },
];

const yesNo = (yes: string, no: string): ColumnOption[] => [
  { value: "true", label: yes },
  { value: "false", label: no },
];

const MINISTRIES: KindText = {
  agreement: "Departments",
  payment: "Ministries",
  unknown: "Ministries",
};
const AWARDS: KindText = {
  agreement: "Agreements",
  payment: "Payments",
  unknown: "Awards",
};
const VALUE: KindText = {
  agreement: "Agreement value",
  payment: "Amount paid",
  unknown: "Value",
};

function column(
  id: string,
  header: string | KindText,
  kind: ColumnKind,
  extra: Partial<RegistryColumn> = {},
): RegistryColumn {
  return { id, header, kind, sortable: true, filterable: true, ...extra };
}

/** Every column a list can show, keyed by API field */
export const COLUMNS = {
  name: column("name", "Name", "text", { frozen: true, width: 280 }),
  measure: column("measure", "Measure", "text", {
    sortable: false,
    filterable: false,
  }),
  ministry_count: column("ministry_count", MINISTRIES, "number"),
  program_count: column("program_count", "Programs", "number"),
  recipient_count: column("recipient_count", "Recipients", "number"),
  award_count: column("award_count", AWARDS, "number"),
  award_value: column("award_value", VALUE, "currency"),

  recipient: column("recipient", "Recipient", "text", {
    frozen: true,
    width: 260,
  }),
  ministry: column(
    "ministry",
    { agreement: "Department", payment: "Ministry", unknown: "Ministry" },
    "text",
  ),
  program: column("program", "Program", "text"),
  reference: column("reference", "Reference", "text", { kinds: AGREEMENTS }),
  agreement_number: column("agreement_number", "Agreement number", "text", {
    kinds: AGREEMENTS,
  }),
  value: column("value", VALUE, "currency"),
  start_date: column(
    "start_date",
    { agreement: "Start date", payment: "Payment date", unknown: "Start date" },
    "date",
  ),
  end_date: column("end_date", "End date", "date", { kinds: AGREEMENTS }),
  fiscal_year: column("fiscal_year", "Fiscal year", "fiscalYear"),
  agreement_type: column("agreement_type", "Agreement type", "enum", {
    kinds: AGREEMENTS,
    options: AGREEMENT_TYPES,
  }),
  title: column("title", "Title", "text", { kinds: AGREEMENTS }),
  description: column("description", "Description", "text", {
    kinds: AGREEMENTS,
    sortable: false,
  }),
  recipient_type: column("recipient_type", "Recipient type", "enum", {
    kinds: AGREEMENTS,
    options: RECIPIENT_TYPES,
  }),
  recipient_province: column("recipient_province", "Province", "text", {
    kinds: AGREEMENTS,
  }),
  recipient_city: column("recipient_city", "City", "text", {
    kinds: AGREEMENTS,
  }),
  naics: column("naics", "NAICS code", "text", { kinds: AGREEMENTS }),
  amendment_number: column("amendment_number", "Amendment", "number", {
    kinds: AGREEMENTS,
    group: "Amendments",
  }),
  amendment_date: column("amendment_date", "Amendment date", "date", {
    kinds: AGREEMENTS,
    group: "Amendments",
  }),
  is_current: column("is_current", "Latest amendment", "boolean", {
    kinds: AGREEMENTS,
    group: "Amendments",
    options: yesNo("Latest amendment", "Superseded amendment"),
  }),
  lottery_fund: column("lottery_fund", "Lottery fund", "boolean", {
    kinds: PAYMENTS,
    options: yesNo("Lottery funded", "Not lottery funded"),
  }),
  business_unit: column("business_unit", "Business unit", "text", {
    kinds: PAYMENTS,
  }),
  start_date_estimated: column("start_date_estimated", "Date estimated", "boolean", {
    kinds: PAYMENTS,
    options: yesNo("Undated (date estimated)", "Dated"),
  }),
  source_file: column("source_file", "Source file", "text", {
    group: "Source",
  }),
  import_date: column("import_date", "Loaded", "date", { group: "Source" }),
} satisfies Record<string, RegistryColumn>;

export type ColumnId = keyof typeof COLUMNS;

/** The amendment columns, shown by default while superseded amendments are */
export const AMENDMENT_COLUMNS: ColumnId[] = ["amendment_number", "amendment_date", "is_current"];

/** A registry column as shown for an organization's kind of record */
export function resolveColumn(
  column: RegistryColumn,
  kind: RecordKind | undefined,
): ColumnDefinition {
  const { kinds: _kinds, header, ...rest } = column;
  return { ...rest, header: kindText(header, kind) };
}

/** Whether an organization's data has the column (unknown: only if both do) */
export function appliesTo(column: RegistryColumn, kind: RecordKind | undefined) {
  return !column.kinds || (kind !== undefined && column.kinds.includes(kind));
}

/**
 * A filter's column: the list's, the app's, or one named after the field.
 * A filter on a field the list doesn't show (from an old link) is still
 * shown and described.
 */
export function columnFor(columns: ListColumn[], field: string, kind?: RecordKind): ListColumn {
  return (
    columns.find(({ id }) => id === field) ??
    (Object.hasOwn(COLUMNS, field)
      ? resolveColumn((COLUMNS as Record<string, RegistryColumn>)[field]!, kind)
      : undefined) ?? {
      id: field,
      header: field.replaceAll("_", " "),
      kind: "text",
      sortable: false,
      filterable: false,
    }
  );
}
