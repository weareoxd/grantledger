/**
 * The files each import source covers, and where they're published.
 *
 * - alberta_live: Alberta's live export of the current fiscal year, saved under the fiscal year it
 *   contains (tbf-grants-disclosure-2026-27.csv), so the official yearly file replaces it once
 *   published.
 * - alberta_archive: the official yearly files. 2014-15 to 2019-20 are the "(standardized)"
 *   resources: the original files for those years have thousands of rows with unquoted commas
 *   that shift columns.
 * - federal: the Government of Canada's consolidated grants.csv (about 2.3 GB).
 */
import type { ImportSource } from "@/lib/domain";
import { getEnv } from "@/lib/env";
import type { OrganizationKey } from "./constants";

export interface SourceFile {
  /** The key its download state is stored under. */
  key: string;
  url: string;
  organization: OrganizationKey;
  /** The file's name in the data directory and in award.source_file; null until known. */
  sourceFile: string | null;
  /** Where it's saved, relative to DATA_DIR. */
  path: string;
}

export const ALBERTA_ARCHIVE: [resource: string, fiscalYear: string][] = [
  ["3a822e71-4dc9-41da-8147-cc693a4e2829", "2014-15"],
  ["73f0fc9b-de26-49d1-a6d2-26a150e20c9d", "2015-16"],
  ["8b6af39d-5815-4e5d-9a4f-29c7f4bf63a5", "2016-17"],
  ["ee66f4db-2668-4faf-a208-1d426a6fb580", "2017-18"],
  ["abf3ef21-8a22-418a-bf8f-7d93b9ec6da5", "2018-19"],
  ["bd6f09bc-5db3-46ec-959c-e30a0b1d09f3", "2019-20"],
  ["ef6f0f85-7f5e-449e-8a54-3d45e37f3dc4", "2020-21"],
  ["bda2903e-8106-47be-824e-2b22636c8a05", "2021-22"],
  ["a9a92ce7-c005-418d-a411-b663254c601a", "2022-23"],
  ["0c7e93c1-1c28-460d-92eb-f6934e9ba4a8", "2023-24"],
  ["f4197a5a-b3c3-4045-b2ce-7f77d700935f", "2024-25"],
  ["1e95ba75-b4b1-44df-9426-988d60b6cff7", "2025-26"],
];

export const albertaFileName = (fiscalYear: string) => `tbf-grants-disclosure-${fiscalYear}.csv`;

export function sourceFiles(source: ImportSource): SourceFile[] {
  const env = getEnv();
  switch (source) {
    case "alberta_live":
      return [
        {
          key: "alberta_live",
          url: env.ALBERTA_LIVE_URL,
          organization: "alberta",
          sourceFile: null,
          path: "alberta/.current-export.csv",
        },
      ];
    case "alberta_archive":
      return ALBERTA_ARCHIVE.map(([resource, fiscalYear]) => {
        const name = albertaFileName(fiscalYear);
        return {
          key: `alberta_archive:${fiscalYear}`,
          url: `${env.ALBERTA_ARCHIVE_BASE}/${resource}/download/${name}`,
          organization: "alberta",
          sourceFile: name,
          path: `alberta/${name}`,
        };
      });
    case "federal":
      return [
        {
          key: "federal",
          url: env.FEDERAL_GRANTS_URL,
          organization: "federal",
          sourceFile: "grants.csv",
          path: "federal/grants.csv",
        },
      ];
  }
}

/**
 * The fiscal year in the live export's first data row ("2026 - 2027" in DisplayFiscalYear), as
 * the yearly files name it: "2026-27".
 */
export function exportFiscalYear(firstRows: string): string | null {
  const match = /(\d{4}) - \d{2}(\d{2})/.exec(firstRows.split(/\r?\n/)[1] ?? "");
  return match ? `${match[1]}-${match[2]}` : null;
}
