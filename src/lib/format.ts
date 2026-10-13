// Amounts are Canadian dollars
const LOCALE = "en-CA";

const numberFormat = new Intl.NumberFormat(LOCALE);
const currencyFormat = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "CAD",
  currencySign: "accounting",
});

/** 1234567 -> "1,234,567"; missing values are 0 */
export function formatNumber(value: number | string | null | undefined) {
  return numberFormat.format(toNumber(value) ?? 0);
}

/** Exact amount with cents: 1234.5 -> "$1,234.50" */
export function formatCurrency(value: number | string | null | undefined) {
  const amount = toNumber(value);
  return amount === null ? "–" : currencyFormat.format(amount);
}

const SCALES = [
  { min: 1e12, divisor: 1e12, suffix: "T", digits: 2 },
  { min: 1e9, divisor: 1e9, suffix: "B", digits: 2 },
  { min: 1e6, divisor: 1e6, suffix: "M", digits: 2 },
  { min: 1e4, divisor: 1e3, suffix: "K", digits: 0 },
];

/**
 * Compact amount for tables: $12K, $1.23M, $4.56B. Below $10K the exact
 * amount is shown; missing and zero amounts are a dash.
 */
export function formatRoundedCurrency(value: number | string | null | undefined) {
  const amount = toNumber(value);
  if (!amount) return "–";

  const magnitude = Math.abs(amount);
  let index = SCALES.findIndex(({ min }) => magnitude >= min);
  if (index === -1) return currencyFormat.format(amount);
  // Rounded up into the next unit: 999,600 is $1.00M, not $1,000K
  const { divisor, digits } = SCALES[index]!;
  if (index > 0 && Math.round((magnitude / divisor) * 10 ** digits) >= 1000 * 10 ** digits) {
    index -= 1;
  }
  const scale = SCALES[index]!;

  const scaled = (magnitude / scale.divisor).toLocaleString(LOCALE, {
    minimumFractionDigits: scale.digits,
    maximumFractionDigits: scale.digits,
  });
  return `${amount < 0 ? "-" : ""}$${scaled}${scale.suffix}`;
}

const axisCurrencyFormat = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "CAD",
  currencyDisplay: "narrowSymbol",
  notation: "compact",
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

/** An amount on a chart's axis, short: "$300M", "$1.5B" */
export function formatAxisCurrency(amount: number) {
  return axisCurrencyFormat.format(amount);
}

/** A count of things: "1 payment", "2,000 payments" */
export function formatCount(count: number, one: string, many = `${one}s`) {
  return `${numberFormat.format(count)} ${count === 1 ? one : many}`;
}

/**
 * The change from `previous` to `current`, as a fraction (0.12 for 12%
 * more); null when there was nothing before to compare with
 */
export function percentChange(current: number, previous: number) {
  return previous > 0 ? (current - previous) / previous : null;
}

/** A fraction as a whole percentage: 0.123 -> "12%" */
export function formatPercent(fraction: number) {
  return `${numberFormat.format(Math.round(fraction * 100))}%`;
}

/**
 * A rise of ten times or more as a multiple, which reads better than
 * "3,328%": "34×", or ">100×"; null for less
 */
export function formatMultiple(change: number) {
  const times = Math.round(1 + change);
  if (times < 10) return null;
  return times > 100 ? ">100×" : `${numberFormat.format(times)}×`;
}

/** A change in words: "up 12%", "down 8%", "up 34×" or "unchanged" */
export function formatChange(change: number) {
  const multiple = formatMultiple(change);
  if (multiple) return `up ${multiple}`;
  const percent = Math.round(Math.abs(change) * 100);
  if (percent === 0) return "unchanged";
  return `${change > 0 ? "up" : "down"} ${numberFormat.format(percent)}%`;
}

/** API date-only string ("2024-05-01") -> local Date, without a UTC shift */
export function parseDateOnly(value: string | null | undefined) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number];
  const date = new Date(year, month - 1, day);
  // Rejects 2024-02-30 and the like, which Date would roll over
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

/** Date -> API date-only string ("2024-05-01") */
export function formatDateOnly(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Display form of an API date-only string; ISO, so it reads the same anywhere */
export function formatDate(value: string | null | undefined) {
  return parseDateOnly(value) ? (value as string) : "–";
}

/**
 * Fiscal year containing a date. Fiscal years run April to March and are
 * named for the year they start in: FY2024 = Apr 1 2024 - Mar 31 2025.
 */
export function fiscalYearOf(date: Date) {
  return date.getMonth() < 3 ? date.getFullYear() - 1 : date.getFullYear();
}

function toNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}
