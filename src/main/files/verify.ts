import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { posix, win32 } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Client } from 'ssh2';
import type { TransferDirection } from '../../shared/sftp';
import { shellJoin } from '../containers/commands';
import { FileError } from './file-system';

const SCRIPT = 'sha256sum -- "$1" 2>/dev/null || shasum -a 256 -- "$1"';
// Only names every common login shell (sh, bash, zsh, fish, csh, cmd, PowerShell) passes literally inside '…'.
const VERIFIABLE = /^[\p{L}\p{N}\p{M} _.\/+,=@~#:()[\]'-]+$/u;
/** Runs in sh whatever the login shell is; the path is the only argument. */
export const verifyCommand = (path: string): string => shellJoin(['sh', '-c', SCRIPT, 'sh', path]);

/** Hex digest from `sha256sum` (coreutils, BusyBox) or `shasum -a 256` (macOS); anything else means the server cannot answer. */
export function sha256Remote(client: Client, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!VERIFIABLE.test(path)) { reject(new FileError('files.verifyUnsafeName', { name: posix.basename(path) })); return; }
    const unavailable = () => reject(new FileError('files.verifyUnavailable'));
    client.exec(verifyCommand(path), (error, stream) => {
      if (error) { unavailable(); return; }
      // The tail only: a long login banner must not push the digest out.
      let out = '';
      stream.on('data', (chunk: Buffer) => { out = (out + chunk.toString('utf8')).slice(-4096); });
      stream.stderr.resume();
      stream.on('error', unavailable);
      stream.on('close', () => {
        const match = /^([0-9a-f]{64})[ \t]/im.exec(out);
        if (match) resolve(match[1].toLowerCase()); else unavailable();
      });
    });
  });
}

export async function sha256Local(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

/** Names of copied files whose digests differ; local and server digests run side by side, files one after another. */
export async function verifyCopies(client: Client, pairs: { source: string; target: string }[], direction: TransferDirection): Promise<string[]> {
  const mismatched: string[] = [];
  for (const { source, target } of pairs) {
    const [local, remote] = direction === 'upload' ? [source, target] : [target, source];
    const [a, b] = await Promise.all([sha256Local(local), sha256Remote(client, remote)]);
    if (a !== b) mismatched.push(win32.basename(target));
  }
  return mismatched;
}
