import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it as linuxIt } from 'vitest';
import { randomBytes } from 'node:crypto';
import { lockSyncState } from './vault-sync-state';
import { sealDocument } from './vault-sync-crypto';
const it = linuxIt.runIf(process.platform === 'linux');

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const context = { serverId: 'b'.repeat(64), namespace: 'test' };
const kdf = { algorithm: 'argon2id' as const, memoryKiB: 65536, iterations: 3, parallelism: 1, salt: Buffer.alloc(16, 1).toString('base64') };
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-sync-state-')); directories.push(directory);
  return { path: join(directory, 'vault.term'), key: randomBytes(32) };
}
it('rejects an existing empty checkpoint instead of silently resetting known history', async () => {
  const { path, key } = await fixture(); await writeFile(`${path}.sync-state`, '', { mode: 0o600 });
  const state = await lockSyncState(path, key, kdf, context, () => {});
  try { await expect(state.read()).rejects.toThrow(); }
  finally { await state.close(); key.fill(0); }
});
it('reports a held or stale lock as recovery required and never removes someone else\'s lock', async () => {
  const { path, key } = await fixture();
  const state = await lockSyncState(path, key, kdf, context, () => {});
  try {
    await expect(lockSyncState(path, key, kdf, context, () => {})).rejects.toMatchObject({ code: 'recovery' });
    expect(JSON.parse(await readFile(`${path}.sync-state.lock`, 'utf8'))).toMatchObject({ pid: process.pid });
  } finally { await state.close(); key.fill(0); }
});
it('writes and reads a checkpoint with about 20 MiB of versions', async () => {
  const { path, key } = await fixture(); const state = await lockSyncState(path, key, kdf, context, () => {});
  try {
    const value = { kind: 'shellherd-sync-state-v1', versions: Array.from({ length: 20 }, () => randomBytes(700 * 1024).toString('base64')) };
    await state.write(value); expect(await state.read()).toEqual(value);
  } finally { await state.close(); key.fill(0); }
}, 30000);
it('reports a v1 checkpoint as migrate without decrypting it', async () => {
  const { path, key } = await fixture(); await writeFile(`${path}.sync-state`, JSON.stringify(['shellherd-private-sync-state-v1', { not: 'decryptable' }]), { mode: 0o600 });
  const state = await lockSyncState(path, key, kdf, context, () => {});
  try { await expect(state.read()).rejects.toMatchObject({ code: 'migrate' }); }
  finally { await state.close(); key.fill(0); }
});
it('writes the v3 outer tag with the plain context, removes the checkpoint and refuses to remove a concurrently changed one', async () => {
  const { path, key } = await fixture(); const state = await lockSyncState(path, key, kdf, context, () => {});
  try {
    await state.write({ a: 1 }); const outer = JSON.parse(await readFile(`${path}.sync-state`, 'utf8')); expect(outer[0]).toBe('shellherd-private-sync-state-v3'); expect(outer[1]).toEqual(context); expect(outer).toHaveLength(3);
    expect(await state.read()).toEqual({ a: 1 });
    await writeFile(`${path}.sync-state`, 'tampered', { mode: 0o600 });
    await expect(state.remove()).rejects.toMatchObject({ code: 'changed' }); expect(await readFile(`${path}.sync-state`, 'utf8')).toBe('tampered');
  } finally { await state.close(); key.fill(0); }
});
it('removes its own checkpoint durably', async () => {
  const { path, key } = await fixture(); const state = await lockSyncState(path, key, kdf, context, () => {});
  try { await state.write({ a: 1 }); await state.remove(); await expect(readFile(`${path}.sync-state`)).rejects.toMatchObject({ code: 'ENOENT' }); expect(await state.read()).toBeUndefined(); await state.write({ b: 2 }); }
  finally { await state.close(); key.fill(0); }
});

const bootId = () => { try { return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch { return ''; } };
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;
async function plantLock(path: string, content: string, ageMs = 0) {
  const lock = `${path}.sync-state.lock`; await writeFile(lock, content, { mode: 0o600 });
  if (ageMs) { const t = new Date(Date.now() - ageMs); await utimes(lock, t, t); }
}
it('writes the lock as JSON with pid, boot id and time', async () => {
  const { path, key } = await fixture(); const state = await lockSyncState(path, key, kdf, context, () => {});
  try { const lock = JSON.parse(await readFile(`${path}.sync-state.lock`, 'utf8')); expect(lock).toMatchObject({ pid: process.pid, boot: bootId() }); expect(Number.isSafeInteger(lock.at)).toBe(true); }
  finally { await state.close(); key.fill(0); }
});
it('takes over a lock of a dead foreign process', async () => {
  const { path, key } = await fixture(); await plantLock(path, JSON.stringify({ pid: deadPid(), boot: bootId(), at: Date.now() }));
  const state = await lockSyncState(path, key, kdf, context, () => {});
  try { expect(JSON.parse(await readFile(`${path}.sync-state.lock`, 'utf8')).pid).toBe(process.pid); } finally { await state.close(); key.fill(0); }
});
it('takes over a lock from another boot', async () => {
  const { path, key } = await fixture(); await plantLock(path, JSON.stringify({ pid: process.pid + 1, boot: 'other-boot', at: Date.now() }));
  const state = await lockSyncState(path, key, kdf, context, () => {}); await state.close(); key.fill(0);
});
it('never treats its own pid as an orphan', async () => {
  const { path, key } = await fixture(); await plantLock(path, JSON.stringify({ pid: process.pid, boot: 'other-boot', at: 0 }), 3_600_000);
  await expect(lockSyncState(path, key, kdf, context, () => {})).rejects.toMatchObject({ code: 'recovery' }); key.fill(0);
});
it('keeps a live foreign lock and takes over one older than 10 minutes', async () => {
  const { path, key } = await fixture(); const live = JSON.stringify({ pid: process.ppid, boot: bootId(), at: Date.now() });
  await plantLock(path, live); await expect(lockSyncState(path, key, kdf, context, () => {})).rejects.toMatchObject({ code: 'recovery' });
  await plantLock(path, live, 11 * 60_000); const state = await lockSyncState(path, key, kdf, context, () => {}); await state.close(); key.fill(0);
});
it('keeps a fresh empty lock and takes over an 11 minute old one', async () => {
  const { path, key } = await fixture(); await plantLock(path, '');
  await expect(lockSyncState(path, key, kdf, context, () => {})).rejects.toMatchObject({ code: 'recovery' });
  await plantLock(path, '', 11 * 60_000); const state = await lockSyncState(path, key, kdf, context, () => {}); await state.close(); key.fill(0);
});
it('reads a v2 checkpoint and reports otherServer before decrypting a v3 checkpoint of another context', async () => {
  const { path, key } = await fixture(); const state = await lockSyncState(path, key, kdf, context, () => {});
  try {
    await writeFile(`${path}.sync-state`, JSON.stringify(['shellherd-private-sync-state-v2', sealDocument({ a: 1 }, key, kdf, context)]), { mode: 0o600 });
  } finally { await state.close(); }
  const again = await lockSyncState(path, key, kdf, context, () => {});
  try { expect(await again.read()).toEqual({ a: 1 }); await again.write({ b: 2 }); } finally { await again.close(); }
  const other = await lockSyncState(path, key, kdf, { serverId: 'c'.repeat(64), namespace: 'test' }, () => {});
  try { await expect(other.read()).rejects.toMatchObject({ code: 'otherServer' }); } finally { await other.close(); key.fill(0); }
});
it('write with ignoreAbort skips the abort check, a normal write does not', async () => {
  const { path, key } = await fixture(); let aborted = false; const state = await lockSyncState(path, key, kdf, context, () => { if (aborted) throw new Error('aborted'); });
  try { await state.write({ a: 1 }); aborted = true; await expect(state.write({ a: 2 })).rejects.toThrow('aborted'); await state.write({ a: 3 }, { ignoreAbort: true }); aborted = false; expect(await state.read()).toEqual({ a: 3 }); }
  finally { await state.close(); key.fill(0); }
});
