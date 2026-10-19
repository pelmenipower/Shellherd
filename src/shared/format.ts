import type { Locale } from './locale';

export type DateTimeStyle = 'short' | 'long' | 'time';

let current: Locale = 'de-DE';
const dateFormats = new Map<string, Intl.DateTimeFormat>();
const numberFormats = new Map<string, Intl.NumberFormat>();
const collators = new Map<Locale, Intl.Collator>();

export function setFormatLocale(locale: Locale): void {
  current = locale;
}

export function formatLocale(): Locale {
  return current;
}

const DATE_OPTIONS: Record<DateTimeStyle, Intl.DateTimeFormatOptions> = {
  short: { dateStyle: 'short', timeStyle: 'short' },
  long: { dateStyle: 'long' },
  time: { timeStyle: 'medium' },
};

/** short = dateStyle short + timeStyle short; long = dateStyle long; time = timeStyle medium. Invalid → ''. */
export function formatDateTime(value: Date | number | string, style: DateTimeStyle): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const key = `${current}|${style}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(current, DATE_OPTIONS[style]);
    dateFormats.set(key, format);
  }
  return format.format(date);
}

export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  const key = `${current}|${options ? JSON.stringify(options) : ''}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(current, options);
    numberFormats.set(key, format);
  }
  return format.format(value);
}

/** Intl.Collator(locale, { numeric: true, sensitivity: 'base' }). */
export function compareText(a: string, b: string): number {
  let collator = collators.get(current);
  if (!collator) {
    collator = new Intl.Collator(current, { numeric: true, sensitivity: 'base' });
    collators.set(current, collator);
  }
  return collator.compare(a, b);
}

export function foldCase(text: string): string {
  return text.toLocaleLowerCase(current);
}
