"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SearchXIcon } from "lucide-react";
import { useEffect, useMemo } from "react";

import { useDocumentTitle, useScopeParams } from "@/app-shell/scope";
import { ErrorState } from "@/components/ErrorState";
import { NotFound } from "@/components/NotFound";
import { Button } from "@/components/ui/button";
import { ColumnPicker } from "@/features/table/ColumnPicker";
import { DataTable } from "@/features/table/DataTable";
import { ExportButton } from "@/features/table/ExportButton";
import { FilterChips } from "@/features/table/FilterChips";
import { ListOptions } from "@/features/table/ListOptions";
import { Paginator } from "@/features/table/Paginator";
import { toApiParams } from "@/features/table/state/api-params";
import {
  resolveTableState,
  searchUpdates,
  type TableDefaults,
} from "@/features/table/state/table-state";
import { useTableSearch } from "@/features/table/useTableSearch";
import { isApiError } from "@/lib/api/errors";
import { formatNumber } from "@/lib/format";
import { kindText } from "@/lib/record-kind";

import { defaultColumnIds, listColumns } from "./columns";
import * as configs from "./configs";
import { rememberNames } from "./names";
import { organizationsQueryOptions, useOrganization } from "./organizations";
import { listQueryOptions } from "./query";
import type { LinkContext, ListConfig, ListRow, ScopeParams } from "./types";

const NO_ROWS: ListRow[] = [];

/** A server-side paged, sorted and filtered list, its state in the URL */
export function ListPage({ config }: { config: ListConfig }) {
  const params: ScopeParams = useScopeParams();
  const [search, setSearch] = useTableSearch();
  const queryClient = useQueryClient();
  const { organization, kind, isLoading } = useOrganization(params.organization_id);
  const title = kindText(config.title, kind);
  const noun = {
    one: kindText(config.noun.one, kind),
    other: kindText(config.noun.other, kind),
  };

  const available = useMemo(() => listColumns(config, kind), [config, kind]);
  const includeSuperseded = search.include_superseded === 1;
  const defaults = useMemo<TableDefaults>(
    () => ({
      sort: config.defaultSort,
      cols: defaultColumnIds(available, config, { includeSuperseded }),
    }),
    [available, config, includeSuperseded],
  );
  const state = resolveTableState(search, defaults);
  const visible = useMemo(() => {
    const chosen = available.filter(({ id }) => state.cols.includes(id));
    return chosen.length > 0 ? chosen : available.filter(({ id }) => defaults.cols.includes(id));
  }, [available, state.cols, defaults.cols]);
  const linkContext = useMemo<LinkContext>(
    () => ({
      fiscalYear: state.fiscalYear,
      hidePlaceholders: state.hidePlaceholders,
    }),
    [state.fiscalYear, state.hidePlaceholders],
  );

  // The fiscal years with data: the organization's, or on the organizations
  // page either's
  const organizations = useQuery({
    ...organizationsQueryOptions,
    enabled: Boolean(config.toggles?.fiscalYear && !params.organization_id),
  });
  const fiscalYears = useMemo(() => {
    const years = organization
      ? organization.fiscal_years
      : (organizations.data ?? []).flatMap((each) => each.fiscal_years);
    return [...new Set(years)].sort((a, b) => b - a);
  }, [organization, organizations.data]);

  const apiParams = toApiParams(state);
  const path = config.endpoint(params);
  const query = useQuery(listQueryOptions(path, apiParams));
  const rows = query.data?.data ?? NO_ROWS;

  useEffect(() => {
    // Not the last page's rows, shown while another recipient's or
    // ministry's load: they'd name it after the one before
    if (query.data && !query.isPlaceholderData) {
      rememberNames(queryClient, params, query.data);
    }
  }, [query.data, query.isPlaceholderData, queryClient, params]);

  // A page past the end (e.g. after filtering elsewhere): go to the first
  const invalidPage = isApiError(query.error, 404) && state.page > 1;
  useEffect(() => {
    if (invalidPage) setSearch(searchUpdates.page(1), { replace: true });
  }, [invalidPage, setSearch]);

  const filterErrors = isApiError(query.error, 400) ? query.error.fieldErrors : {};
  useDocumentTitle(title);

  // The first page not found: the list's ministry, program or recipient
  // isn't there (the data was loaded again since the link was made)
  if (isApiError(query.error, 404) && state.page <= 1) return <NotFound />;

  const shownIds = visible.map(({ id }) => id);
  const failed = query.isError && !invalidPage;
  const count = query.data?.count ?? 0;
  const hasFilters = Object.keys(state.filters).length > 0;
  const toggles = config.toggles ?? {};

  return (
    // The rest of the screen, but never so little that the table is
    // squashed: below that, the page scrolls
    <div className="flex min-h-[28rem] flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-semibold text-xl tracking-tight">
            {title}
            {query.data && (
              <>
                {" "}
                <span className="font-normal">({formatNumber(count)})</span>
              </>
            )}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ListOptions
            fiscalYears={toggles.fiscalYear ? fiscalYears : undefined}
            fiscalYear={state.fiscalYear}
            onFiscalYearChange={(year) => setSearch(searchUpdates.fiscalYear(year))}
            hidePlaceholders={toggles.placeholders ? state.hidePlaceholders : undefined}
            includeSuperseded={
              // Only federal agreements are amended
              toggles.superseded && kind === "agreement" ? state.includeSuperseded : undefined
            }
            onToggle={(toggle, on) => setSearch(searchUpdates.toggle(toggle, on))}
          />
          <ColumnPicker
            columns={available}
            visible={shownIds}
            onChange={(cols) =>
              setSearch(searchUpdates.cols(cols, defaults, shownIds), {
                replace: true,
              })
            }
            onReset={() =>
              setSearch(searchUpdates.cols(defaults.cols, defaults, shownIds), {
                replace: true,
              })
            }
          />
          <ExportButton
            path={path}
            params={apiParams}
            columns={visible}
            count={count}
            stale={query.isPlaceholderData}
            filename={exportName(title)}
          />
        </div>
      </div>

      <FilterChips
        columns={available}
        kind={kind}
        filters={state.filters}
        errors={filterErrors}
        onRemove={(field) => setSearch(searchUpdates.filter(field, undefined))}
        onClear={() => setSearch(searchUpdates.clearFilters())}
      />

      {failed && Object.keys(filterErrors).length === 0 ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <DataTable
          // Another list (or the same one for another organization, ministry,
          // program or recipient) gets a fresh table, scrolled to the top-left
          key={path}
          scrollKey={apiParams.toString()}
          // Widths set on one list of a kind hold on all of them
          widthsKey={config.id}
          label={title}
          columns={visible}
          rows={failed ? NO_ROWS : rows}
          params={params}
          linkContext={linkContext}
          sort={state.sort}
          onSortChange={(sort) => setSearch(searchUpdates.sort(sort, defaults))}
          filters={state.filters}
          onFilterChange={(field, filter) => setSearch(searchUpdates.filter(field, filter))}
          filterErrors={filterErrors}
          footerTotals={query.data?.footer_totals}
          loading={query.isPending || isLoading}
          fetching={query.isFetching}
          pageSize={state.size}
          fill
          empty={
            failed && filterErrors.sort ? (
              // From an old link, say: a sort the list no longer has
              <div className="flex flex-col items-center gap-2 text-center">
                <p className="text-destructive text-sm">This list can't be sorted that way.</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearch(searchUpdates.sort(undefined, defaults))}
                >
                  Sort as usual
                </Button>
              </div>
            ) : failed ? (
              <p className="text-destructive text-sm">
                Some filters aren't valid. Remove the highlighted ones.
              </p>
            ) : (
              <div className="flex flex-col items-center gap-2 text-center">
                <SearchXIcon className="size-6 text-muted-foreground" />
                <p className="font-medium text-sm">No {noun.other}</p>
                {hasFilters && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSearch(searchUpdates.clearFilters())}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            )
          }
        />
      )}

      {query.data && count > 0 && (
        <Paginator
          page={state.page}
          size={state.size}
          count={count}
          noun={noun}
          onPageChange={(page) => setSearch(searchUpdates.page(page))}
          onSizeChange={(size) => setSearch(searchUpdates.size(size))}
        />
      )}
    </div>
  );
}

function exportName(title: string) {
  const date = new Date().toISOString().slice(0, 10);
  return `${title.toLowerCase().replace(/\s+/g, "-")}-${date}`;
}

/** Every list, by name: what a page (a server component) asks for, as it can't pass a config */
const LISTS = {
  organizationsList: configs.organizationsList,
  ministriesList: configs.ministriesList,
  ministryProgramsList: configs.ministryProgramsList,
  ministryRecipientsList: configs.ministryRecipientsList,
  programRecipientsList: configs.programRecipientsList,
  recipientsList: configs.recipientsList,
  recipientMinistriesList: configs.recipientMinistriesList,
  awardsList: configs.awardsList,
  ministryAwardsList: configs.ministryAwardsList,
  programAwardsList: configs.programAwardsList,
  recipientAwardsList: configs.recipientAwardsList,
  ministryRecipientAwardsList: configs.ministryRecipientAwardsList,
  programRecipientAwardsList: configs.programRecipientAwardsList,
} satisfies Record<string, ListConfig>;

export type ListName = keyof typeof LISTS;

/** A list page, by the list's name */
export function NamedListPage({ list }: { list: ListName }) {
  return <ListPage config={LISTS[list]} />;
}
