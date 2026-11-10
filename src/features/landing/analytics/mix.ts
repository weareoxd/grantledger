import type { OverviewSummary } from "../queries";

type Mix = NonNullable<OverviewSummary["mix"]>;

/** A fiscal year's agreements by type: grants, contributions and others */
export type MixYear = {
  fiscal_year: number;
  total: number;
  /** Agreements of each type, by its code */
  counts: Record<string, number>;
  /** Their value, by group */
  values: Record<string, number>;
};

/** The mix by fiscal year, one row a year, oldest first */
export function pivotMix(mix: Mix): MixYear[] {
  const years = new Map<number, MixYear>();
  for (const row of mix.by_year) {
    const year = years.get(row.fiscal_year) ?? {
      fiscal_year: row.fiscal_year,
      total: 0,
      counts: {},
      values: {},
    };
    year.total += row.count;
    year.counts[row.group] = (year.counts[row.group] ?? 0) + row.count;
    year.values[row.group] = (year.values[row.group] ?? 0) + row.value;
    years.set(row.fiscal_year, year);
  }
  return [...years.values()].sort((a, b) => a.fiscal_year - b.fiscal_year);
}

/** A type's share of a year's agreements, or null with none that year */
export function share(year: MixYear | undefined, group: string) {
  if (!year?.total) return null;
  return (year.counts[group] ?? 0) / year.total;
}

/** The type worth following: grants, which unlike contributions come with
 * no conditions on how they're spent or reported */
const WATCHED = ["G"];

/**
 * The share of `year`'s agreements of the type worth following, and of the
 * year before's (null with none then); null without that type or any
 * agreements in `year`
 */
export function watchedShare(mix: Mix, year: number) {
  const watched = mix.groups.find(({ key }) => WATCHED.includes(key));
  if (!watched) return null;
  const years = pivotMix(mix);
  const of = (fiscalYear: number) =>
    share(
      years.find((row) => row.fiscal_year === fiscalYear),
      watched.key,
    );
  const now = of(year);
  return now === null ? null : { label: watched.label, now, before: of(year - 1) };
}
