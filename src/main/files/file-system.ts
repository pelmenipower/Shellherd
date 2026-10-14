import { createReadStream, createWriteStream } from 'node:fs';
import { access, lstat, mkdir, readdir, rename, rmdir, stat, unlink, utimes } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { homedir } from 'node:os';
import { win32 } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { FileEntry, LocalPlaces } from '../../shared/sftp';

/** One side of a transfer: this computer or a server. FTP becomes another implementation. */
export interface FileSystem {
  join: (dir: string, name: string) => string;
  basename: (path: string) => string;
  list: (dir: string) => Promise<FileEntry[]>;
  /** Follows links; null when nothing exists at the path. */
  stat: (path: string) => Promise<FileEntry | null>;
  mkdir: (path: string) => Promise<void>;
  read: (path: string) => Readable;
  write: (path: string) => Writable;
  setModified: (path: string, modified: number) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  /** Only empty directories. */
  removeDirectory: (path: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
}

const MAX_ENTRIES = 50_000;

/** Errors whose message is written for the user. */
export class FileError extends Error {}

/** User-facing text for file errors of this computer and of SFTP servers (numeric status codes). */
export function fileErrorText(error: unknown): string {
  if (error instanceof FileError) return error.message;
  const code = (error as { code?: string | number })?.code;
  if (code === 'ENOENT' || code === 2) return 'Die Datei oder der Ordner wurde nicht gefunden.';
  if (code === 'EACCES' || code === 'EPERM' || code === 3) return 'Zugriff verweigert.';
  if (code === 'EEXIST') return 'Ein Eintrag mit diesem Namen existiert bereits.';
  if (code === 'ENOTEMPTY') return 'Der Ordner ist nicht leer.';
  if (code === 'ENOSPC') return 'Auf dem Ziel ist nicht genug Speicherplatz frei.';
  if (code === 'EBUSY') return 'Die Datei wird gerade von einem anderen Programm verwendet.';
  if (code === 4) return 'Der Server hat die Aktion abgelehnt. Vielleicht existiert der Name schon oder der Ordner ist nicht leer.';
  return 'Die Dateiaktion ist fehlgeschlagen.';
}

/** Runs `task` for every item with at most `limit` running at once. */
export async function mapLimit<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await task(items[index]); }
  }));
  return results;
}

function localEntry(name: string, info: Stats, target?: Stats | null): FileEntry {
  const type = info.isSymbolicLink() ? 'link' : info.isDirectory() ? 'directory' : 'file';
  const effective = type === 'link' ? target : info;
  return { name, type, size: effective && !effective.isDirectory() ? effective.size : 0, modified: (effective ?? info).mtimeMs,
    ...(type === 'link' && target ? { linkTarget: target.isDirectory() ? 'directory' : 'file' } : {}) };
}

export const localFileSystem: FileSystem = {
  join: (dir, name) => win32.join(dir, name),
  basename: path => win32.basename(path),
  list: async dir => {
    const names = await readdir(dir);
    if (names.length > MAX_ENTRIES) throw new FileError(`Der Ordner enthält mehr als ${MAX_ENTRIES} Einträge.`);
    const entries = await mapLimit(names, 32, async name => {
      const path = win32.join(dir, name);
      // Locked system files (pagefile.sys) cannot be inspected; they are listed without details.
      const info = await lstat(path).catch(() => null);
      if (!info) return { name, type: 'file', size: 0, modified: 0 } satisfies FileEntry;
      return localEntry(name, info, info.isSymbolicLink() ? await stat(path).catch(() => null) : undefined);
    });
    return entries;
  },
  stat: async path => {
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    return info ? localEntry(win32.basename(path), info) : null;
  },
  mkdir: async path => { await mkdir(path); },
  read: path => createReadStream(path, { highWaterMark: 256 * 1024 }),
  write: path => createWriteStream(path),
  setModified: async (path, modified) => { await utimes(path, new Date(), new Date(modified)); },
  removeFile: path => unlink(path),
  removeDirectory: path => rmdir(path),
  rename: (from, to) => rename(from, to),
};

/** Home folder and the drives that exist. */
export async function localPlaces(): Promise<LocalPlaces> {
  const letters = process.platform === 'win32' ? 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('') : [];
  const drives = await mapLimit(letters, 8, async letter => {
    const root = `${letter}:\\`;
    return access(root).then(() => root, () => null);
  });
  return { home: homedir(), drives: drives.filter((drive): drive is string => drive !== null) };
}
