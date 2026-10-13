/**
 * The web API's response shapes (`/api/organization…`), as the UI reads them. Dates are ISO
 * `YYYY-MM-DD` strings; amounts are CAD as numbers.
 */

/** Every list endpoint's response: one page of rows, with what the page is about */
export type ListEnvelope<Row> = {
  /** Rows matching the filters, over every page */
  count: number;
  data: Row[];
  /** The organization's name, or null on the organizations list */
  organization: string | null;
  ministry: string | null;
  program: string | null;
  /** As published */
  recipient: string | null;
  /** Totals over every row matching the filters, keyed by column */
  footer_totals: Record<string, number>;
};

/** `/api/organization` */
export type Organization = {
  id: number;
  name: string;
  key: string;
  /** agreement or payment */
  record_kind: string;
  /** What the organization calls a ministry */
  ministry_noun: string;
  source: string | null;
  source_url: string | null;
  licence: string | null;
  licence_url: string | null;
  /** The attribution its licence asks for */
  attribution: string | null;
  /** Newest first */
  fiscal_years: number[];
  measure: string | null;
  ministry_count: number | null;
  recipient_count: number | null;
  award_count: number | null;
  award_value: number | null;
};

/** `/api/organization/{organization_id}/ministry` */
export type Ministry = {
  id: number;
  name: string;
  program_count: number | null;
  recipient_count: number | null;
  award_count: number | null;
  award_value: number | null;
};

/** `/api/organization/{organization_id}/ministry/{ministry_id}/program` */
export type Program = {
  /** null for the awards without a program ("(No program)"), which have no page */
  id: number | null;
  name: string;
  recipient_count: number | null;
  award_count: number | null;
  award_value: number | null;
};

/** A ministry's or program's recipients (`…/ministry/{id}/recipient`, `…/program/{id}/recipient`) */
export type Recipient = {
  id: number;
  name: string;
  /** The normalised name recipients are matched on */
  key: string;
  is_placeholder: boolean;
  award_count: number | null;
  award_value: number | null;
};

/** `/api/organization/{organization_id}/recipient` */
export type OrganizationRecipient = {
  id: number;
  name: string;
  /** The normalised name recipients are matched on */
  key: string;
  is_placeholder: boolean;
  ministry_count: number | null;
  award_count: number | null;
  award_value: number | null;
};

/** `/api/organization/{organization_id}/recipient/{recipient_id}/ministry` */
export type RecipientMinistry = {
  id: number;
  name: string;
  award_count: number | null;
  award_value: number | null;
};

/** An award as every award list (`…/award`) returns it */
export type Award = {
  id: number;
  reference: string | null;
  agreement_number: string | null;
  /** agreement or payment */
  record_kind: string;
  /** As published */
  recipient: string;
  recipient_id: number;
  recipient_is_placeholder: boolean;
  ministry: string;
  ministry_id: number;
  program: string | null;
  program_id: number | null;
  value: number | null;
  start_date: string | null;
  /** No date was published: the fiscal year's first day */
  start_date_estimated: boolean;
  fiscal_year: number | null;
  end_date: string | null;
  agreement_type: string | null;
  title: string | null;
  /** Trimmed to 300 characters */
  description: string | null;
  recipient_type: string | null;
  recipient_province: string | null;
  recipient_city: string | null;
  naics: string | null;
  amendment_number: number | null;
  amendment_date: string | null;
  is_current: boolean;
  lottery_fund: boolean | null;
  business_unit: string | null;
  source_file: string;
  import_date: string | null;
};

export type OrganizationList = ListEnvelope<Organization>;
export type MinistryList = ListEnvelope<Ministry>;
export type ProgramList = ListEnvelope<Program>;
export type RecipientList = ListEnvelope<Recipient>;
export type OrganizationRecipientList = ListEnvelope<OrganizationRecipient>;
export type RecipientMinistryList = ListEnvelope<RecipientMinistry>;
export type AwardList = ListEnvelope<Award>;

// Overviews: `/api/organization/{organization_id}[/ministry/{ministry_id}[/program/{program_id}]
// | /recipient/{recipient_id}]/summary`

export type OverviewAward = {
  id: number;
  /** As published; null for payments, whose references the importer makes up */
  reference: string | null;
  start_date: string;
  value: number;
  /** G, C or O for agreements; null for payments */
  agreement_type: string | null;
  recipient_id: number;
  /** As published */
  recipient_name: string;
  /** A stand-in for withheld or undisclosed recipients */
  recipient_is_placeholder: boolean;
  ministry_id: number;
  ministry_name: string;
};

export type OverviewLargest = {
  id: number;
  /** As published; null for payments, whose references the importer makes up */
  reference: string | null;
  /** Its whole value */
  value: number;
  /** The part of its value in the year to date */
  year_value: number;
  recipient_id: number;
  /** As published */
  recipient_name: string;
  /** A stand-in for withheld or undisclosed recipients */
  recipient_is_placeholder: boolean;
};

export type OverviewYearToDate = {
  /** Dated awards' value this fiscal year, to `through` */
  value: number;
  /** Dated awards started (annualized: running) this year to date */
  count: number;
  /** The same a year before, to `previous_through` */
  previous_value: number;
  previous_count: number;
  /** The award with the most value this year */
  largest: OverviewLargest | null;
};

export type OverviewYear = {
  /** FY2024 is April 2024 to March 2025 */
  fiscal_year: number;
  /** This fiscal year's to `through`, undated awards included */
  value: number;
  /** Awards started (annualized: running) in the year */
  count: number;
  /** The most value of one award in the year */
  largest_value: number;
};

export type OverviewNewcomer = {
  id: number;
  name: string;
  /** The day its first award in the scope started */
  first_start_date: string;
  count: number;
  value: number;
};

export type OverviewNew = {
  /** Recipients (on a recipient's page: ministries) new this year */
  count: number;
  /** The five with the most value this year */
  top: OverviewNewcomer[];
};

export type OverviewMover = {
  id: number;
  name: string;
  /** This year to date */
  value: number;
  count: number;
  /** The same span a year before */
  previous_value: number;
  previous_count: number;
};

/** The figures that depend on how awards' values are counted */
export type OverviewBasis = {
  ytd: OverviewYearToDate;
  /** From the first fiscal year with awards, up to ten */
  by_year: OverviewYear[];
  /** Recipients (or ministries) whose first award in the scope is this year's */
  new: OverviewNew;
  /** The ten with the most value this year to date */
  movers: OverviewMover[];
};

export type OverviewUndated = {
  /** Undated awards' value this fiscal year */
  value: number;
  count: number;
  /** The same the fiscal year before */
  previous_value: number;
  previous_count: number;
};

export type OverviewImport = {
  /** The day of the latest import */
  date: string;
  /** Current awards from the files it brought */
  count: number;
  value: number;
  /** The files it brought */
  files: number;
};

export type OverviewGroup = {
  /** An agreement type: G, C or O */
  key: string;
  label: string;
};

export type OverviewMixYear = {
  fiscal_year: number;
  /** A group's key */
  group: string;
  count: number;
  value: number;
};

export type OverviewMix = {
  groups: OverviewGroup[];
  by_year: OverviewMixYear[];
};

export type OverviewSummary = {
  /** organization, ministry, program or recipient */
  scope: string;
  /** recipient, or ministry on a recipient's page */
  counterpart: string;
  /** The day the summary is for */
  today: string;
  /** The fiscal year to date: the one `through` is in */
  fiscal_year: number;
  /** The day the organization's data runs to */
  through: string;
  /** The same day a year before */
  previous_through: string;
  /** Values in the fiscal year awards started */
  started: OverviewBasis;
  /** Values spread over agreements' terms, by day; for payments, the same as `started` */
  annualized: OverviewBasis;
  /**
   * Awards published without a date, which the importer dates the fiscal year's first day:
   * counted in `by_year`, left out of the rest. This fiscal year's and the last's; null without any
   */
  undated: OverviewUndated | null;
  /** The latest dated awards to have started, to `today` */
  latest: OverviewAward[];
  last_import: OverviewImport | null;
  /** Agreements' value by fiscal year and agreement type; null for payments, or with one type */
  mix: OverviewMix | null;
};
