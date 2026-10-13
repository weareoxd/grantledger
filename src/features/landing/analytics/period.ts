import { formatDate } from "@/lib/format";

import type { OverviewSummary } from "../queries";

const fiscalYear = (year: number) => `FY${year}`;

/**
 * How to speak of a summary's year. While it runs: "this year", "so far",
 * to the day the data runs to, against the same point last year. Once its
 * data runs to March 31 (published a quarter late, say), it's over: by its
 * name, against the whole year before.
 */
export function period(summary: OverviewSummary) {
  const year = fiscalYear(summary.fiscal_year);
  const previous = fiscalYear(summary.fiscal_year - 1);
  if (summary.through === `${summary.fiscal_year + 1}-03-31`) {
    return {
      complete: true,
      /** The year to mark as partial in charts: none */
      partial: undefined,
      thisYear: `in ${year}`,
      soFar: `in ${year}`,
      span: year,
      against: previous,
    };
  }
  return {
    complete: false,
    partial: summary.fiscal_year,
    thisYear: "this year",
    soFar: "so far this year",
    span: `${year} to ${formatDate(summary.through)}`,
    against: `the same point in ${previous}`,
  };
}
