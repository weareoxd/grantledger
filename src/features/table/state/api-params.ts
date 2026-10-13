import type { Filters } from "./schema";
import { parseSort, type TableState } from "./table-state";

/**
 * Table state -> list endpoint query, in the API's filter grammar
 * (backend/app/api/params.py): `page`, `page_size`, `sort`, `sort_order`,
 * the flat `fiscal_year`, `hide_placeholders` and `include_superseded`, and
 * per field `<field>[<i>][value]`, `<field>[<i>][matchMode]`,
 * `<field>[operator]`.
 */
export function toApiParams(
  state: Pick<
    TableState,
    "page" | "size" | "sort" | "filters" | "fiscalYear" | "hidePlaceholders" | "includeSuperseded"
  >,
) {
  const params = new URLSearchParams();
  params.set("page", String(state.page));
  params.set("page_size", String(state.size));

  const sort = parseSort(state.sort);
  if (sort) {
    params.set("sort", sort.field);
    params.set("sort_order", sort.desc ? "desc" : "asc");
  }
  if (state.fiscalYear !== undefined) {
    params.set("fiscal_year", String(state.fiscalYear));
  }
  if (state.hidePlaceholders) params.set("hide_placeholders", "true");
  if (state.includeSuperseded) params.set("include_superseded", "true");

  appendFilters(params, state.filters);
  return params;
}

export function appendFilters(params: URLSearchParams, filters: Filters) {
  for (const [field, filter] of Object.entries(filters)) {
    filter.constraints.forEach(({ matchMode, value }, index) => {
      params.set(`${field}[${index}][value]`, value);
      params.set(`${field}[${index}][matchMode]`, matchMode);
    });
    params.set(`${field}[operator]`, filter.operator);
  }
}
