import { posix } from 'node:path';
import type { Attributes, SFTPWrapper } from 'ssh2';
import type { FileEntry } from '../../shared/sftp';
import type { FileSystem } from './file-system';
import { FileError, mapLimit } from './file-system';

const MAX_ENTRIES = 50_000;
const TYPE_MASK = 0o170000;
const DIRECTORY = 0o040000;
const LINK = 0o120000;
/** SFTP status code for a missing file. */
const NO_SUCH_FILE = 2;

export function permissionText(mode: number): string {
  const kind = (mode & TYPE_MASK) === DIRECTORY ? 'd' : (mode & TYPE_MASK) === LINK ? 'l' : '-';
  const bits = 'rwxrwxrwx';
  return kind + [...bits].map((letter, index) => mode & (1 << (8 - index)) ? letter : '-').join('');
}

export function remoteEntry(name: string, attrs: Attributes, target?: Attributes | null): FileEntry {
  const kind = attrs.mode & TYPE_MASK;
  const type = kind === LINK ? 'link' : kind === DIRECTORY ? 'directory' : 'file';
  const effective = type === 'link' ? target : attrs;
  const isDirectory = effective ? (effective.mode & TYPE_MASK) === DIRECTORY : false;
  return { name, type, size: effective && !isDirectory ? effective.size : 0, modified: (effective ?? attrs).mtime * 1000,
    permissions: permissionText(attrs.mode), mode: attrs.mode & 0o7777,
    ...(type === 'link' && target ? { linkTarget: isDirectory ? 'directory' : 'file' } : {}) };
}

const call = <T>(run: (callback: (error: Error | undefined | null, value: T) => void) => void): Promise<T> =>
  new Promise((resolve, reject) => run((error, value) => error ? reject(error) : resolve(value)));

export interface RemoteFileSystem extends FileSystem {
  /** Does not follow links. */
  lstat: (path: string) => Promise<FileEntry | null>;
  chmod: (path: string, mode: number) => Promise<void>;
}

const missing = (error: unknown): null => { if ((error as { code?: number }).code === NO_SUCH_FILE) return null; throw error; };

export function sftpFileSystem(sftp: SFTPWrapper): RemoteFileSystem {
  const stat = (path: string) => call<Attributes>(callback => sftp.stat(path, callback));
  return {
    join: (dir, name) => posix.join(dir, name),
    basename: path => posix.basename(path),
    realpath: path => call<string>(callback => sftp.realpath(path, callback)),
    list: async dir => {
      const list = await call<{ filename: string; attrs: Attributes }[]>(callback => sftp.readdir(dir, callback));
      if (list.length > MAX_ENTRIES) throw new FileError('files.tooManyEntries', { max: MAX_ENTRIES });
      const visible = list.filter(item => item.filename !== '.' && item.filename !== '..');
      return mapLimit(visible, 16, async item => (item.attrs.mode & TYPE_MASK) === LINK
        ? remoteEntry(item.filename, item.attrs, await stat(posix.join(dir, item.filename)).catch(() => null))
        : remoteEntry(item.filename, item.attrs));
    },
    stat: path => stat(path).then(attrs => remoteEntry(posix.basename(path), attrs), missing),
    lstat: path => call<Attributes>(callback => sftp.lstat(path, callback)).then(attrs => remoteEntry(posix.basename(path), attrs), missing),
    chmod: (path, mode) => call<void>(callback => sftp.chmod(path, mode, error => callback(error, undefined))),
    mkdir: path => call<void>(callback => sftp.mkdir(path, error => callback(error, undefined))),
    read: path => sftp.createReadStream(path, { highWaterMark: 256 * 1024 }),
    write: (path, mode) => sftp.createWriteStream(path, { mode: mode ?? 0o644 }),
    openRead: async path => {
      const handle = await call<Buffer>(callback => sftp.open(path, 'r', callback));
      // Servers hand a closed handle's number to the next open; nothing may be sent on it afterwards.
      let closed = false;
      return { read: async (length, position) => {
        const buffer = Buffer.allocUnsafe(length);
        let got = 0;
        // ssh2 splits requests above the server's limit itself; a short answer short of EOF is asked again.
        while (got < length) {
          if (closed) throw new Error('handle closed');
          const bytes = await call<number>(callback => sftp.read(handle, buffer, got, length - got, position + got, (error, count) => callback(error, count)));
          if (!bytes) break;
          got += bytes;
        }
        return buffer.subarray(0, got);
      }, close: () => { closed = true; return call<void>(callback => sftp.close(handle, error => callback(error, undefined))); } };
    },
    openWrite: async (path, mode = 0o644, resume) => {
      const handle = await call<Buffer>(callback => sftp.open(path, resume ? 'r+' : 'w', mode, callback));
      // Like ssh2's write stream: servers set the mode on new and existing files alike; a refusal is not an error.
      await call<void>(callback => sftp.fchmod(handle, mode, error => callback(error, undefined))).catch(() => {});
      let closed = false;
      return { write: async (data, position) => {
        if (closed) throw new Error('handle closed');
        await call<void>(callback => sftp.write(handle, data, 0, data.length, position, error => callback(error, undefined)));
      }, close: () => { closed = true; return call<void>(callback => sftp.close(handle, error => callback(error, undefined))); } };
    },
    setModified: (path, modified) => call<void>(callback => sftp.utimes(path, new Date(), new Date(modified), error => callback(error, undefined))),
    removeFile: path => call<void>(callback => sftp.unlink(path, error => callback(error, undefined))),
    removeDirectory: path => call<void>(callback => sftp.rmdir(path, error => callback(error, undefined))),
    rename: (from, to) => call<void>(callback => sftp.rename(from, to, error => callback(error, undefined))),
  };
}

/** Deletes files and whole folders; links are removed, never followed. */
export async function removeRemote(fs: RemoteFileSystem, path: string, signal?: AbortSignal): Promise<void> {
  const entry = await fs.lstat(path);
  if (!entry) return;
  const walk = async (dir: string): Promise<void> => {
    for (const child of await fs.list(dir)) {
      if (signal?.aborted) throw new FileError('files.deleteCanceled');
      const childPath = fs.join(dir, child.name);
      if (child.type === 'directory') await walk(childPath);
      else await fs.removeFile(childPath);
    }
    await fs.removeDirectory(dir);
  };
  if (entry.type === 'directory') await walk(path);
  else await fs.removeFile(path);
}
