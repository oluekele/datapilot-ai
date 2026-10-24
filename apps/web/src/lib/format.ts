const DAY_MS = 24 * 60 * 60 * 1000;

/** Format integer minor units (kobo, cents) as currency, e.g. ₦15,000 or $12.50. */
export function formatMoney(minor: number, currency = "NGN"): string {
  const major = minor / 100;
  const locale = currency.toUpperCase() === "NGN" ? "en-NG" : "en-US";
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currency.toUpperCase(),
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency.toUpperCase()} ${major.toLocaleString("en-US")}`;
  }
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(value: string | null | undefined): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
}

export function formatDateTime(value: string | null | undefined): string {
  const date = toDate(value);
  return date
    ? date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : "—";
}

export function formatRelative(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return "—";
  const diff = Date.now() - date.getTime();
  const abs = Math.abs(diff);
  const units: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [DAY_MS * 365, "year"],
    [DAY_MS * 30, "month"],
    [DAY_MS, "day"],
    [60 * 60 * 1000, "hour"],
    [60 * 1000, "minute"],
  ];
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [ms, unit] of units) {
    if (abs >= ms) return rtf.format(-Math.round(diff / ms), unit);
  }
  return "just now";
}

export function daysUntil(value: string | null | undefined): number | null {
  const date = toDate(value);
  if (!date) return null;
  return Math.max(0, Math.ceil((date.getTime() - Date.now()) / DAY_MS));
}

export function isFuture(value: string | null | undefined): boolean {
  const date = toDate(value);
  return !!date && date.getTime() > Date.now();
}

export function formatDuration(start: string | null, end: string | null): string {
  const a = toDate(start);
  const b = toDate(end);
  if (!a || !b) return "—";
  const seconds = Math.max(0, Math.round((b.getTime() - a.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

export function formatNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatInterval(interval: string): string {
  const normalised = interval.toLowerCase();
  if (normalised.startsWith("month")) return "month";
  if (normalised.startsWith("annual") || normalised.startsWith("year")) return "year";
  if (normalised.startsWith("quarter")) return "quarter";
  if (normalised.startsWith("week")) return "week";
  return normalised;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}
