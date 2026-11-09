import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it as linuxIt, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { VaultSessionManager } from '../vault/session';
import { encryptVault } from '../vault/crypto';
import { writeEncryptedVaultFile, readEncryptedVaultFile } from '../vault/storage';
import type { Vault, VaultNode } from '../../shared/vault/types';
import { exampleVault } from '../../shared/vault/example';
import { synchronizeVault, importSyncedVault, removeForeignObjects, SYNC_COMPACTS_MAX } from './vault-sync';
import { hashWire, encryptedFile, keyFromPassword, openDocument, sealDocument } from './vault-sync-crypto';
import type { VaultRemote } from './vault-sync';
import { backupVaultFile } from '../vault/storage';
import { lockSyncState } from './vault-sync-state';
const it = linuxIt.runIf(process.platform === 'linux');
vi.mock('../vault/storage', async original => {
  const actual = await original<typeof import('../vault/storage')>();
  return { ...actual, backupVaultFile: vi.fn(actual.backupVaultFile), writeEncryptedVaultFile: vi.fn(actual.writeEncryptedVaultFile) };
});
vi.mock('./vault-sync-state', async original => {
  const actual = await original<typeof import('./vault-sync-state')>();
  return { ...actual, lockSyncState: vi.fn(actual.lockSyncState) };
});
const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const password = 'ONLY_LOCAL_TEST_PASSWORD';
const context = { serverId: 'b'.repeat(64), namespace: 'test' };
const passwordOf = (n: VaultNode) => n.type === 'connection' && (n.protocol === 'ssh' || n.protocol === 'sftp') && n.authentication.method === 'password' ? n.authentication.password : undefined;
const signal = () => new AbortController().signal;
function store(withRemove = false) {
  const data = new Map<string, string>(); const remote: VaultRemote = {
    ...(withRemove ? { async remove(id: string) { return data.delete(id); } } : {}),
    async list() { return [...data.keys()]; }, async get(id) { const wire = data.get(id); if (!wire) throw Error('Missing'); return wire; },
    async put(wire) { const id = hashWire(wire); data.set(id, wire); return id; },
  }; return { remote, data };
}
async function fixture(pw = password, withRemove = false) {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-real-sync-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const a = new VaultSessionManager(); const b = new VaultSessionManager(); cleanup.push(() => { a.lock(); b.lock(); });
  const vault: Vault = structuredClone(exampleVault); vault.workspaces = []; const api = vault.nodes[0];
  if (api.type !== 'folder') throw Error('Fixture');
  api.children = [0, 1].map(n => ({ ...structuredClone(api.children[0]), id: `password-${n}`, protocol: 'ssh', authentication: { method: 'password', password: `NEVER_PLAIN_${n}` } } as typeof api.children[0]));
  const file = await encryptVault(vault, pw);
  const path = await writeEncryptedVaultFile(join(directory, 'a.term'), file); await a.unlock(path, pw);
  return { directory, a, b, ...store(withRemove) };
}
it('publishes a real vault, imports it on another device, merges offline edits and resumes after restart', async () => {
  const { directory, a, b, remote, data } = await fixture();
  expect(await synchronizeVault(a, remote, context, signal())).toMatchObject({ status: 'synced', versions: 1 });
  const imported = await importSyncedVault(b, remote, context, password, signal(), async () => join(directory, 'b.term'));
  expect(imported).toMatchObject({ status: 'synced' });
  const av = a.getSnapshot().vault; const bv = b.getSnapshot().vault;
  if (av.nodes[0].type !== 'folder' || bv.nodes[0].type !== 'folder') throw Error('Fixture');
  const ac = av.nodes[0].children[0]; const bc = bv.nodes[0].children[1];
  if (ac.type !== 'connection' || bc.type !== 'connection' || ac.protocol !== 'ssh' || bc.protocol !== 'ssh') throw Error('Fixture');
  ac.authentication = { method: 'password', password: 'OFFLINE_A' }; bc.authentication = { method: 'password', password: 'OFFLINE_B' };
  await a.save(av); await b.save(bv);
  await synchronizeVault(a, remote, context, signal()); a.lock();
  expect(await synchronizeVault(b, remote, context, signal())).toMatchObject({ status: 'synced' });
  b.lock(); await a.unlock(join(directory, 'a.term'), password);
  await synchronizeVault(a, remote, context, signal());
  const final = a.getSnapshot().vault; if (final.nodes[0].type !== 'folder') throw Error('Fixture');
  expect(final.nodes[0].children.map(passwordOf)).toEqual(['OFFLINE_A', 'OFFLINE_B']);
  for (const wire of data.values()) for (const secret of [password, 'OFFLINE_A', 'OFFLINE_B', 'NEVER_PLAIN']) expect(wire).not.toContain(secret);
  for (const file of await readdir(directory)) { const raw = await readFile(join(directory, file), 'utf8'); expect(raw).not.toContain('OFFLINE_A'); expect(raw).not.toContain(password); }
}, 15000);

it('recovers a vault rename whose durability confirmation failed without rolling back the in-memory vault', async () => {
  const { directory, a, b, remote } = await fixture();
  await synchronizeVault(a, remote, context, signal());
  await importSyncedVault(b, remote, context, password, signal(), async () => join(directory, 'b.term'));
  await b.save({ ...b.getSnapshot().vault, name: 'Committed before failure' });
  await synchronizeVault(b, remote, context, signal());
  const actual = await vi.importActual<typeof import('../vault/storage')>('../vault/storage');
  vi.mocked(writeEncryptedVaultFile).mockImplementationOnce(async (...args) => {
    await actual.writeEncryptedVaultFile(...args);
    throw Error('Simulated post-rename flush failure');
  });
  await expect(synchronizeVault(a, remote, context, signal())).rejects.toMatchObject({ code: 'recovery' });
  expect(a.getSnapshot().vault.name).toBe('Committed before failure');
  expect(await synchronizeVault(a, remote, context, signal())).toMatchObject({ status: 'synced', snapshot: { vault: { name: 'Committed before failure' } } });
}, 15000);

it('keeps an imported vault after rename even when durability confirmation fails', async () => {
  const { directory, a, b, remote } = await fixture();
  await synchronizeVault(a, remote, context, signal());
  const actual = await vi.importActual<typeof import('../vault/storage')>('../vault/storage');
  vi.mocked(writeEncryptedVaultFile).mockImplementationOnce(async (...args) => {
    await actual.writeEncryptedVaultFile(...args);
    throw Error('Simulated post-rename flush failure');
  });
  const path = join(directory, 'b.term');
  await expect(importSyncedVault(b, remote, context, password, signal(), async () => path)).rejects.toMatchObject({ code: 'recovery' });
  expect(b.isUnlocked()).toBe(false);
  expect(await readEncryptedVaultFile(path)).toHaveProperty('payload');
  await b.unlock(path, password);
  expect(await synchronizeVault(b, remote, context, signal())).toMatchObject({ status: 'synced' });
}, 15000);
it('preserves credential conflicts and resolves only after an explicit local selection without losing independent remote changes', async () => {
  const { directory, a, b, remote } = await fixture();
  await synchronizeVault(a, remote, context, signal()); await importSyncedVault(b, remote, context, password, signal(), async () => join(directory, 'b.term'));
  const av = a.getSnapshot().vault; const bv = b.getSnapshot().vault;
  if (av.nodes[0].type !== 'folder' || bv.nodes[0].type !== 'folder') throw Error('Fixture');
  const ac = av.nodes[0].children[0]; const bc = bv.nodes[0].children[0]; if (ac.type !== 'connection' || bc.type !== 'connection' || ac.protocol !== 'ssh' || bc.protocol !== 'ssh') throw Error('Fixture');
  ac.authentication = { method: 'password', password: 'LOCAL_CHOICE' }; bc.authentication = { method: 'password', password: 'REMOTE_CHOICE' };
  bv.name = 'Independent remote name'; await a.save(av); await b.save(bv);
  await synchronizeVault(b, remote, context, signal());
  const before = await readFile(join(directory, 'a.term'), 'utf8');
  const conflict = await synchronizeVault(a, remote, context, signal());
  expect(conflict).toMatchObject({ status: 'conflict', canKeepLocal: true });
  expect(await readFile(join(directory, 'a.term'), 'utf8')).toBe(before);
  // A local edit between preview and approval invalidates the old choice.
  const edited = a.getSnapshot().vault;
  await a.save({ ...edited, settings: { ...edited.settings, autoLockMinutes: 17 } });
  const refreshed = await synchronizeVault(a, remote, context, signal(), conflict.conflictRevision);
  expect(refreshed).toMatchObject({ status: 'conflict', canKeepLocal: true });
  expect(refreshed.conflictRevision).not.toBe(conflict.conflictRevision);
  expect(await synchronizeVault(a, remote, context, signal(), refreshed.conflictRevision)).toMatchObject({ status: 'synced' });
  const final = a.getSnapshot().vault; expect(final.name).toBe('Independent remote name');
  if (final.nodes[0].type !== 'folder' || final.nodes[0].children[0].type !== 'connection') throw Error('Fixture');
  expect(passwordOf(final.nodes[0].children[0])).toBe('LOCAL_CHOICE');
}, 15000);
it('refuses wrong local passwords, known server omissions and altered ciphertext without overwriting local data', async () => {
  const { directory, a, b, remote, data } = await fixture(); await synchronizeVault(a, remote, context, signal());
  await expect(importSyncedVault(b, remote, context, 'WRONG', signal(), async () => join(directory, 'b.term'))).rejects.toThrow();
  const before = await readFile(join(directory, 'a.term'), 'utf8'); const saved = new Map(data); data.clear();
  await expect(synchronizeVault(a, remote, context, signal())).rejects.toMatchObject({ code: 'history' });
  for (const [id, wire] of saved) data.set(id, wire);
  const other = { ...remote, get: async (id: string) => { const file = JSON.parse(await remote.get(id)); file.payload = randomBytes(32).toString('base64'); return JSON.stringify(file); } };
  await expect(importSyncedVault(b, other, context, password, signal(), async () => join(directory, 'b.term'))).rejects.toThrow();
  expect(await readFile(join(directory, 'a.term'), 'utf8')).toBe(before);
}, 15000);
it('cancels on lock and detects a concurrent local save during a network operation', async () => {
  const { a, remote } = await fixture();
  let release!: () => void; let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
  const waiting = { ...remote, list: async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); return []; } };
  const task = synchronizeVault(a, waiting, context, signal()); await started;
  await a.save({ ...a.getSnapshot().vault, name: 'Kept local' }); release();
  await expect(task).rejects.toMatchObject({ code: 'changed' }); expect(a.getSnapshot().vault.name).toBe('Kept local');
  const controller = new AbortController(); controller.abort();
  await expect(synchronizeVault(a, remote, context, controller.signal)).rejects.toMatchObject({ code: 'locked' });
  a.lock(); await expect(synchronizeVault(a, remote, context, signal())).rejects.toMatchObject({ code: 'locked' });
}, 15000);

it('does not replace the local file when cancelled during the pre-commit backup', async () => {
  const { directory, a, b, remote } = await fixture();
  await synchronizeVault(a, remote, context, signal());
  await importSyncedVault(b, remote, context, password, signal(), async () => join(directory, 'b.term'));
  await b.save({ ...b.getSnapshot().vault, name: 'Remote update' });
  await synchronizeVault(b, remote, context, signal());
  const before = await readFile(join(directory, 'a.term'), 'utf8');
  const controller = new AbortController();
  const actual = await vi.importActual<typeof import('../vault/storage')>('../vault/storage');
  vi.mocked(backupVaultFile).mockImplementationOnce(async (...args) => {
    const result = await actual.backupVaultFile(...args);
    controller.abort();
    return result;
  });
  await expect(synchronizeVault(a, remote, context, controller.signal)).rejects.toMatchObject({ code: 'locked' });
  expect(await readFile(join(directory, 'a.term'), 'utf8')).toBe(before);
  expect(a.getSnapshot().vault.name).not.toBe('Remote update');
  expect(await synchronizeVault(a, remote, context, signal())).toMatchObject({ status: 'synced', snapshot: { vault: { name: 'Remote update' } } });
}, 15000);

it('returns a refreshed snapshot when recovering a committed vault after the final checkpoint write failed', async () => {
  const { directory, a, b, remote } = await fixture();
  await synchronizeVault(a, remote, context, signal());
  await importSyncedVault(b, remote, context, password, signal(), async () => join(directory, 'b.term'));
  await b.save({ ...b.getSnapshot().vault, name: 'Recovered remote update' });
  await synchronizeVault(b, remote, context, signal());
  const actual = await vi.importActual<typeof import('./vault-sync-state')>('./vault-sync-state');
  vi.mocked(lockSyncState).mockImplementationOnce(async (...args) => {
    const file = await actual.lockSyncState(...args); let pending = false;
    return { ...file, async write(value) {
      const nextPending = Boolean((value as { pending?: unknown }).pending);
      if (pending && !nextPending) throw Error('Simulated final checkpoint failure');
      await file.write(value); pending = nextPending;
    } };
  });
  await expect(synchronizeVault(a, remote, context, signal())).rejects.toThrow('Simulated final checkpoint failure');
  expect(a.getSnapshot().vault.name).toBe('Recovered remote update');
  expect(await synchronizeVault(a, remote, context, signal())).toMatchObject({ status: 'synced', snapshot: { vault: { name: 'Recovered remote update' } } });
}, 15000);

it('skips foreign objects in the account, keeps syncing afterwards and counts them', async () => {
  const { a, remote, data } = await fixture(); const other = await fixture();
  await synchronizeVault(other.a, other.remote, context, signal());
  const [foreignId, foreign] = [...other.data][0]; data.set(foreignId, foreign);
  expect(await synchronizeVault(a, remote, context, signal())).toMatchObject({ status: 'synced', skipped: 1 });
  expect(await synchronizeVault(a, remote, context, signal())).toMatchObject({ status: 'synced', skipped: 1 });
}, 30000);
it('rejects a new object whose hash does not match its id and a missing acknowledged object', async () => {
  const { directory, a, b, remote, data } = await fixture(); await synchronizeVault(a, remote, context, signal());
  await importSyncedVault(b, remote, context, password, signal(), async () => join(directory, 'b.term'));
  await b.save({ ...b.getSnapshot().vault, name: 'Newer' }); await synchronizeVault(b, remote, context, signal());
  const [oldId] = [...data.keys()]; const newId = [...data.keys()].find(id => id !== oldId)!;
  data.set(newId, data.get(oldId)!);
  await expect(synchronizeVault(a, remote, context, signal())).rejects.toMatchObject({ code: 'history' });
}, 30000);
it('imports when a foreign object comes first and refuses an account with only foreign objects', async () => {
  const { directory, a, b, remote, data } = await fixture(); const other = await fixture('OTHER_LOCAL_TEST_PASSWORD');
  await synchronizeVault(other.a, other.remote, context, signal()); await synchronizeVault(a, remote, context, signal());
  const [foreignId, foreign] = [...other.data][0];
  const mixed = { ...remote, list: async () => [foreignId, ...(await remote.list())], get: async (id: string) => id === foreignId ? foreign : remote.get(id) };
  expect(await importSyncedVault(b, mixed, context, password, signal(), async () => join(directory, 'b.term'))).toMatchObject({ status: 'synced' });
  b.lock(); data.clear(); data.set(foreignId, foreign);
  await expect(importSyncedVault(b, remote, context, password, signal(), async () => join(directory, 'c.term'))).rejects.toMatchObject({ code: 'wrongVault' });
}, 30000);
it('accepts 100 versions and rejects the 101st with limit', async () => {
  const { directory, a, b, remote } = await fixture();
  await synchronizeVault(a, remote, context, signal());
  for (let n = 1; n < 100; n++) { await a.save({ ...a.getSnapshot().vault, name: `Version ${n}` }); expect(await synchronizeVault(a, remote, context, signal())).toMatchObject({ status: 'synced', versions: n + 1 }); }
  expect(await importSyncedVault(b, remote, context, password, signal(), async () => join(directory, 'b.term'))).toMatchObject({ status: 'synced', versions: 100 });
  await a.save({ ...a.getSnapshot().vault, name: 'Version 100' });
  await expect(synchronizeVault(a, remote, context, signal())).rejects.toMatchObject({ code: 'limit' });
}, 120000);

it('imports although eight foreign objects with distinct KDF salts precede the vault versions', async () => {
  const { directory, a, b, remote, data } = await fixture();
  await synchronizeVault(a, remote, context, signal());
  await a.save({ ...a.getSnapshot().vault, name: 'Second version' }); await synchronizeVault(a, remote, context, signal());
  const own = [...data.entries()]; expect(own).toHaveLength(2); data.clear();
  for (let n = 0; n < 8; n++) { const wire = JSON.stringify(await encryptVault(structuredClone(exampleVault), `FOREIGN_PASSWORD_${n}`)); await remote.put(wire); }
  for (const [id, wire] of own) data.set(id, wire);
  expect(await importSyncedVault(b, remote, context, password, signal(), async () => join(directory, 'b.term'))).toMatchObject({ status: 'synced' });
}, 30000);

// ---- Compaction (H2 T4) ----
const sync = (m: VaultSessionManager, r: VaultRemote, s: AbortSignal = signal()) => synchronizeVault(m, r, context, s);
/** `count` changing syncs; returns the last result. */
async function churn(m: VaultSessionManager, r: VaultRemote, count: number, label = 'V') {
  let result; for (let n = 0; n < count; n++) { await m.save({ ...m.getSnapshot().vault, name: `${label} ${n}` }); result = await sync(m, r); } return result!;
}
async function readVersion(wire: string): Promise<{ parents: string[]; compacts?: string[] }> {
  const key = await keyFromPassword(password, encryptedFile(wire).kdf);
  return openDocument(encryptedFile(wire), key, encryptedFile(wire).kdf, context, 'version') as { parents: string[]; compacts?: string[] };
}
/** A publishes, B imports, then A runs `count` changing syncs. */
async function staleDevice(count: number) {
  const f = await fixture(password, true); await sync(f.a, f.remote);
  expect(await importSyncedVault(f.b, f.remote, context, password, signal(), async () => join(f.directory, 'b.term'))).toMatchObject({ status: 'synced' });
  f.b.lock(); await churn(f.a, f.remote, count, 'A');
  await f.b.unlock(join(f.directory, 'b.term'), password); return f;
}
it('compacts after 33 versions to exactly one compaction version and keeps syncing', async () => {
  const { a, remote, data } = await fixture(password, true); await sync(a, remote);
  const result = await churn(a, remote, 31); expect(result).toMatchObject({ status: 'synced', versions: 32 }); expect(result.compacted).toBeUndefined();
  const before = new Set(data.keys());
  await a.save({ ...a.getSnapshot().vault, name: 'Trigger' }); const compacted = await sync(a, remote);
  expect(compacted).toMatchObject({ status: 'synced', versions: 17 }); expect(compacted.compacted).toBeGreaterThan(0);
  expect(data.size).toBe(17);
  const added = [...data.keys()].filter(id => !before.has(id)); expect(added.length).toBe(2); // trigger version + compaction version
  const withCompacts = []; for (const wire of data.values()) { const v = await readVersion(wire); if (v.compacts) withCompacts.push(v); }
  expect(withCompacts).toHaveLength(1); expect(withCompacts[0].compacts!.length).toBe(compacted.compacted); expect(withCompacts[0].compacts!.length).toBeLessThanOrEqual(SYNC_COMPACTS_MAX);
  expect(await sync(a, remote)).toMatchObject({ status: 'synced', versions: 17 });
}, 60000);
it('creates no compacts field without compaction and does no compaction without remove', async () => {
  const { a, remote, data } = await fixture(); await sync(a, remote);
  expect(await churn(a, remote, 33)).toMatchObject({ status: 'synced', versions: 34 });
  for (const wire of data.values()) expect(await readVersion(wire)).not.toHaveProperty('compacts');
}, 60000);
it('returning device whose acked id was compacted by C1 and C1 by C2 syncs without history', async () => {
  const { b, remote, data } = await staleDevice(50);
  expect(data.size).toBeLessThan(40);
  expect(await sync(b, remote)).toMatchObject({ status: 'synced' });
  expect(await sync(b, remote)).toMatchObject({ status: 'synced' });
}, 120000);
it('returning device with a local change merges over the compacted base', async () => {
  const { b, remote } = await staleDevice(50);
  const vault = b.getSnapshot().vault; await b.save({ ...vault, settings: { ...vault.settings, autoLockMinutes: 23 } });
  const result = await sync(b, remote); expect(result).toMatchObject({ status: 'synced' });
  expect(b.getSnapshot().vault.settings.autoLockMinutes).toBe(23); expect(b.getSnapshot().vault.name).toBe('A 49');
  expect(await sync(b, remote)).toMatchObject({ status: 'synced' });
}, 120000);
it('reports a genuine conflict over a compacted base and deletes nothing', async () => {
  const { b, remote, data } = await staleDevice(50);
  await b.save({ ...b.getSnapshot().vault, name: 'B renamed' }); const ids = new Set(data.keys());
  const result = await sync(b, remote); expect(result.status).toBe('conflict');
  for (const id of ids) expect(data.has(id)).toBe(true); expect(result.compacted).toBeUndefined();
}, 120000);
it('reports history when the server deletes an acked object that no compaction covers or the acked carrier version', async () => {
  const { a, remote, data } = await fixture(password, true); await sync(a, remote); await churn(a, remote, 33);
  const saved = new Map(data); let c = '';
  for (const [id, wire] of data) if ((await readVersion(wire)).compacts) c = id;
  expect(c).not.toBe('');
  data.delete(c); await expect(sync(a, remote)).rejects.toMatchObject({ code: 'history' }); data.set(c, saved.get(c)!);
  const covered = new Set((await readVersion(saved.get(c)!)).compacts); const uncovered = [...data.keys()].filter(id => id !== c);
  expect(uncovered.length).toBeGreaterThan(0); expect(uncovered.some(id => covered.has(id))).toBe(false);
  data.delete(uncovered[0]); await expect(sync(a, remote)).rejects.toMatchObject({ code: 'history' });
}, 60000);
it('treats a compaction version under a foreign key as unreadable and reports history for acked ones', async () => {
  const { a, remote, data } = await fixture(password, true); await sync(a, remote); await churn(a, remote, 33);
  const other = await fixture('OTHER_LOCAL_TEST_PASSWORD'); await synchronizeVault(other.a, other.remote, context, signal());
  let c = ''; for (const [id, wire] of data) if ((await readVersion(wire)).compacts) c = id;
  const [foreignId, foreign] = [...other.data][0]; const saved = data.get(c)!;
  data.delete(c); data.set(foreignId, foreign);
  await expect(sync(a, remote)).rejects.toMatchObject({ code: 'history' }); data.delete(foreignId); data.set(c, saved);
}, 60000);
it('discards a compacted object the server re-delivers, repairs it and never reports history', async () => {
  const { a, remote, data } = await fixture(password, true); await sync(a, remote);
  const first = [...data.entries()][0]; await churn(a, remote, 32); expect(data.has(first[0])).toBe(false);
  data.set(first[0], first[1]); expect(data.size).toBe(18);
  const result = await sync(a, remote); expect(result).toMatchObject({ status: 'synced', versions: 17, compacted: 1 }); expect(data.has(first[0])).toBe(false); expect(data.size).toBe(17);
}, 60000);
it('survives a failing remove after the first deletion and repairs on the next run', async () => {
  const f = await fixture(password, true); const { a, data } = f; await sync(a, f.remote); await churn(a, f.remote, 31);
  let calls = 0; const flaky: VaultRemote = { ...f.remote, async remove(id) { if (++calls > 1) throw Error('network'); return data.delete(id); } };
  await a.save({ ...a.getSnapshot().vault, name: 'Trigger' });
  const result = await sync(a, flaky); expect(result).toMatchObject({ status: 'synced', compacted: 1 }); expect(data.size).toBeGreaterThan(17);
  const repaired = await sync(a, f.remote); expect(repaired).toMatchObject({ status: 'synced' }); expect(repaired.compacted).toBeGreaterThan(0); expect(data.size).toBe(17);
}, 60000);
it('repairs after an abort between the upload of the compaction version and the first remove', async () => {
  const f = await fixture(password, true); const { a, data } = f; await sync(a, f.remote); await churn(a, f.remote, 31);
  const controller = new AbortController(); const aborting: VaultRemote = { ...f.remote, async put(wire) { const id = await f.remote.put(wire); if ((await readVersion(wire)).compacts) controller.abort(); return id; } };
  await a.save({ ...a.getSnapshot().vault, name: 'Trigger' });
  await expect(sync(a, aborting, controller.signal)).rejects.toMatchObject({ code: 'locked' }); expect(data.size).toBe(34);
  expect(await sync(a, f.remote)).toMatchObject({ status: 'synced' }); expect(data.size).toBe(17);
}, 60000);
it('imports after compaction with a single head', async () => {
  const f = await fixture(password, true); await sync(f.a, f.remote); await churn(f.a, f.remote, 33);
  expect(await importSyncedVault(f.b, f.remote, context, password, signal(), async () => join(f.directory, 'b.term'))).toMatchObject({ status: 'synced', snapshot: { vault: { name: 'V 32' } } });
  expect(await sync(f.b, f.remote)).toMatchObject({ status: 'synced' });
}, 60000);
it('removeForeignObjects deletes only unreadable listed objects and ignores readable, unlisted and absent ones', async () => {
  const f = await fixture(password, true); const other = await fixture('OTHER_LOCAL_TEST_PASSWORD'); await sync(f.a, f.remote); await synchronizeVault(other.a, other.remote, context, signal());
  const [foreignId, foreign] = [...other.data][0]; f.data.set(foreignId, foreign); const [ownId] = [...f.data.keys()];
  const unlisted = 'c'.repeat(64); let removeCalls = 0; const counting: VaultRemote = { ...f.remote, async remove(id) { removeCalls++; return f.remote.remove!(id); } };
  expect(await removeForeignObjects(f.a, counting, context, [foreignId, ownId, unlisted], signal())).toBe(1);
  expect(removeCalls).toBe(1); expect(f.data.has(foreignId)).toBe(false); expect(f.data.has(ownId)).toBe(true);
  // 404 does not count.
  f.data.set(foreignId, foreign); const absent: VaultRemote = { ...f.remote, async remove() { return false; } };
  expect(await removeForeignObjects(f.a, absent, context, [foreignId], signal())).toBe(0);
  await expect(removeForeignObjects(f.a, store().remote, context, [foreignId], signal())).rejects.toMatchObject({ code: 'limit' });
}, 30000);
it('keeps a readable object of a newer client schema', async () => {
  const f = await fixture(password, true); await sync(f.a, f.remote);
  const [ownId, own] = [...f.data][0]; const { kdf } = encryptedFile(own); const key = await keyFromPassword(password, kdf);
  const newer = JSON.stringify(sealDocument({ kind: 'shellherd-sync-version-v2', future: true }, key, kdf, context, 'version')); const newerId = hashWire(newer); f.data.set(newerId, newer);
  expect(await removeForeignObjects(f.a, f.remote, context, [newerId, ownId], signal())).toBe(0);
  expect(f.data.has(newerId)).toBe(true); expect(f.data.has(ownId)).toBe(true);
}, 30000);
