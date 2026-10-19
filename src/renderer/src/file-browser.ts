import type { FileEntry, TransferJob } from '../../shared/sftp';

export type FileSide = 'local' | 'remote';
export type SortKey = 'name' | 'size' | 'modified';
export interface SortOrder { key: SortKey; ascending: boolean }

export function isDirectory(entry: FileEntry): boolean {
  return entry.type === 'directory' || (entry.type === 'link' && entry.linkTarget === 'directory');
}

const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

/** Folders first, then files; both by the chosen column. */
export function sortEntries(entries: FileEntry[], order: SortOrder): FileEntry[] {
  const direction = order.ascending ? 1 : -1;
  return [...entries].sort((a, b) => {
    const folders = Number(isDirectory(b)) - Number(isDirectory(a));
    if (folders) return folders;
    const value = order.key === 'name' ? 0 : order.key === 'size' ? a.size - b.size : a.modified - b.modified;
    return (value || collator.compare(a.name, b.name)) * direction;
  });
}

const units = ['B', 'KB', 'MB', 'GB', 'TB'];
export function formatSize(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${unit === 0 ? value : value.toLocaleString('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[unit]}`;
}

const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' });
export function formatDate(modified: number): string { return modified > 0 ? dateFormat.format(modified) : ''; }

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
  if (!trimmed) return 'Bitte gib einen Namen ein.';
  if (trimmed === '.' || trimmed === '..') return 'Dieser Name ist nicht erlaubt.';
  if (side === 'remote' ? trimmed.includes('/') : /[\\/:*?"<>|]/.test(trimmed)) {
    return side === 'remote' ? 'Der Name darf keinen Schrägstrich enthalten.' : 'Der Name darf keines dieser Zeichen enthalten: \\ / : * ? " < > |';
  }
  return null;
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

/** Electron prefixes errors from the main process; the window shows only the message. */
export function ipcErrorText(error: unknown, fallback = 'Die Dateiaktion ist fehlgeschlagen.'): string {
  return error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : fallback;
}

/** Octal text (`644`, `0755`) to permission bits; null when invalid. */
export function parseMode(text: string): number | null {
  const trimmed = text.trim();
  return /^0?[0-7]{3,4}$/.test(trimmed) ? parseInt(trimmed, 8) : null;
}

export function modeText(mode: number): string { return (mode & 0o7777).toString(8).padStart(3, '0'); }
