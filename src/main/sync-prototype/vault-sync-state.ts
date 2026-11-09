/** Private encrypted checkpoint, separate from server-uploadable objects. */
import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';
import { ensure, hashWire, openDocument, sealDocument } from './vault-sync-crypto';
import type { SyncContext } from './vault-sync-crypto';
import type { EncryptedVaultFile } from '../../shared/vault/file-format';
export interface StateFile {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
  /** Deletes the checkpoint after the same hash check as `write`; only for aborting a key bootstrap. */
  remove(): Promise<void>;
  close(): Promise<void>;
}
export async function lockSyncState(filePath: string, key: Buffer, kdf: EncryptedVaultFile['kdf'], context: SyncContext, check: () => void): Promise<StateFile> {
  const path = `${filePath}.sync-state`; const lockPath = `${path}.lock`;
  check();
  const lock = await open(lockPath, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') ensure(false, 'recovery');
    throw error;
  }); let expected: string | undefined; let uncertain = false;
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
      ensure(Array.isArray(outer) && outer.length === 2);
      ensure(outer[0] !== 'shellherd-private-sync-state-v1', 'migrate'); // Before any decryption.
      ensure(outer[0] === 'shellherd-private-sync-state-v2');
      return openDocument(outer[1], key, kdf, context, 'state');
    },
    async write(value) {
      ensure(!uncertain, 'recovery'); check();
      const raw = JSON.stringify(['shellherd-private-sync-state-v2', sealDocument(value, key, kdf, context, 'state')]);
      ensure(Buffer.byteLength(raw) <= 56 * 1048576, 'limit'); const temp = `${path}.${randomBytes(16).toString('hex')}.tmp`; let renamed = false;
      try {
        const file = await open(temp, 'wx', 0o600); try { await file.writeFile(raw); await file.sync(); } finally { await file.close(); }
        const old = await wire(); ensure((old === undefined ? undefined : hashWire(old)) === expected, 'changed'); check();
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
