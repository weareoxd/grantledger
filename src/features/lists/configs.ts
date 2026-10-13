import type { TableSearch } from "@/features/table/state/schema";
import type { KindText } from "@/lib/record-kind";

import type {
  CellLink,
  ColumnSpec,
  LinkContext,
  LinkTarget,
  ListConfig,
  ListRow,
  ListToggles,
  ScopeParams,
} from "./types";

// The controls each kind of list has: aggregated lists total by fiscal year;
// the placeholder toggle isn't offered inside one recipient's lists, where it
// would hide everything or nothing
const AGGREGATED: ListToggles = { fiscalYear: true };
const AGGREGATED_RECIPIENTS: ListToggles = {
  fiscalYear: true,
  placeholders: true,
};
const AWARDS: ListToggles = { placeholders: true, superseded: true };
const RECIPIENT_AWARDS: ListToggles = { superseded: true };

// Path params come from the page when it is scoped to them, otherwise from
// the row: `<x>_id` on awards, `id` on the row's own kind
function link(
  to: LinkTarget["to"],
  params: (row: ListRow, scope: ScopeParams) => Record<string, unknown>,
  options: {
    enabled?: (row: ListRow) => boolean;
    search?: (context: LinkContext) => TableSearch;
  } = {},
): CellLink {
  return (row, scope, context) => {
    if (options.enabled && !options.enabled(row)) return null;
    const values = Object.entries(params(row, scope));
    // A row without one (an award with no program) links nowhere
    if (values.some(([, value]) => value === null || value === undefined)) {
      return null;
    }
    return {
      to,
      params: Object.fromEntries(values.map(([key, value]) => [key, String(value)])),
      search: options.search?.(context),
    };
  };
}

// Counts of zero have nothing to show
const nonZero = (field: string) => (row: ListRow) => Number(row[field]) > 0;

/**
 * A count's link: to the list it counts, for the fiscal year and with the
 * placeholders the list shows. An aggregated list takes the year as its own;
 * an award list as a filter on its fiscal year column.
 */
function countLink(
  to: LinkTarget["to"],
  params: (row: ListRow, scope: ScopeParams) => Record<string, unknown>,
  field: string,
  target: ListToggles,
): CellLink {
  return link(to, params, {
    enabled: nonZero(field),
    search: ({ fiscalYear, hidePlaceholders }) => ({
      ...(target.fiscalYear
        ? { fy: fiscalYear }
        : fiscalYear !== undefined
          ? {
              filters: {
                fiscal_year: {
                  operator: "and",
                  constraints: [{ matchMode: "equals", value: String(fiscalYear) }],
                },
              },
            }
          : {}),
      hide_placeholders: target.placeholders && hidePlaceholders ? (1 as const) : undefined,
    }),
  });
}

// A name leads to its own page; a count, to the list it counts
const ministryPage = (ministryId: (row: ListRow) => unknown) =>
  link("/organization/$organization_id/ministry/$ministry_id", (row, scope) => ({
    organization_id: scope.organization_id,
    ministry_id: ministryId(row),
  }));
const programPage = (
  ministryId: (row: ListRow, scope: ScopeParams) => unknown,
  programId: (row: ListRow) => unknown,
) =>
  link(
    "/organization/$organization_id/ministry/$ministry_id/program/$program_id",
    (row, scope) => ({
      organization_id: scope.organization_id,
      ministry_id: ministryId(row, scope),
      program_id: programId(row),
    }),
  );
const recipientPage = (recipientId: (row: ListRow) => unknown) =>
  link("/organization/$organization_id/recipient/$recipient_id", (row, scope) => ({
    organization_id: scope.organization_id,
    recipient_id: recipientId(row),
  }));

const MINISTRIES: KindText = {
  agreement: "Departments",
  payment: "Ministries",
  unknown: "Ministries",
};
const ministryNoun = {
  one: { agreement: "department", payment: "ministry", unknown: "ministry" },
  other: {
    agreement: "departments",
    payment: "ministries",
    unknown: "ministries",
  },
};
const AWARDS_TITLE: KindText = {
  agreement: "Agreements",
  payment: "Payments",
  unknown: "Awards",
};
const awardNoun = {
  one: { agreement: "agreement", payment: "payment", unknown: "award" },
  other: { agreement: "agreements", payment: "payments", unknown: "awards" },
};
const recipientNoun = { one: "recipient", other: "recipients" };

/** An award list's columns, after those its links need: in display order,
 * the federal-only and Alberta-only ones dropped for the other */
const awardColumns: ColumnSpec[] = [
  "reference",
  "value",
  "start_date",
  "end_date",
  "fiscal_year",
  "agreement_type",
  "title",
  "lottery_fund",
];
const awardExtraColumns: ColumnSpec[] = [
  "description",
  "agreement_number",
  "recipient_type",
  "recipient_province",
  "recipient_city",
  "naics",
  "business_unit",
  "start_date_estimated",
  "amendment_number",
  "amendment_date",
  "is_current",
  "source_file",
  "import_date",
];

const recipientColumn: ColumnSpec = {
  id: "recipient",
  link: recipientPage((row) => row.recipient_id),
};
const ministryColumn: ColumnSpec = {
  id: "ministry",
  link: ministryPage((row) => row.ministry_id),
};
const programColumn: ColumnSpec = {
  id: "program",
  link: programPage(
    (row) => row.ministry_id,
    (row) => row.program_id,
  ),
};

function awardsConfig(
  endpoint: ListConfig["endpoint"],
  links: ColumnSpec[],
  toggles: ListToggles,
): ListConfig {
  return {
    id: "awards",
    title: AWARDS_TITLE,
    noun: awardNoun,
    endpoint,
    defaultSort: "-start_date",
    columns: [...links, ...awardColumns],
    extraColumns: awardExtraColumns,
    toggles,
  };
}

export const organizationsList: ListConfig = {
  id: "organizations",
  title: "Organizations",
  noun: { one: "organization", other: "organizations" },
  endpoint: () => "/api/organization",
  defaultSort: "name",
  columns: [
    {
      id: "name",
      link: link("/organization/$organization_id", (row) => ({
        organization_id: row.id,
      })),
    },
    "measure",
    {
      id: "ministry_count",
      link: countLink(
        "/organization/$organization_id/ministry",
        (row) => ({ organization_id: row.id }),
        "ministry_count",
        AGGREGATED,
      ),
    },
    {
      id: "recipient_count",
      link: countLink(
        "/organization/$organization_id/recipient",
        (row) => ({ organization_id: row.id }),
        "recipient_count",
        AGGREGATED_RECIPIENTS,
      ),
    },
    {
      id: "award_count",
      link: countLink(
        "/organization/$organization_id/award",
        (row) => ({ organization_id: row.id }),
        "award_count",
        AWARDS,
      ),
    },
    "award_value",
  ],
  toggles: AGGREGATED,
};

export const ministriesList: ListConfig = {
  id: "ministries",
  title: MINISTRIES,
  noun: ministryNoun,
  endpoint: (p) => `/api/organization/${p.organization_id}/ministry`,
  defaultSort: "name",
  columns: [
    { id: "name", link: ministryPage((row) => row.id) },
    {
      id: "program_count",
      link: countLink(
        "/organization/$organization_id/ministry/$ministry_id/program",
        (row, scope) => ({
          organization_id: scope.organization_id,
          ministry_id: row.id,
        }),
        "program_count",
        AGGREGATED_RECIPIENTS,
      ),
    },
    {
      id: "recipient_count",
      link: countLink(
        "/organization/$organization_id/ministry/$ministry_id/recipient",
        (row, scope) => ({
          organization_id: scope.organization_id,
          ministry_id: row.id,
        }),
        "recipient_count",
        AGGREGATED_RECIPIENTS,
      ),
    },
    {
      id: "award_count",
      link: countLink(
        "/organization/$organization_id/ministry/$ministry_id/award",
        (row, scope) => ({
          organization_id: scope.organization_id,
          ministry_id: row.id,
        }),
        "award_count",
        AWARDS,
      ),
    },
    "award_value",
  ],
  toggles: AGGREGATED,
};

export const ministryProgramsList: ListConfig = {
  id: "programs",
  title: "Programs",
  noun: { one: "program", other: "programs" },
  endpoint: (p) => `/api/organization/${p.organization_id}/ministry/${p.ministry_id}/program`,
  defaultSort: "name",
  columns: [
    // "(No program)" has no page: its id is null
    {
      id: "name",
      link: programPage(
        (_row, scope) => scope.ministry_id,
        (row) => row.id,
      ),
    },
    {
      id: "recipient_count",
      link: countLink(
        "/organization/$organization_id/ministry/$ministry_id/program/$program_id/recipient",
        (row, scope) => ({
          organization_id: scope.organization_id,
          ministry_id: scope.ministry_id,
          program_id: row.id,
        }),
        "recipient_count",
        AGGREGATED_RECIPIENTS,
      ),
    },
    {
      id: "award_count",
      link: countLink(
        "/organization/$organization_id/ministry/$ministry_id/program/$program_id/award",
        (row, scope) => ({
          organization_id: scope.organization_id,
          ministry_id: scope.ministry_id,
          program_id: row.id,
        }),
        "award_count",
        AWARDS,
      ),
    },
    "award_value",
  ],
  toggles: AGGREGATED_RECIPIENTS,
};

export const ministryRecipientsList: ListConfig = {
  id: "recipients",
  title: "Recipients",
  noun: recipientNoun,
  endpoint: (p) => `/api/organization/${p.organization_id}/ministry/${p.ministry_id}/recipient`,
  defaultSort: "name",
  columns: [
    { id: "name", link: recipientPage((row) => row.id) },
    {
      id: "award_count",
      link: countLink(
        "/organization/$organization_id/ministry/$ministry_id/recipient/$recipient_id",
        (row, scope) => ({
          organization_id: scope.organization_id,
          ministry_id: scope.ministry_id,
          recipient_id: row.id,
        }),
        "award_count",
        RECIPIENT_AWARDS,
      ),
    },
    "award_value",
  ],
  toggles: AGGREGATED_RECIPIENTS,
};

export const programRecipientsList: ListConfig = {
  id: "recipients",
  title: "Recipients",
  noun: recipientNoun,
  endpoint: (p) =>
    `/api/organization/${p.organization_id}/ministry/${p.ministry_id}/program/${p.program_id}/recipient`,
  defaultSort: "name",
  columns: [
    { id: "name", link: recipientPage((row) => row.id) },
    {
      id: "award_count",
      link: countLink(
        "/organization/$organization_id/ministry/$ministry_id/program/$program_id/recipient/$recipient_id",
        (row, scope) => ({
          organization_id: scope.organization_id,
          ministry_id: scope.ministry_id,
          program_id: scope.program_id,
          recipient_id: row.id,
        }),
        "award_count",
        RECIPIENT_AWARDS,
      ),
    },
    "award_value",
  ],
  toggles: AGGREGATED_RECIPIENTS,
};

export const recipientsList: ListConfig = {
  id: "recipients",
  title: "Recipients",
  noun: recipientNoun,
  endpoint: (p) => `/api/organization/${p.organization_id}/recipient`,
  defaultSort: "name",
  columns: [
    { id: "name", link: recipientPage((row) => row.id) },
    {
      id: "ministry_count",
      link: countLink(
        "/organization/$organization_id/recipient/$recipient_id/ministries",
        (row, scope) => ({
          organization_id: scope.organization_id,
          recipient_id: row.id,
        }),
        "ministry_count",
        AGGREGATED,
      ),
    },
    {
      id: "award_count",
      link: countLink(
        "/organization/$organization_id/recipient/$recipient_id/awards",
        (row, scope) => ({
          organization_id: scope.organization_id,
          recipient_id: row.id,
        }),
        "award_count",
        RECIPIENT_AWARDS,
      ),
    },
    "award_value",
  ],
  toggles: AGGREGATED_RECIPIENTS,
};

export const recipientMinistriesList: ListConfig = {
  id: "ministries",
  title: MINISTRIES,
  noun: ministryNoun,
  endpoint: (p) => `/api/organization/${p.organization_id}/recipient/${p.recipient_id}/ministry`,
  defaultSort: "name",
  columns: [
    { id: "name", link: ministryPage((row) => row.id) },
    {
      id: "award_count",
      link: countLink(
        "/organization/$organization_id/ministry/$ministry_id/recipient/$recipient_id",
        (row, scope) => ({
          organization_id: scope.organization_id,
          ministry_id: row.id,
          recipient_id: scope.recipient_id,
        }),
        "award_count",
        RECIPIENT_AWARDS,
      ),
    },
    "award_value",
  ],
  toggles: AGGREGATED,
};

export const awardsList = awardsConfig(
  (p) => `/api/organization/${p.organization_id}/award`,
  [recipientColumn, ministryColumn, programColumn],
  AWARDS,
);

export const ministryAwardsList = awardsConfig(
  (p) => `/api/organization/${p.organization_id}/ministry/${p.ministry_id}/award`,
  [recipientColumn, programColumn],
  AWARDS,
);

export const programAwardsList = awardsConfig(
  (p) =>
    `/api/organization/${p.organization_id}/ministry/${p.ministry_id}/program/${p.program_id}/award`,
  [recipientColumn],
  AWARDS,
);

export const recipientAwardsList = awardsConfig(
  (p) => `/api/organization/${p.organization_id}/recipient/${p.recipient_id}/award`,
  [ministryColumn, programColumn],
  RECIPIENT_AWARDS,
);

export const ministryRecipientAwardsList = awardsConfig(
  (p) =>
    `/api/organization/${p.organization_id}/ministry/${p.ministry_id}/recipient/${p.recipient_id}/award`,
  [programColumn],
  RECIPIENT_AWARDS,
);

export const programRecipientAwardsList = awardsConfig(
  (p) =>
    `/api/organization/${p.organization_id}/ministry/${p.ministry_id}/program/${p.program_id}/recipient/${p.recipient_id}/award`,
  [],
  RECIPIENT_AWARDS,
);
