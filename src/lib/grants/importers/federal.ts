/**
 * Importer for the Government of Canada's Proactive Disclosure of Grants and Contributions
 * (open.canada.ca, `grants.csv`).
 *
 * One row per agreement *amendment*: `ref_number` + `amendment_number` identify it, and each
 * amendment restates the full agreement value. Every amendment is kept for history;
 * `is_current` marks the latest one so totals don't double count.
 */
import { createHash } from "node:crypto";
import { AGREEMENT_TYPES, RECIPIENT_TYPES } from "@/lib/grants/constants";
import {
  cleanDisplay,
  looksLikePerson,
  NOT_DISCLOSED,
  normalizeName,
  truncate,
  WITHHELD_INDIVIDUAL,
} from "@/lib/grants/normalize";
import { type ImportOptions, type RowParser, runImport } from "./base";
import { clean, cleanMax, parseDate, parseDecimal, parseIntLoose } from "./parse";

/**
 * "Polytechnique Montreal|École Polytechnique de Montréal" -> "Polytechnique Montreal".
 *
 * Many federal recipient names are published as "English|French" pairs (often the same name
 * twice). Keeping the English half, as for department names, lets the same organization match
 * across rows and against the Alberta file.
 */
export function englishName(value: string | null | undefined): string | null {
  let text = clean(value);
  if (text?.includes("|")) text = clean(text.split("|", 1)[0]);
  return text;
}

/**
 * One key for every disclosed version of an agreement.
 *
 * Federal rules say an amendment keeps the agreement's reference number, but several departments
 * (Indigenous Services Canada, Health Canada, IRCC, ...) file each amendment under a new one while
 * keeping the department's agreement number, recipient and start date. Grouping on those three
 * keeps one current version per agreement; counting every reference overstates federal totals by
 * about a third. The agreement number alone is not enough: some departments reuse program codes
 * ("RGPIN") across many recipients, and a recipient's yearly grants under one code differ by start
 * date. Rows without an agreement number fall back to the reference. Hashed, so a withheld
 * individual's name is never stored.
 */
export function agreementKey(
  reference: string,
  agreementNumber: string | null,
  recipientName: string | null,
  start: string,
): string {
  if (!agreementNumber) return truncate(`ref:${reference}`, 64);
  const basis = [
    agreementNumber.trim().toUpperCase(),
    normalizeName(recipientName ?? ""),
    start,
  ].join("|");
  return `an:${createHash("sha1").update(basis, "utf8").digest("hex").slice(0, 40)}`;
}

/** "Accessibility Standards Canada | Normes d’accessibilité Canada" -> English half. */
export function departmentName(ownerOrgTitle: string | null | undefined): string {
  const title = clean(ownerOrgTitle) || "Unknown department";
  return truncate((title.split(" | ")[0] as string).trim(), 255);
}

// Recipient types that are never individuals. Every other type (including blank legacy rows) is
// checked by name: personal names are disclosed under for-profit (farm couples), not-for-profit,
// Indigenous and "other" types as well.
const INSTITUTIONAL_TYPES = new Set(["G", "S"]);

/** Type P is an individual; government and academia never are; others go by name. */
export function isIndividual(recipientType: string | null, name: string | null): boolean {
  if (recipientType === "P") return true;
  if (recipientType && INSTITUTIONAL_TYPES.has(recipientType)) return false;
  return Boolean(name) && looksLikePerson(name);
}

function code(value: string | null | undefined, table: Record<string, string>) {
  const letter = (clean(value) ?? "").toUpperCase().slice(0, 1) || null;
  return letter && letter in table ? letter : null;
}

export function makeParser(includeIndividuals = false): RowParser {
  return (row) => {
    const reference = clean(row.ref_number);
    const start = parseDate(row.agreement_start_date);
    if (!reference || start === null) return null;

    const recipientType = code(row.recipient_type, RECIPIENT_TYPES);
    const agreementType = code(row.agreement_type, AGREEMENT_TYPES);
    const rawName =
      englishName(row.recipient_legal_name) || englishName(row.recipient_operating_name);
    const agreementNumber = cleanMax(row.agreement_number, 128);

    const fields = {
      record_kind: "agreement" as const,
      reference: truncate(reference, 255),
      agreement_number: agreementNumber,
      agreement_key: agreementKey(reference, agreementNumber, rawName, start),
      amendment_number: parseIntLoose(row.amendment_number),
      amendment_date: parseDate(row.amendment_date),
      agreement_type: agreementType,
      recipient_type: recipientType,
      recipient_province: cleanMax(row.recipient_province, 64),
      recipient_city: cleanMax(row.recipient_city, 255),
      value: parseDecimal(row.agreement_value),
      start_date: start,
      end_date: parseDate(row.agreement_end_date),
      title: cleanMax(row.agreement_title_en, 1000),
      description: clean(row.description_en),
      naics: cleanMax(row.naics_identifier, 16),
    };

    let key: string;
    let display: string;
    if (!includeIndividuals && isIndividual(recipientType, rawName)) {
      key = display = WITHHELD_INDIVIDUAL;
      // Titles, descriptions and cities can identify a person; drop them too.
      fields.recipient_city = null;
      fields.title = null;
      fields.description = null;
    } else if (!rawName) {
      key = display = NOT_DISCLOSED;
    } else {
      key = normalizeName(rawName) || NOT_DISCLOSED;
      display = cleanDisplay(rawName);
    }

    return {
      ministry: departmentName(row.owner_org_title),
      program: cleanMax(row.prog_name_en, 500),
      recipientKey: key,
      recipientDisplay: display,
      fields,
    };
  };
}

export function importFederal(
  path: string,
  options: ImportOptions & { includeIndividuals?: boolean } = {},
) {
  return runImport(path, "federal", makeParser(options.includeIndividuals), options);
}
