import { createReadStream, createWriteStream } from 'node:fs';
import { access, lstat, mkdir, open, readdir, realpath, rename, rmdir, stat, unlink, utimes } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { homedir } from 'node:os';
import { localPath } from '../platform';
import type { Readable, Writable } from 'node:stream';
import { AppError, type CodedError } from '../../shared/errors';
import type { FileEntry, LocalPlaces } from '../../shared/sftp';

/** Positional access for the copy loop. `read` returns fewer bytes only at the end of the file. */
export interface ReadHandle { read: (length: number, position: number) => Promise<Buffer>; close: () => Promise<void> }
/** `write` resolves once every byte is confirmed (local: written, server: STATUS OK). `write` after `close` rejects without sending anything. */
export interface WriteHandle { write: (data: Buffer, position: number) => Promise<void>; close: () => Promise<void> }

/** One side of a transfer: this computer or a server. FTP becomes another implementation. */
export interface FileSystem {
  join: (dir: string, name: string) => string;
  basename: (path: string) => string;
  list: (dir: string) => Promise<FileEntry[]>;
  /** Follows links; null when nothing exists at the path. */
  stat: (path: string) => Promise<FileEntry | null>;
  mkdir: (path: string) => Promise<void>;
  read: (path: string) => Readable;
  /** Servers set `mode` on new and existing files alike (default 0644), so pass the old mode when overwriting; this computer ignores it. */
  write: (path: string, mode?: number) => Writable;
  openRead: (path: string) => Promise<ReadHandle>;
  /** `resume` opens an existing file without truncating (`r+`), otherwise the file is created or truncated. Servers apply `mode` (see `write`). */
  openWrite: (path: string, mode?: number, resume?: boolean) => Promise<WriteHandle>;
  setModified: (path: string, modified: number) => Promise<void>;
  removeFile: (path: string) => Promise<void>;
  /** Only empty directories. */
  removeDirectory: (path: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  /** Resolves links to the real path. */
  realpath: (path: string) => Promise<string>;
}

const MAX_ENTRIES = 50_000;

/** Errors with a catalog code the window can show. */
export class FileError extends AppError {}

/** Coded error for file errors of this computer and of SFTP servers (numeric status codes). */
export function fileError(error: unknown): CodedError {
  if (error instanceof AppError) return error.toCoded();
  const code = (error as { code?: string | number })?.code;
  if (code === 'ENOENT' || code === 2) return { code: 'files.notFound' };
  if (code === 'EACCES' || code === 'EPERM' || code === 3) return { code: 'files.accessDenied' };
  if (code === 'EEXIST') return { code: 'files.exists' };
  if (code === 'ENOTDIR') return { code: 'files.notADirectory' };
  if (code === 'ENOTEMPTY') return { code: 'files.notEmpty' };
  if (code === 'ENOSPC') return { code: 'files.noSpace' };
  if (code === 'EBUSY') return { code: 'files.busy' };
  if (code === 4) return { code: 'files.serverRejected' };
  return { code: 'files.failed' };
}

/** Names Windows cannot store safely: separators, drive/stream colons, control chars, trailing dot/space, device names. */
export const unsafeLocalName = (name: string, platform: NodeJS.Platform = process.platform): boolean =>
  platform !== 'win32' ? name === '' || name === '.' || name === '..' || /[\/\0]/.test(name) :
  name === '' || name === '.' || name === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(name) || /[. ]$/.test(name)
  || /^(con|prn|aux|nul|com[1-9]|lpt[1-9]|conin\$|conout\$)(\..*)?$/i.test(name);

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
  join: (dir, name) => localPath.join(dir, name),
  basename: path => localPath.basename(path),
  list: async dir => {
    const names = await readdir(dir);
    if (names.length > MAX_ENTRIES) throw new FileError('files.tooManyEntries', { max: MAX_ENTRIES });
    const entries = await mapLimit(names, 32, async name => {
      const path = localPath.join(dir, name);
      // Locked system files (pagefile.sys) cannot be inspected; they are listed without details.
      const info = await lstat(path).catch(() => null);
      if (!info) return { name, type: 'file', size: 0, modified: 0 } satisfies FileEntry;
      return localEntry(name, info, info.isSymbolicLink() ? await stat(path).catch(() => null) : undefined);
    });
    return entries;
  },
  stat: async path => {
    const info = await stat(path).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return null; throw error; });
    return info ? localEntry(localPath.basename(path), info) : null;
  },
  mkdir: async path => { await mkdir(path); },
  read: path => createReadStream(path, { highWaterMark: 256 * 1024 }),
  write: path => createWriteStream(path),
  openRead: async path => {
    const handle = await open(path, 'r');
    return { read: async (length, position) => {
      const buffer = Buffer.allocUnsafe(length);
      let got = 0;
      // pread may return less than asked; only 0 means end of file.
      while (got < length) {
        const { bytesRead } = await handle.read(buffer, got, length - got, position + got);
        if (!bytesRead) break;
        got += bytesRead;
      }
      return buffer.subarray(0, got);
    }, close: () => handle.close() };
  },
  openWrite: async (path, _mode, resume) => {
    const handle = await open(path, resume ? 'r+' : 'w');
    return { write: async (data, position) => {
      for (let done = 0; done < data.length;) {
        const { bytesWritten } = await handle.write(data, done, data.length - done, position + done);
        // A write that makes no progress would spin forever.
        if (!bytesWritten) throw Object.assign(new Error('short write'), { code: 'EIO' });
        done += bytesWritten;
      }
    }, close: () => handle.close() };
  },
  setModified: async (path, modified) => { await utimes(path, new Date(), new Date(modified)); },
  removeFile: path => unlink(path),
  removeDirectory: path => rmdir(path),
  rename: (from, to) => rename(from, to),
  realpath: path => realpath(path),
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
