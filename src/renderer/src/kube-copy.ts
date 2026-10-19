import { KIND_COLUMNS, type KubeRow } from '../../shared/kubernetes';
import { formatAge } from './kube-view';
import { columnLabel } from './kube-labels';
import { t } from './i18n';

/** Events table as TSV with the visible header; tabs and line breaks inside a cell become spaces. Empty string without rows. */
export function eventsTsv(rows: readonly KubeRow[], now: number): string {
  if (rows.length === 0) return '';
  const columns = KIND_COLUMNS.events;
  const clean = (value: string): string => {
    // eslint-disable-next-line no-control-regex
    const flat = value.replace(/[\t\r\n]+/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
    return /^([=+@"]|-.)/.test(flat) ? `'${flat}` : flat;
  };
  const lines = [columns.map(column => clean(columnLabel(column.key))).join('\t')];
  for (const row of rows) {
    lines.push(columns.map(column => {
      const value = row.cells[column.key];
      return clean(column.age ? formatAge(String(value ?? ''), now) : String(value ?? ''));
    }).join('\t'));
  }
  return lines.join('\n');
}

/** Status line after a successful copy, e.g. "Kopiert: Logs (123 Zeilen)". `lines` overrides the count (Events: rows without header). */
export function copiedMessage(label: string, text: string, options: { lines?: number; shortened?: boolean } = {}): string {
  const count = options.lines ?? text.replace(/\r?\n$/, '').split('\n').length;
  return t(options.shortened ? 'kubeActions:copy.copiedShortened' : 'kubeActions:copy.copied', { label, count });
}

/** Keeps at most `max` characters from the end, starting at a line start when possible (clipboard IPC rejects over 4 MiB). */
export function capText(text: string, max: number): { text: string; shortened: boolean } {
  if (text.length <= max) return { text, shortened: false };
  const tail = text.slice(text.length - max);
  const atLineStart = text[text.length - max - 1] === '\n';
  const newline = tail.indexOf('\n');
  return { text: atLineStart || newline === -1 ? tail : tail.slice(newline + 1), shortened: true };
}
