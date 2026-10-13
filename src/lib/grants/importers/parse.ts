/**
 * Field parsers for the source files, matching the original Python importer: `clean`,
 * `parse_decimal` (Decimal quantized to cents, half-even), `parse_date` (strptime with four
 * formats) and `parse_bool`. Dates are ISO strings.
 */
import { isoDate } from "@/lib/grants/fiscal";
import { truncate } from "@/lib/grants/normalize";

/** Trim whitespace and stray wrapping quotes; "" becomes null. */
export function clean(value: string | null | undefined): string | null {
  let text = (value ?? "").trim();
  if (text.length >= 2 && text[0] === '"' && text[text.length - 1] === '"') {
    text = text.slice(1, -1).trim();
  }
  return text || null;
}

/** `(clean(value) or "")[:max] or None`. */
export function cleanMax(value: string | null | undefined, max: number): string | null {
  return truncate(clean(value) ?? "", max) || null;
}

const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * A money amount as a string with exactly two decimals ("1234.50"), or null. Thousands
 * separators and dollar signs are dropped; rounding is half-even, as Python's Decimal.quantize.
 */
export function parseDecimal(value: string | null | undefined): string | null {
  const text = clean(value)?.replaceAll(",", "").replaceAll("$", "").trim();
  if (!text) return null;
  const match = DECIMAL.exec(text);
  if (!match) return null;
  const [, sign, intPart = "", fracPart = "", expPart] = match;
  if (!intPart && !fracPart) return null;
  // value = digits * 10^(exp - fracPart.length)
  let digits = BigInt((intPart + fracPart).replace(/^0+(?=\d)/, "") || "0");
  let exponent = Number(expPart ?? 0) - fracPart.length;
  if (Math.abs(exponent) > 400) return null;
  // Scale to cents: cents = digits * 10^(exponent + 2), rounded half-even
  const shift = exponent + 2;
  if (shift >= 0) {
    digits *= 10n ** BigInt(shift);
  } else {
    const divisor = 10n ** BigInt(-shift);
    const quotient = digits / divisor;
    const remainder = digits % divisor;
    const twice = remainder * 2n;
    let rounded = quotient;
    if (twice > divisor || (twice === divisor && quotient % 2n === 1n)) rounded += 1n;
    digits = rounded;
  }
  exponent = 0;
  const negative = sign === "-" && digits !== 0n;
  const text2 = digits.toString().padStart(3, "0");
  return `${negative ? "-" : ""}${text2.slice(0, -2)}.${text2.slice(-2)}`;
}

// Spreadsheet "zero dates": Excel and similar tools write these for an empty date cell. They
// appear in the federal file in place of a missing start date.
const ZERO_DATES = new Set(["1899-12-30", "1899-12-31", "1900-01-01"]);

// strptime's patterns for %Y-%m-%d, %m/%d/%Y %I:%M:%S %p, %m/%d/%Y and %Y-%m-%d %H:%M:%S
const M = "(1[0-2]|0[1-9]|[1-9])";
const D = "(3[01]|[12]\\d|0[1-9]|[1-9]| [1-9])";
const Y = "(\\d\\d\\d\\d)";
const DATE_FORMATS: { pattern: RegExp; parts: (m: RegExpExecArray) => [number, number, number] }[] =
  [
    {
      pattern: new RegExp(`^${Y}-${M}-${D}$`),
      parts: (m) => [Number(m[1]), Number(m[2]), Number(m[3])],
    },
    {
      pattern: new RegExp(
        `^${M}/${D}/${Y}\\s+(1[0-2]|0[1-9]|[1-9]):([0-5]\\d|\\d):(6[0-1]|[0-5]\\d|\\d)\\s+(am|pm)$`,
        "i",
      ),
      parts: (m) => [Number(m[3]), Number(m[1]), Number(m[2])],
    },
    {
      pattern: new RegExp(`^${M}/${D}/${Y}$`),
      parts: (m) => [Number(m[3]), Number(m[1]), Number(m[2])],
    },
    {
      pattern: new RegExp(
        `^${Y}-${M}-${D}\\s+(2[0-3]|[0-1]\\d|\\d):([0-5]\\d|\\d):(6[0-1]|[0-5]\\d|\\d)$`,
      ),
      parts: (m) => [Number(m[1]), Number(m[2]), Number(m[3])],
    },
  ];

function validDate(year: number, month: number, day: number) {
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number;
  return day <= days;
}

/** Parse a source date to ISO; unparseable values and spreadsheet zero dates become null. */
export function parseDate(value: string | null | undefined): string | null {
  const text = clean(value);
  if (text === null) return null;
  for (const format of DATE_FORMATS) {
    const match = format.pattern.exec(text);
    if (!match) continue;
    const [year, month, day] = format.parts(match);
    if (!validDate(year, month, day)) continue;
    const iso = isoDate(year, month, day);
    return ZERO_DATES.has(iso) ? null : iso;
  }
  return null;
}

export function parseBool(value: string | null | undefined): boolean | null {
  const text = (value ?? "").trim().toLowerCase();
  if (["true", "t", "yes", "y", "1"].includes(text)) return true;
  if (["false", "f", "no", "n", "0"].includes(text)) return false;
  return null;
}

const FLOAT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Python's `int(float(clean(value) or default))`, falling back to the default. */
export function parseIntLoose(value: string | null | undefined, fallback = 0): number {
  const text = clean(value);
  if (text === null) return fallback;
  if (!FLOAT.test(text)) return fallback;
  const number = Math.trunc(Number(text));
  return Number.isFinite(number) && Math.abs(number) <= 2_147_483_647 ? number : fallback;
}
