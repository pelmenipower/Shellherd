import { KIND_COLUMNS, type KubeRow } from '../../shared/kubernetes';
import { formatAge } from './kube-view';

/** Events table as TSV with the visible header; tabs and line breaks inside a cell become spaces. Empty string without rows. */
export function eventsTsv(rows: readonly KubeRow[], now: number): string {
  if (rows.length === 0) return '';
  const columns = KIND_COLUMNS.events;
  const clean = (value: string): string => value.replace(/[\t\r\n]+/g, ' ');
  const lines = [columns.map(column => clean(column.label)).join('\t')];
  for (const row of rows) {
    lines.push(columns.map(column => {
      const value = row.cells[column.key];
      return clean(column.age ? formatAge(String(value ?? ''), now) : String(value ?? ''));
    }).join('\t'));
  }
  return lines.join('\n');
}

/** Status line after a successful copy, e.g. "Kopiert: Logs (123 Zeilen)". */
export function copiedMessage(label: string, text: string): string {
  const count = text.split('\n').length;
  return `Kopiert: ${label} (${count} ${count === 1 ? 'Zeile' : 'Zeilen'})`;
}
