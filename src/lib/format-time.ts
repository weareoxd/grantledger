/** Times and sizes for the Worker and Admin pages, in the app's time zone. */

const TIME_ZONE = "America/Edmonton";

const dateTimeFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const toDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

export function formatDateTime(value: Date | string | null | undefined) {
  return value ? dateTimeFormat.format(toDate(value)) : "—";
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];
const relativeFormat = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "3 hours ago", "in 2 days". */
export function formatRelative(value: Date | string | null | undefined, now = Date.now()) {
  if (!value) return "—";
  const seconds = (toDate(value).getTime() - now) / 1000;
  for (const [unit, size] of RELATIVE_UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return Math.abs(seconds) < 45
    ? "just now"
    : relativeFormat.format(Math.round(seconds / 60), "minute");
}

/** "1.2 GB", "340 KB". */
export function formatBytes(bytes: number | null | undefined) {
  if (bytes === null || bytes === undefined) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** "4 min 12 s", "37 s". */
export function formatDuration(from: string | null, to: string | null) {
  if (!from || !to) return null;
  const seconds = Math.max(0, Math.round((toDate(to).getTime() - toDate(from).getTime()) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${seconds % 60} s`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}
