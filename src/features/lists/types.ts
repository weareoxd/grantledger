import type { ColumnId } from "@/features/table/columns/registry";
import type { ColumnDefinition } from "@/features/table/columns/types";
import type { TableSearch } from "@/features/table/state/schema";
import type { ListEnvelope as ApiListEnvelope } from "@/lib/api/types";
import type { KindText } from "@/lib/record-kind";
import type { AppPath } from "@/lib/routes";

export type { AppPath };

/** Path params of the list pages; which are present depends on the page */
export type ScopeParams = {
  organization_id?: string;
  ministry_id?: string;
  program_id?: string;
  recipient_id?: string;
};

/** A list row: an organization, ministry, program, recipient or award */
export type ListRow = { id: number } & Record<string, unknown>;

/** Any list's response; `organization` … `recipient` name what the page is about, for its
 * breadcrumbs */
export type ListEnvelope = ApiListEnvelope<ListRow>;

export type LinkTarget = {
  to: AppPath;
  params: Record<string, string>;
  search?: TableSearch;
};

/** What a list's links carry to the lists they lead to */
export type LinkContext = {
  /** The fiscal year the list is scoped to, if any */
  fiscalYear?: number;
  hidePlaceholders: boolean;
};

/** Where a cell links to, or null for plain text */
export type CellLink = (
  row: ListRow,
  params: ScopeParams,
  context: LinkContext,
) => LinkTarget | null;

export type ListColumn = ColumnDefinition & { link?: CellLink };

export type ColumnSpec = ColumnId | { id: ColumnId; link?: CellLink };

/** The list-wide controls a list has, besides its columns */
export type ListToggles = {
  /** A fiscal-year select: aggregated lists, which total by year */
  fiscalYear?: boolean;
  /** Hide the rows of withheld and undisclosed recipients */
  placeholders?: boolean;
  /** Show every version of each federal agreement, not only the latest */
  superseded?: boolean;
};

export type ListConfig = {
  /** The kind of list: its column widths are remembered under this */
  id: string;
  title: string | KindText;
  noun: { one: string | KindText; other: string | KindText };
  endpoint: (params: ScopeParams) => string;
  defaultSort: string;
  /** Shown by default, in this order */
  columns: ColumnSpec[];
  /** Offered in the column picker but hidden by default */
  extraColumns?: ColumnSpec[];
  toggles?: ListToggles;
};
