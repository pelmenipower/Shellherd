import { t } from './i18n';
import { compareText, foldCase, formatDateTime, formatNumber } from '../../shared/format';
import type { FileEntry, TransferJob } from '../../shared/sftp';

export type FileSide = 'local' | 'remote';
export type SortKey = 'name' | 'size' | 'modified';
export interface SortOrder { key: SortKey; ascending: boolean }

export function isDirectory(entry: FileEntry): boolean {
  return entry.type === 'directory' || (entry.type === 'link' && entry.linkTarget === 'directory');
}

/** Folders first, then files; both by the chosen column. */
export function sortEntries(entries: FileEntry[], order: SortOrder): FileEntry[] {
  const direction = order.ascending ? 1 : -1;
  return [...entries].sort((a, b) => {
    const folders = Number(isDirectory(b)) - Number(isDirectory(a));
    if (folders) return folders;
    const value = order.key === 'name' ? 0 : order.key === 'size' ? a.size - b.size : a.modified - b.modified;
    return (value || compareText(a.name, b.name)) * direction;
  });
}

const units = ['B', 'KB', 'MB', 'GB', 'TB'];
export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${unit === 0 ? value : formatNumber(value, { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

export function formatRate(bytesPerSecond: number): string { return `${formatSize(Math.round(bytesPerSecond))}/s`; }

export function formatDate(modified: number): string { return modified > 0 ? formatDateTime(modified, 'short') : ''; }

export function joinPath(side: FileSide, dir: string, name: string): string {
  if (side === 'remote') return dir.endsWith('/') ? `${dir}${name}` : `${dir}/${name}`;
  return dir.endsWith('\\') ? `${dir}${name}` : `${dir}\\${name}`;
}

/** Parent folder; null at a root (`/` or `C:\`). */
export function parentPath(side: FileSide, path: string): string | null {
  if (side === 'remote') {
    if (path === '/' || !path.startsWith('/')) return null;
    const trimmed = path.replace(/\/+$/, '');
    const index = trimmed.lastIndexOf('/');
    return index <= 0 ? '/' : trimmed.slice(0, index);
  }
  const trimmed = path.replace(/\\+$/, '');
  if (/^[a-z]:$/i.test(trimmed)) return null;
  const index = trimmed.lastIndexOf('\\');
  if (index < 0) return null;
  const parent = trimmed.slice(0, index);
  return /^[a-z]:$/i.test(parent) ? `${parent}\\` : parent;
}

/** Clickable path segments, each with the full path up to it. */
export function pathSegments(side: FileSide, path: string): { label: string; path: string }[] {
  const segments: { label: string; path: string }[] = [];
  for (let current: string | null = path; current; current = parentPath(side, current)) {
    const label = side === 'remote' ? (current === '/' ? '/' : current.slice(current.lastIndexOf('/') + 1))
      : (parentPath(side, current) === null ? current.replace(/\\$/, '') : current.slice(current.lastIndexOf('\\') + 1));
    segments.unshift({ label, path: current });
  }
  return segments;
}

/** Error text for a new or changed name; null when it is valid. */
export function nameError(side: FileSide, name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return t('files:names.empty');
  if (trimmed === '.' || trimmed === '..') return t('files:names.reserved');
  if (side === 'remote' ? trimmed.includes('/') : /[\\/:*?"<>|]/.test(trimmed)) {
    return side === 'remote' ? t('files:names.slash') : t('files:names.chars');
  }
  return null;
}

/** Entries the pane shows: dot names only if `showHidden`; then names containing the trimmed `filter`, ignoring case. Keeps the order. */
export function visibleEntries(entries: FileEntry[], showHidden: boolean, filter: string): FileEntry[] {
  const needle = foldCase(filter.trim());
  return entries.filter(entry => (showHidden || !entry.name.startsWith('.')) && (!needle || foldCase(entry.name).includes(needle)));
}

/** Target of the "Gehe zu" field. */
export type GoTo = { path: string } | { unsupported: true };

/** Remote: `~` and `~/…` start at `home`, other relative input at `current`. Local: `/` becomes `\`, `D:` becomes `D:\`,
 *  `\x` uses the drive of `current`, `~` the home folder, other relative input starts at `current`; device paths are refused.
 *  Null for empty input. `..` is left to the server's realpath and Main's win32.resolve. */
export function resolveGoTo(side: FileSide, input: string, current: string, home: string | null): GoTo | null {
  const text = input.trim();
  if (!text) return null;
  const base = home ?? current;
  if (side === 'remote') {
    if (text === '~') return { path: base };
    if (text.startsWith('~/')) return { path: joinPath('remote', base, text.slice(2)) };
    return { path: text.startsWith('/') ? text : joinPath('remote', current, text) };
  }
  const value = text.replace(/\//g, '\\');
  if (/^\\\\[?.](\\|$)/.test(value)) return { unsupported: true };
  if (value === '~') return { path: base };
  if (value.startsWith('~\\')) return { path: joinPath('local', base, value.slice(2)) };
  if (/^[A-Za-z]:/.test(value)) return { path: value[2] === '\\' ? value : `${value.slice(0, 2)}\\${value.slice(2)}` };
  if (value.startsWith('\\\\')) return { path: value };
  if (value.startsWith('\\')) return { path: /^[A-Za-z]:/.test(current) ? `${current.slice(0, 2)}${value}` : joinPath('local', current, value.slice(1)) };
  return { path: joinPath('local', current, value) };
}

/** Explorer-style selection: click selects one, Ctrl toggles, Shift selects a range from the anchor. */
export function nextSelection(names: string[], selected: string[], anchor: string | null, clicked: string,
  modifiers: { ctrl: boolean; shift: boolean }): { selected: string[]; anchor: string } {
  if (modifiers.shift && anchor && names.includes(anchor)) {
    const [from, to] = [names.indexOf(anchor), names.indexOf(clicked)].sort((a, b) => a - b);
    const range = names.slice(from, to + 1);
    return { selected: modifiers.ctrl ? [...new Set([...selected, ...range])] : range, anchor };
  }
  if (modifiers.ctrl) {
    return { selected: selected.includes(clicked) ? selected.filter(name => name !== clicked) : [...selected, clicked], anchor: clicked };
  }
  return { selected: [clicked], anchor: clicked };
}

export function jobPercent(job: TransferJob): number {
  if (job.state === 'done') return 100;
  return job.totalBytes > 0 ? Math.min(100, Math.floor(job.doneBytes / job.totalBytes * 100)) : 0;
}

export function isFinished(job: TransferJob): boolean { return job.state !== 'queued' && job.state !== 'running'; }

/** Octal text (`644`, `0755`) to permission bits; null when invalid. */
export function parseMode(text: string): number | null {
  const trimmed = text.trim();
  return /^0?[0-7]{3,4}$/.test(trimmed) ? parseInt(trimmed, 8) : null;
}

export function modeText(mode: number): string { return (mode & 0o7777).toString(8).padStart(3, '0'); }
