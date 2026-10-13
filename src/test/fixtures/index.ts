import type { Award, Organization, OverviewBasis, OverviewSummary } from "@/lib/api/types";

/**
 * Both organizations, as the organizations list has them (by name): the
 * Government of Alberta's records are payments, the Government of Canada's
 * agreements
 */
export const organizations: Organization[] = [
  {
    id: 1,
    key: "alberta",
    name: "Government of Alberta",
    record_kind: "payment",
    measure: "Payments (cash paid)",
    ministry_noun: "Ministry",
    source: "Grant Payments Disclosure (Government of Alberta)",
    source_url: "https://open.alberta.ca/dataset/grant-disclosure",
    licence: "Open Government Licence - Alberta",
    licence_url: "https://open.alberta.ca/licence",
    attribution: "Contains information licensed under the Open Government Licence – Alberta.",
    fiscal_years: [2026, 2025, 2024, 2023],
    ministry_count: 26,
    recipient_count: 61_048,
    award_count: 2_031_552,
    award_value: 96_480_000_000,
  },
  {
    id: 2,
    key: "federal",
    name: "Government of Canada",
    record_kind: "agreement",
    measure: "Agreements (committed value)",
    ministry_noun: "Department",
    source:
      "Proactive Disclosure - Grants and Contributions (Treasury Board of Canada Secretariat)",
    source_url: "https://open.canada.ca/data/en/dataset/432527ab-7aac-45b5-81d6-7597107a7013",
    licence: "Open Government Licence - Canada",
    licence_url: "https://open.canada.ca/en/open-government-licence-canada",
    attribution: "Contains information licensed under the Open Government Licence – Canada.",
    fiscal_years: [2025, 2024, 2023, 2022],
    ministry_count: 104,
    recipient_count: 187_350,
    award_count: 1_204_877,
    award_value: 412_300_000_000,
  },
];

/**
 * An award as the award lists return it: a federal agreement unless
 * overridden, with the fields of both kinds (a payment's too), so either
 * organization's columns have something to show
 */
export function award(id: number, overrides: Partial<Award> = {}): Award {
  return {
    id,
    reference: `GC-${String(id).padStart(4, "0")}`,
    agreement_number: `AGR-${id}`,
    record_kind: "agreement",
    recipient: `RECIPIENT ${id}`,
    recipient_id: 100 + id,
    recipient_is_placeholder: false,
    ministry: "Canadian Heritage",
    ministry_id: 16,
    program: "Canada Arts Presentation Fund",
    program_id: 5,
    value: id * 1000,
    start_date: "2024-05-01",
    start_date_estimated: false,
    fiscal_year: 2024,
    end_date: "2025-03-31",
    agreement_type: "G",
    title: "Summer festival programming",
    description: "Support for a community arts festival",
    recipient_type: "N",
    recipient_province: "ON",
    recipient_city: "Ottawa",
    naics: null,
    amendment_number: 0,
    amendment_date: null,
    is_current: true,
    lottery_fund: false,
    business_unit: "Community Programs",
    source_file: "grants.csv",
    import_date: "2024-06-01",
    ...overrides,
  };
}

/**
 * A list's response: its rows, and the names of what the page is about
 * (none, unless given)
 */
export function envelope(
  data: object[],
  extra: Partial<{
    count: number;
    organization: string | null;
    ministry: string | null;
    program: string | null;
    recipient: string | null;
    footer_totals: Record<string, number>;
  }> = {},
) {
  return {
    count: data.length,
    data,
    organization: null,
    ministry: null,
    program: null,
    recipient: null,
    footer_totals: {},
    ...extra,
  };
}

/** An overview's figures on one basis: none, unless given */
export function basis(extra: Partial<OverviewBasis> = {}): OverviewBasis {
  return {
    ytd: {
      value: 0,
      count: 0,
      previous_value: 0,
      previous_count: 0,
      largest: null,
    },
    by_year: [],
    new: { count: 0, top: [] },
    movers: [],
    ...extra,
  };
}

/** An overview's figures: none, unless given */
export function summary(extra: Partial<OverviewSummary> = {}): OverviewSummary {
  return {
    scope: "organization",
    counterpart: "recipient",
    today: "2026-10-07",
    fiscal_year: 2026,
    through: "2026-06-30",
    previous_through: "2025-06-30",
    started: basis(),
    annualized: basis(),
    undated: null,
    latest: [],
    last_import: null,
    mix: null,
    ...extra,
  };
}

/** Better Auth's answer for a signed-in user's session */
export const session = {
  session: {
    id: "session-1",
    token: "token",
    userId: "user-1",
    expiresAt: "2026-12-31T00:00:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
  user: {
    id: "user-1",
    name: "Ana Lyst",
    email: "analyst@example.org",
    emailVerified: true,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  },
};
