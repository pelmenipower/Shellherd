import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it as linuxIt } from 'vitest';
import { randomBytes } from 'node:crypto';
import { lockSyncState } from './vault-sync-state';
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
    expect(await readFile(`${path}.sync-state.lock`, 'utf8')).toBe('');
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
it('writes the v2 outer tag, removes the checkpoint and refuses to remove a concurrently changed one', async () => {
  const { path, key } = await fixture(); const state = await lockSyncState(path, key, kdf, context, () => {});
  try {
    await state.write({ a: 1 }); expect(JSON.parse(await readFile(`${path}.sync-state`, 'utf8'))[0]).toBe('shellherd-private-sync-state-v2');
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
