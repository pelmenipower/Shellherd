import { posix } from 'node:path';
import type { Client, SFTPWrapper, Stats } from 'ssh2';
import type { RemotePathAction, RemotePathEntry, RemotePathReply } from '../../shared/remote-path';
import { mapLimit } from '../files/file-system';
const LIMIT = 200;
const SCAN_LIMIT = 2000;
const safe = (path: string): boolean => path.length <= 4000 && !/[\x00-\x1f\x7f]/.test(path);
const executable = (stats: Stats): boolean | null => typeof stats.mode === 'number' ? !!(stats.mode & 0o111) : null;
function failure(error: unknown): RemotePathReply['error'] {
  const code = (error as { code?: number | string })?.code;
  return code === 2 || code === 'ENOENT' ? 'not-found' : code === 3 || code === 'EACCES' ? 'denied' : 'failed';
}

/** Read-only SFTP metadata on the existing SSH transport; no shell expansion or command execution. */
export function remotePath(client: Pick<Client, 'sftp'>, action: RemotePathAction, input: string, allowed: () => boolean,
  register: (cancel: () => void) => () => void, timeoutMs = 10_000): Promise<RemotePathReply> {
  return new Promise(resolve => {
    let sftp: SFTPWrapper | undefined;
    let settled = false;
    let unregister = (): void => {};
    const finish = (result: RemotePathReply): void => {
      if (settled) return;
      settled = true; clearTimeout(timer); unregister();
      try { sftp?.end(); } catch { /* session ended */ }
      resolve(allowed() ? result : { path: input, error: 'unavailable' });
    };
    const timer = setTimeout(() => finish({ path: input, error: 'timeout' }), timeoutMs);
    unregister = register(() => finish({ path: input, error: 'unavailable' }));
    if (!allowed() || !safe(input)) { finish({ path: input, error: 'unavailable' }); return; }
    try {
      client.sftp((error, channel) => {
        if (settled) { try { channel?.end(); } catch { /* disconnected */ } return; }
        if (error || !channel) { finish({ path: input, error: 'unavailable' }); return; }
        sftp = channel;
        channel.on('error', () => finish({ path: input, error: 'failed' }));
        channel.on('close', () => finish({ path: input, error: 'unavailable' }));
        const call = <T>(run: (callback: (error: Error | undefined, result: T) => void) => void): Promise<T> => new Promise((yes, no) => {
          if (settled || !allowed()) { no(new Error('closed')); return; }
          run((error, result) => error ? no(error) : yes(result));
        });
        void (async () => {
          const home = await call<string>(callback => channel.realpath('.', callback));
          const trailingSlash = input.endsWith('/');
          let path = input || '.';
          if (path === '~' || path === '$HOME' || path === '${HOME}') path = home;
          else if (path.startsWith('~/')) path = posix.join(home, path.slice(2));
          else if (/^\$(?:HOME|\{HOME\})\//.test(path)) path = posix.join(home, path.replace(/^\$(?:HOME|\{HOME\})\//, ''));
          else if (!posix.isAbsolute(path)) path = posix.join(home, path);
          if (trailingSlash && !path.endsWith('/')) path += '/';
          if (!safe(home) || !safe(path)) throw new Error('invalid path');
          if (action === 'validate') {
            const resolved = await call<string>(callback => channel.realpath(path, callback));
            if (!safe(resolved)) throw new Error('invalid path');
            const stats = await call<Stats>(callback => channel.stat(resolved, callback));
            finish({ path: resolved, directory: stats.isDirectory(), executable: executable(stats) }); return;
          }
          const parent = action === 'complete' ? (path.endsWith('/') ? path : posix.dirname(path)) : path;
          const prefix = action === 'complete' && !path.endsWith('/') ? posix.basename(path) : '';
          const directory = await call<string>(callback => channel.realpath(parent, callback));
          if (!safe(directory)) throw new Error('invalid path');
          const handle = await call<Buffer>(callback => channel.opendir(directory, callback));
          const entries: { filename: string; attrs: Stats }[] = [];
          let scanned = 0, truncated = false;
          try {
            while (!settled && allowed()) {
              const batch = await call<false | { filename: string; attrs: Stats }[]>(callback => channel.readdir(handle, (error, list) => {
                if ((error as { code?: number })?.code === 1) callback(undefined, false);
                else callback(error, list);
              }));
              if (!batch) break;
              for (const entry of batch) {
                scanned++;
                if (entry.filename !== '.' && entry.filename !== '..' && safe(posix.join(directory, entry.filename)) && !entry.filename.includes('/') && entry.filename.startsWith(prefix)) entries.push(entry);
                if (entries.length >= LIMIT || scanned >= SCAN_LIMIT) { truncated = true; break; }
              }
              if (truncated) break;
            }
          } finally { if (!settled) channel.close(handle, () => {}); }
          const result = await mapLimit(entries, 4, async entry => {
            const path = posix.join(directory, entry.filename);
            const stats = entry.attrs.isSymbolicLink() ? await call<Stats>(callback => channel.stat(path, callback)).catch(() => entry.attrs) : entry.attrs;
            return { name: entry.filename, path, directory: stats.isDirectory(), executable: executable(stats) } satisfies RemotePathEntry;
          });
          result.sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
          finish({ path: action === 'complete' ? (prefix ? posix.join(directory, prefix) : directory.replace(/\/$/, '') + '/') : directory, entries: result, truncated });
        })().catch(error => finish({ path: input, error: failure(error) }));
      });
    } catch { finish({ path: input, error: 'unavailable' }); }
  });
}
