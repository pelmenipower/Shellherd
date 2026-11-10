/** Private encrypted checkpoint, separate from server-uploadable objects. */
import { constants } from 'node:fs';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { bound, ensure, hashWire, openDocument, sealDocument, stable } from './vault-sync-crypto';
import type { SyncContext } from './vault-sync-crypto';
import type { EncryptedVaultFile } from '../../shared/vault/file-format';
export interface StateFile {
  read(): Promise<unknown | undefined>;
  /** `ignoreAbort` skips the abort checks (not the hash check): for the last write before a result with a one-time code is returned. */
  write(value: unknown, options?: { ignoreAbort?: boolean }): Promise<void>;
  /** Deletes the checkpoint after the same hash check as `write`; only for aborting a key bootstrap. */
  remove(): Promise<void>;
  close(): Promise<void>;
}
const LOCK_STALE_MS = 600_000;
const bootId = async (): Promise<string> => { try { return (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim(); } catch { return ''; } };
interface LockInfo { content: string; mtimeMs: number }
/** Reads the lock without following links; anything but a plain single-link file counts as held. */
async function readLock(lockPath: string): Promise<LockInfo | undefined> {
  let file;
  try {
    file = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW); const stat = await file.stat();
    ensure(stat.isFile() && stat.nlink === 1 && stat.size <= 4096, 'recovery');
    return { content: await file.readFile('utf8'), mtimeMs: stat.mtimeMs };
  } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; ensure(false, 'recovery'); }
  finally { await file?.close(); }
}
/** Orphaned = its owner is gone (dead pid, other boot) or the lock is too old to be believed. Our own pid never is. */
function orphaned(lock: LockInfo, boot: string): boolean {
  const old = Date.now() - lock.mtimeMs > LOCK_STALE_MS; let parsed: { pid?: unknown; boot?: unknown } | undefined;
  try { parsed = JSON.parse(lock.content); } catch { /* legacy or empty lock */ }
  if (!parsed || typeof parsed !== 'object' || !Number.isSafeInteger(parsed.pid) || (parsed.pid as number) < 1) return old;
  const pid = parsed.pid as number; if (pid === process.pid) return false;
  if (boot !== '' && typeof parsed.boot === 'string' && parsed.boot !== '' && parsed.boot !== boot) return true;
  try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true; }
  return old;
}
async function createLock(lockPath: string, boot: string) {
  const handle = await open(lockPath, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify({ pid: process.pid, boot, at: Date.now() })); }
  catch (error) { await handle.close(); await unlink(lockPath).catch(() => {}); throw error; }
  return handle;
}
async function acquireLock(lockPath: string) {
  const boot = await bootId();
  try { return await createLock(lockPath, boot); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  // Takeover only of a provably orphaned lock that did not change between two reads; the leftover race is covered by the single-instance lock and the checkpoint hash.
  const first = await readLock(lockPath); ensure(first && orphaned(first, boot), 'recovery');
  const second = await readLock(lockPath); ensure(second && second.content === first.content && second.mtimeMs === first.mtimeMs, 'recovery');
  await unlink(lockPath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  try { return await createLock(lockPath, boot); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') ensure(false, 'recovery'); throw error; }
}
export async function lockSyncState(filePath: string, key: Buffer, kdf: EncryptedVaultFile['kdf'], context: SyncContext, check: () => void): Promise<StateFile> {
  const path = `${filePath}.sync-state`; const lockPath = `${path}.lock`;
  check();
  const lock = await acquireLock(lockPath); let expected: string | undefined; let uncertain = false;
  async function wire(): Promise<string | undefined> {
    let file;
    try {
      file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); const stat = await file.stat();
      ensure(stat.isFile() && stat.nlink === 1 && stat.size <= 56 * 1048576 && (stat.mode & 0o077) === 0, 'limit');
      const data = await file.readFile('utf8'); ensure(Buffer.byteLength(data) <= 56 * 1048576, 'limit'); return data;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
    finally { await file?.close(); }
  }
  try { const old = await wire(); expected = old === undefined ? undefined : hashWire(old); }
  catch (error) { await lock.close(); await unlink(lockPath); throw error; }
  return {
    async read() {
      check(); const raw = await wire(); ensure((raw === undefined ? undefined : hashWire(raw)) === expected, 'changed'); if (raw === undefined) return undefined;
      let outer: unknown;
      try { outer = JSON.parse(raw); } catch { ensure(false, 'history'); }
      ensure(Array.isArray(outer));
      ensure(outer[0] !== 'shellherd-private-sync-state-v1', 'migrate'); // Before any decryption.
      if (outer[0] === 'shellherd-private-sync-state-v2') { ensure(outer.length === 2); return openDocument(outer[1], key, kdf, context, 'state'); }
      ensure(outer[0] === 'shellherd-private-sync-state-v3' && outer.length === 3);
      ensure(stable(outer[1]) === stable(bound(context)), 'otherServer'); // Plain context, compared before any decryption.
      return openDocument(outer[2], key, kdf, context, 'state');
    },
    async write(value, options) {
      const abortable = options?.ignoreAbort !== true; ensure(!uncertain, 'recovery'); if (abortable) check();
      const raw = JSON.stringify(['shellherd-private-sync-state-v3', bound(context), sealDocument(value, key, kdf, context, 'state')]);
      ensure(Buffer.byteLength(raw) <= 56 * 1048576, 'limit'); const temp = `${path}.${randomBytes(16).toString('hex')}.tmp`; let renamed = false;
      try {
        const file = await open(temp, 'wx', 0o600); try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
        const old = await wire(); ensure((old === undefined ? undefined : hashWire(old)) === expected, 'changed'); if (abortable) check();
        await rename(temp, path); renamed = true;
        const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); }
        expected = hashWire(raw);
      } catch (error) { if (renamed) uncertain = true; throw error; }
      finally { await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    },
    async remove() {
      ensure(!uncertain, 'recovery'); check();
      const old = await wire(); ensure((old === undefined ? undefined : hashWire(old)) === expected, 'changed');
      if (old === undefined) return;
      await unlink(path); expected = undefined;
      try { const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); } }
      catch (error) { uncertain = true; throw error; } // The unlink may not be durable.
    },
    async close() { await lock.close(); await unlink(lockPath); },
  };
}
