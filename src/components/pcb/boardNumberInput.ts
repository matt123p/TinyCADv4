import {
  detectInitialLanguage,
  LANGUAGE_STORAGE_KEY,
} from '../../i18n/languages';
import { lengthInNanometres } from '../../pcb/geometry';
import type { LengthUnit } from '../../pcb/geometry';

const separators = new Map<string, string>();

function decimalSeparator(locale: string) {
  if (!separators.has(locale)) {
    const separator =
      new Intl.NumberFormat(locale)
        .formatToParts(1.1)
        .find(({ type }) => type === 'decimal')?.value ?? '.';
    separators.set(locale, separator);
  }
  return separators.get(locale);
}

/** The editor accepts local decimal input. Files and geometry use canonical numbers. */
export function canonicalBoardDecimal(value: string, locale?: string) {
  const browserLocale =
    typeof window !== 'undefined' &&
    !window.localStorage.getItem(LANGUAGE_STORAGE_KEY)
      ? window.navigator.language
      : undefined;
  const separator = decimalSeparator(
    locale ?? browserLocale ?? detectInitialLanguage(),
  );
  if (separator === '.') return value;
  // Leave any second separator intact so the receiving parser rejects it.
  if (value.includes('.')) return value;
  return value.replace(separator, '.');
}

export function boardInputLength(
  value: string,
  unit: LengthUnit = 'mm',
  locale?: string,
) {
  return lengthInNanometres(canonicalBoardDecimal(value, locale), unit);
}

/** Keep legacy comma-separated coordinate lists alongside local decimal commas. */
export function boardCoordinateFields(line: string, count: number) {
  const text = line.trim();
  const whitespace = text.split(/\s+/);
  const fields = text.includes(';')
    ? text.split(';')
    : whitespace.length === count &&
      whitespace.every(
        (field) => !field.startsWith(',') && !field.endsWith(','),
      )
    ? whitespace
    : text.split(',');
  const values = fields.map((field) => field.trim());
  if (values.length !== count || values.some((field) => !field))
    throw new Error(
      'Enter ' + count + ' coordinates separated by spaces or semicolons.',
    );
  return values;
}
