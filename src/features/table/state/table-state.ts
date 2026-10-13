import {
  DEFAULT_PAGE_SIZE,
  type FieldFilter,
  type Filters,
  type PageSize,
  type TableSearch,
} from "./schema";

/** Table state with every default applied */
export type TableState = {
  page: number;
  size: PageSize;
  /** Field, `-` prefix for descending; undefined = the list's own order */
  sort: string | undefined;
  cols: string[];
  filters: Filters;
  /** The fiscal year an aggregated list totals; undefined = all years */
  fiscalYear: number | undefined;
  hidePlaceholders: boolean;
  includeSuperseded: boolean;
};

export type Toggle = "hide_placeholders" | "include_superseded";

export type TableDefaults = { sort?: string; cols: string[] };

export function resolveTableState(search: TableSearch, defaults: TableDefaults): TableState {
  return {
    page: search.page ?? 1,
    size: search.size ?? DEFAULT_PAGE_SIZE,
    sort: search.sort ?? defaults.sort,
    cols: search.cols ?? defaults.cols,
    filters: search.filters ?? {},
    fiscalYear: search.fy,
    hidePlaceholders: search.hide_placeholders === 1,
    includeSuperseded: search.include_superseded === 1,
  };
}

export function parseSort(sort: string | undefined) {
  if (!sort) return null;
  return sort.startsWith("-") ? { field: sort.slice(1), desc: true } : { field: sort, desc: false };
}

export function formatSort(field: string, desc: boolean) {
  return desc ? `-${field}` : field;
}

/**
 * Search updates for each table action. Every change but paging goes back
 * to the first page, and values equal to their defaults are dropped so the
 * URL only shows what differs.
 */
export const searchUpdates = {
  page: (page: number) => (search: TableSearch) => ({
    ...search,
    page: page > 1 ? page : undefined,
  }),
  size: (size: PageSize) => (search: TableSearch) => ({
    ...search,
    page: undefined,
    size: size === DEFAULT_PAGE_SIZE ? undefined : size,
  }),
  sort: (sort: string | undefined, defaults: TableDefaults) => (search: TableSearch) => ({
    ...search,
    page: undefined,
    sort: sort === defaults.sort ? undefined : sort,
  }),
  filter: (field: string, filter: FieldFilter | undefined) => (search: TableSearch) => {
    const filters = { ...search.filters };
    if (filter && filter.constraints.length > 0) filters[field] = filter;
    else delete filters[field];
    return {
      ...search,
      page: undefined,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    };
  },
  clearFilters: () => (search: TableSearch) => ({
    ...search,
    page: undefined,
    filters: undefined,
  }),
  fiscalYear: (year: number | undefined) => (search: TableSearch) => ({
    ...search,
    page: undefined,
    fy: year,
  }),
  toggle: (toggle: Toggle, on: boolean) => (search: TableSearch) => ({
    ...search,
    page: undefined,
    [toggle]: on ? 1 : undefined,
  }),
  /**
   * Show these columns; the filter and sort of a column this hides go too.
   * Those on a field that wasn't shown (a link's) stay:
   * their chip and note say so, and they aren't the user's to lose here.
   * `shown`: the columns on screen now (not the address's `cols`, which
   * may name ones this list hasn't).
   */
  cols: (cols: string[], defaults: TableDefaults, shown: string[]) => (search: TableSearch) => {
    const visible = new Set(cols);
    const wereShown = new Set(shown);
    const hidden = (field: string) => wereShown.has(field) && !visible.has(field);
    const filters = Object.fromEntries(
      Object.entries(search.filters ?? {}).filter(([field]) => !hidden(field)),
    );
    const changedFilters = Object.keys(filters).length !== Object.keys(search.filters ?? {}).length;
    // A sort no header shows would go unseen: back to the list's own
    const sorted = parseSort(search.sort);
    const changedSort = sorted !== null && hidden(sorted.field);
    return {
      ...search,
      page: changedFilters || changedSort ? undefined : search.page,
      sort: changedSort ? undefined : search.sort,
      cols: sameMembers(cols, defaults.cols) ? undefined : cols,
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    };
  },
};

function sameMembers(a: string[], b: string[]) {
  return a.length === b.length && a.every((item) => b.includes(item));
}
