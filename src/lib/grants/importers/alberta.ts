/**
 * Importer for the Government of Alberta's Grant Payments Disclosure (open.alberta.ca, one
 * `tbf-grants-disclosure-<fy>.csv` per fiscal year).
 *
 * One row per cash payment. Two header layouts exist: the yearly files (`Lottery`, ISO dates,
 * `FiscalYear`) and the live current-year export (`LotteryFund`, US-style timestamps, a trailing
 * empty column). Rows with a blank recipient are Alberta's own unnamed aggregates (physician
 * fee-for-service, income-support benefits, ...); they usually have no payment date, so their
 * start_date is the first day of the fiscal year and flagged as estimated.
 */
import { fiscalYearBounds } from "@/lib/grants/fiscal";
import {
  cleanDisplay,
  looksLikePerson,
  NOT_DISCLOSED,
  normalizeName,
  truncate,
  WITHHELD_INDIVIDUAL,
} from "@/lib/grants/normalize";
import { type ImportOptions, type RowParser, runImport } from "./base";
import type { CsvRow } from "./csv";
import { clean, cleanMax, parseBool, parseDate, parseDecimal } from "./parse";

const SMALL_WORDS = new Set(["and", "of", "the", "for", "in", "on", "to", "de", "la", "du", "des"]);

// Spellings that only occur because of publishing errors, mapped to the ministry's real name.
// Genuine reorganisations (e.g. Children's Services -> Children and Family Services) are left
// alone: Alberta reports payments under the ministry of the day.
const MINISTRY_FIXES: Record<string, string> = {
  "CULTURE,MULTICULTURALISMANDSTATUSOFWOMEN": "CULTURE, MULTICULTURALISM AND STATUS OF WOMEN",
  "SENIORS AND HOUSING TBI": "SENIORS AND HOUSING",
};

/** "SENIORS, COMMUNITY AND SOCIAL SERVICES" -> "Seniors, Community and Social Services". */
export function ministryTitle(raw: string): string {
  let name = MINISTRY_FIXES[raw.toUpperCase().trim()] ?? raw;
  name = name.replace(/,(?=\S)/g, ", "); // "A,B" -> "A, B"
  const words = name.toLowerCase().split(/\s+/).filter(Boolean);
  return truncate(
    words
      .map((word, i) =>
        i && SMALL_WORDS.has(word) ? word : word.slice(0, 1).toUpperCase() + word.slice(1),
      )
      .join(" "),
    255,
  );
}

export function fiscalYearOfRow(row: CsvRow): number | null {
  const year = clean(row.FiscalYear);
  if (year && /^\d+$/.test(year)) return Number(year);
  const display = clean(row.DisplayFiscalYear) ?? "";
  const match = /^\s*(\d{4})/.exec(display);
  return match ? Number(match[1]) : null;
}

export function makeParser(includeIndividuals = false): RowParser {
  return (row, lineNo) => {
    const ministry = clean(row.Ministry);
    const fiscalYear = fiscalYearOfRow(row);
    if (!ministry || fiscalYear === null) return null;

    let day = parseDate(row.PaymentDate);
    const estimated = day === null;
    if (day === null) day = fiscalYearBounds(fiscalYear)[0];

    const rawName = clean(row.Recipient);
    let key: string;
    let display: string;
    if (!rawName) {
      key = display = NOT_DISCLOSED;
    } else if (!includeIndividuals && looksLikePerson(rawName)) {
      key = display = WITHHELD_INDIVIDUAL;
    } else {
      key = normalizeName(rawName) || NOT_DISCLOSED;
      display = cleanDisplay(rawName);
    }

    const lotteryRaw = "Lottery" in row ? row.Lottery : row.LotteryFund;
    return {
      ministry: ministryTitle(ministry),
      program: cleanMax(row.Program, 500),
      recipientKey: key,
      recipientDisplay: display,
      fields: {
        record_kind: "payment",
        reference: `AB-${fiscalYear}-${String(lineNo).padStart(7, "0")}`,
        is_current: true,
        value: parseDecimal(row.Amount),
        start_date: day,
        start_date_estimated: estimated,
        business_unit: cleanMax(row.BUName, 255),
        lottery_fund: parseBool(lotteryRaw),
      },
    };
  };
}

export function importAlberta(
  path: string,
  options: ImportOptions & { includeIndividuals?: boolean } = {},
) {
  return runImport(path, "alberta", makeParser(options.includeIndividuals), options);
}
