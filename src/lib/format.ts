import type { LocalCurrency } from '@/lib/database.types';

/**
 * Plain decimal formatters. The `$` is prepended by hand instead of using
 * `style: 'currency'`, which renders `US$ 1.234,56` in this locale, and instead
 * of `currencyDisplay: 'narrowSymbol'`, which would place the minus sign after
 * the symbol (`$-50,00`).
 */
const USD_FORMATTER = new Intl.NumberFormat('es-VE', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const LOCAL_FORMATTERS: Record<LocalCurrency, Intl.NumberFormat> = {
  VES: new Intl.NumberFormat('es-VE', {
    style: 'currency',
    currency: 'VES',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
  COP: new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }),
};

const COMPACT_USD_FORMATTER = new Intl.NumberFormat('es-VE', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

const PERCENT_FORMATTER = new Intl.NumberFormat('es-VE', {
  style: 'percent',
  maximumFractionDigits: 1,
});

/**
 * Formats a USD amount as `$1.234,56`. Accepts the string Postgres returns for
 * `numeric` columns as well as a number, and renders null/undefined as a dash.
 * A negative amount reads `−$50,00`, with the sign outside the symbol.
 */
export function formatUsd(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  return `${amount < 0 ? '−' : ''}$${USD_FORMATTER.format(Math.abs(amount))}`;
}

/**
 * Formats the original amount of a transaction in the currency it was paid in,
 * shown alongside its canonical USD value. The currency must be explicit: the
 * imported history mixes bolivares and Colombian pesos.
 */
export function formatLocal(
  value: number | string | null | undefined,
  currency: LocalCurrency | null | undefined,
): string {
  if (value === null || value === undefined || value === '') return '—';
  if (currency === null || currency === undefined) return '—';
  return LOCAL_FORMATTERS[currency].format(Number(value));
}

/**
 * Formats a USD amount in compact notation ($1,2 mil) for chart axes and tiles
 * where horizontal space is scarce.
 */
export function formatUsdCompact(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const amount = Number(value);
  return `${amount < 0 ? '−' : ''}$${COMPACT_USD_FORMATTER.format(Math.abs(amount))}`;
}

/**
 * Formats a ratio expressed as a fraction (0.42) into a percentage string.
 */
export function formatPercent(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return PERCENT_FORMATTER.format(Number(value));
}

/**
 * Formats an ISO date (`YYYY-MM-DD`) as `21 mar 2025`, matching the notation the
 * spreadsheet used. Parsed as UTC so the calendar day never shifts by timezone.
 */
export function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  return new Intl.DateTimeFormat('es-VE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Formats a month key (`YYYY-MM-01`) as `marzo 2025` for period headings.
 */
export function formatMonth(isoDate: string): string {
  const [year, month] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, 1));
  return new Intl.DateTimeFormat('es-VE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/**
 * Returns the first day of the month containing the given date, as `YYYY-MM-01`.
 * Budgets are keyed by this value.
 */
export function toMonthKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}-01`;
}
