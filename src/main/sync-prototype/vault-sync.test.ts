import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it as linuxIt, vi } from 'vitest';
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { VaultSessionManager } from '../vault/session';
import { encryptVault } from '../vault/crypto';
import { writeEncryptedVaultFile, readEncryptedVaultFile } from '../vault/storage';
import type { Vault, VaultNode } from '../../shared/vault/types';
import { exampleVault } from '../../shared/vault/example';
import { VAULT_PASSWORD_MIN_LENGTH } from '../../shared/vault-password';
import { synchronizeVault, importSyncedVault, removeForeignObjects, regenerateRecoveryCode, SYNC_COMPACTS_MAX } from './vault-sync';
import type { VaultRemote, VaultSyncResult } from './vault-sync';
import { hashWire, keyboxWrapKey, openSyncObject, parseSyncEnvelope, sealSyncObject, stable, versionKey } from './vault-sync-crypto';
import type { SyncContext, SyncDevice } from './vault-sync-crypto';
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
const newPassword = 'ONLY_NEW_LOCAL_PASSWORD';
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
interface Fixture { directory: string; a: VaultSessionManager; b: VaultSessionManager; remote: VaultRemote; data: Map<string, string>; code?: string; key?: Buffer }
async function fixture(pw = password, withRemove = false): Promise<Fixture> {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-real-sync-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const a = new VaultSessionManager(); const b = new VaultSessionManager(); cleanup.push(() => { a.lock(); b.lock(); });
  const vault: Vault = structuredClone(exampleVault); vault.workspaces = []; const api = vault.nodes[0];
  if (api.type !== 'folder') throw Error('Fixture');
  api.children = [0, 1].map(n => ({ ...structuredClone(api.children[0]), id: `password-${n}`, protocol: 'ssh', authentication: { method: 'password', password: `NEVER_PLAIN_${n}` } } as typeof api.children[0]));
  const file = await encryptVault(vault, pw);
  const path = await writeEncryptedVaultFile(join(directory, 'a.term'), file); await a.unlock(path, pw);
  return { directory, a, b, ...store(withRemove) };
}
const kindOf = (wire: string) => parseSyncEnvelope(wire)?.kind;
const keyboxes = (data: Map<string, string>) => [...data].filter(([, wire]) => kindOf(wire) === 'keybox');
const versions = (data: Map<string, string>) => [...data].filter(([, wire]) => kindOf(wire) === 'version');
/** Number of version objects in the fake account (the keybox is not one). */
const count = (data: Map<string, string>) => versions(data).length;
/** Account key of a fixture, opened from its keybox with the code shown at the first sync. */
function accountKey(f: Fixture): Buffer {
  const [, wire] = keyboxes(f.data)[0]; const wrap = keyboxWrapKey(f.code!, context);
  const doc = openSyncObject(wire, 'keybox', wrap, context) as { syncKey: string }; return versionKey(Buffer.from(doc.syncKey, 'base64'), context);
}
/** First sync of an empty account: returns the result and remembers the one-time code and the account key. */
async function publish(f: Fixture, ctx: SyncContext = context): Promise<VaultSyncResult> {
  const result = await synchronizeVault(f.a, f.remote, ctx, signal()); expect(result.recoveryCode).toMatch(/^[0-9a-f]{32}$/);
  f.code = result.recoveryCode; f.key = accountKey(f); return result;
}
const importB = (f: Fixture, name = 'b.term', pw = newPassword, ctx: SyncContext = context, target = f.b) =>
  importSyncedVault(target, f.remote, ctx, f.code!, pw, signal(), async () => join(f.directory, name));
async function checkpointOf(m: VaultSessionManager, ctx: SyncContext = context): Promise<Record<string, unknown> | undefined> {
  const lease = await m.captureForSync();
  try { const state = await lockSyncState(lease.snapshot.filePath, lease.key, lease.kdf, ctx, () => {}); try { return await state.read() as Record<string, unknown> | undefined; } finally { await state.close(); } }
  finally { lease.key.fill(0); }
}
it('publishes a real vault, imports it on another device, merges offline edits and resumes after restart', async () => {
  const f = await fixture(); const { directory, a, b, remote, data } = f;
  expect(await publish(f)).toMatchObject({ status: 'synced', versions: 1 });
  const imported = await importB(f);
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
  for (const wire of data.values()) for (const secret of [password, newPassword, f.code!, 'OFFLINE_A', 'OFFLINE_B', 'NEVER_PLAIN']) expect(wire).not.toContain(secret);
  for (const file of await readdir(directory)) { const raw = await readFile(join(directory, file), 'utf8'); expect(raw).not.toContain('OFFLINE_A'); expect(raw).not.toContain(password); expect(raw).not.toContain(f.code!); }
}, 15000);

it('recovers a vault rename whose durability confirmation failed without rolling back the in-memory vault', async () => {
  const f = await fixture(); const { a, b, remote } = f;
  await publish(f);
  await importB(f);
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
  const f = await fixture(); const { directory, b, remote } = f;
  await publish(f);
  const actual = await vi.importActual<typeof import('../vault/storage')>('../vault/storage');
  vi.mocked(writeEncryptedVaultFile).mockImplementationOnce(async (...args) => {
    await actual.writeEncryptedVaultFile(...args);
    throw Error('Simulated post-rename flush failure');
  });
  const path = join(directory, 'b.term');
  await expect(importB(f)).rejects.toMatchObject({ code: 'recovery' });
  expect(b.isUnlocked()).toBe(false);
  expect(await readEncryptedVaultFile(path)).toHaveProperty('payload');
  await b.unlock(path, newPassword);
  expect(await synchronizeVault(b, remote, context, signal())).toMatchObject({ status: 'synced' });
}, 15000);
it('preserves credential conflicts and resolves only after an explicit local selection without losing independent remote changes', async () => {
  const f = await fixture(); const { directory, a, b, remote } = f;
  await publish(f); await importB(f);
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
  const refreshed = await synchronizeVault(a, remote, context, signal(), { keepLocalRevision: conflict.conflictRevision });
  expect(refreshed).toMatchObject({ status: 'conflict', canKeepLocal: true });
  expect(refreshed.conflictRevision).not.toBe(conflict.conflictRevision);
  expect(await synchronizeVault(a, remote, context, signal(), { keepLocalRevision: refreshed.conflictRevision })).toMatchObject({ status: 'synced' });
  const final = a.getSnapshot().vault; expect(final.name).toBe('Independent remote name');
  if (final.nodes[0].type !== 'folder' || final.nodes[0].children[0].type !== 'connection') throw Error('Fixture');
  expect(passwordOf(final.nodes[0].children[0])).toBe('LOCAL_CHOICE');
}, 15000);
it('refuses wrong recovery codes, known server omissions and altered ciphertext without overwriting local data', async () => {
  const f = await fixture(); const { directory, a, b, remote, data } = f; await publish(f);
  const wrong = f.code!.replace(/^./, c => c === '0' ? '1' : '0');
  await expect(importSyncedVault(b, remote, context, wrong, newPassword, signal(), async () => join(directory, 'b.term'))).rejects.toMatchObject({ code: 'recoveryCode' });
  await expect(importSyncedVault(b, remote, context, 'not a code', newPassword, signal(), async () => join(directory, 'b.term'))).rejects.toMatchObject({ code: 'recoveryCode' });
  await expect(importSyncedVault(b, remote, context, f.code!, '', signal(), async () => join(directory, 'b.term'))).rejects.toMatchObject({ code: 'wrongVault' });
  expect(await readdir(directory)).not.toContain('b.term');
  const before = await readFile(join(directory, 'a.term'), 'utf8'); const saved = new Map(data); data.clear();
  await expect(synchronizeVault(a, remote, context, signal())).rejects.toMatchObject({ code: 'history' });
  for (const [id, wire] of saved) data.set(id, wire);
  const other = { ...remote, get: async (id: string) => { const file = JSON.parse(await remote.get(id)); if (file.kind === 'version') file.payload = randomBytes(32).toString('base64'); return JSON.stringify(file); } };
  await expect(importSyncedVault(b, other, context, f.code!, newPassword, signal(), async () => join(directory, 'b.term'))).rejects.toThrow();
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
  const f = await fixture(); const { directory, a, b, remote } = f;
  await publish(f);
  await importB(f);
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
  const f = await fixture(); const { a, b, remote } = f;
  await publish(f);
  await importB(f);
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
  const f = await fixture(); const { a, remote, data } = f; const other = await fixture();
  await publish(f); await publish(other);
  const [foreignId, foreign] = versions(other.data)[0]; data.set(foreignId, foreign);
  expect(await synchronizeVault(a, remote, context, signal())).toMatchObject({ status: 'synced', skipped: 1 });
  expect(await synchronizeVault(a, remote, context, signal())).toMatchObject({ status: 'synced', skipped: 1 });
}, 30000);
it('rejects a new object whose hash does not match its id and a missing acknowledged object', async () => {
  const f = await fixture(); const { a, remote, data } = f; await publish(f);
  await importB(f);
  await f.b.save({ ...f.b.getSnapshot().vault, name: 'Newer' }); await synchronizeVault(f.b, remote, context, signal());
  const [oldId] = versions(data)[0]; const newId = versions(data).map(([id]) => id).find(id => id !== oldId)!;
  data.set(newId, data.get(oldId)!);
  await expect(synchronizeVault(a, remote, context, signal())).rejects.toMatchObject({ code: 'history' });
}, 30000);
it('imports when a foreign object comes first and refuses an account without a matching keybox', async () => {
  const f = await fixture(); const { directory, b, remote, data } = f; const other = await fixture('OTHER_LOCAL_TEST_PASSWORD');
  await publish(other); await publish(f);
  const [foreignId, foreign] = versions(other.data)[0];
  const mixed = { ...remote, list: async () => [foreignId, ...(await remote.list())], get: async (id: string) => id === foreignId ? foreign : remote.get(id) };
  expect(await importSyncedVault(b, mixed, context, f.code!, newPassword, signal(), async () => join(directory, 'b.term'))).toMatchObject({ status: 'synced', skipped: 1 });
  b.lock(); data.clear(); data.set(foreignId, foreign);
  await expect(importB(f, 'c.term')).rejects.toMatchObject({ code: 'recoveryCode' });
}, 30000);
it('accepts 99 versions next to the keybox (100 objects) and rejects an account beyond the 100-object listing cap', async () => {
  const f = await fixture(); const { a, remote } = f;
  await publish(f);
  for (let n = 1; n < 99; n++) { await a.save({ ...a.getSnapshot().vault, name: `Version ${n}` }); expect(await synchronizeVault(a, remote, context, signal())).toMatchObject({ status: 'synced', versions: n + 1 }); }
  expect(await importB(f)).toMatchObject({ status: 'synced', versions: 99 });
  await a.save({ ...a.getSnapshot().vault, name: 'Version 99' });
  await synchronizeVault(a, remote, context, signal()); // The server would answer 507 here; the fake accepts the 101st object.
  await expect(synchronizeVault(a, remote, context, signal())).rejects.toMatchObject({ code: 'limit' });
}, 120000);

it('imports although eight foreign legacy objects with distinct KDF salts precede the vault versions', async () => {
  const f = await fixture(); const { a, remote, data } = f;
  await publish(f);
  await a.save({ ...a.getSnapshot().vault, name: 'Second version' }); await synchronizeVault(a, remote, context, signal());
  const own = [...data.entries()]; expect(own).toHaveLength(3); data.clear();
  for (let n = 0; n < 8; n++) { const wire = JSON.stringify(await encryptVault(structuredClone(exampleVault), `FOREIGN_PASSWORD_${n}`)); await remote.put(wire); }
  for (const [id, wire] of own) data.set(id, wire);
  expect(await importB(f)).toMatchObject({ status: 'synced', skipped: 8 });
}, 30000);

// ---- Bootstrap, recovery code and account key (H3 T3) ----
it('bootstraps an empty account: code, one keybox, one version and a checkpoint with the key but no pending keybox', async () => {
  const f = await fixture(); const result = await publish(f);
  expect(result).toMatchObject({ status: 'synced', versions: 1 }); expect(keyboxes(f.data)).toHaveLength(1); expect(count(f.data)).toBe(1);
  for (const [, wire] of f.data) expect(wire).not.toContain(f.code!);
  const state = await checkpointOf(f.a); expect(state).toMatchObject({ kind: 'shellherd-sync-state-v2' });
  expect(typeof state!.syncKey).toBe('string'); expect(Buffer.from(state!.syncKey as string, 'base64')).toHaveLength(32); expect(state).not.toHaveProperty('keybox');
  const second = await synchronizeVault(f.a, f.remote, context, signal()); expect(second).toMatchObject({ status: 'synced' }); expect(second.recoveryCode).toBeUndefined();
}, 30000);
it('reports syncKey for a second device without a code, recoveryCode for a wrong code, and syncs with the right one', async () => {
  const f = await fixture(); await publish(f); const other = await fixture(); const before = new Map(f.data);
  await expect(synchronizeVault(other.a, f.remote, context, signal())).rejects.toMatchObject({ code: 'syncKey' });
  const wrong = f.code!.replace(/^./, c => c === '0' ? '1' : '0');
  await expect(synchronizeVault(other.a, f.remote, context, signal(), { recoveryCode: wrong })).rejects.toMatchObject({ code: 'recoveryCode' });
  await expect(synchronizeVault(other.a, f.remote, context, signal(), { recoveryCode: 'nonsense' })).rejects.toMatchObject({ code: 'recoveryCode' });
  expect(f.data).toEqual(before); expect(await readdir(other.directory)).not.toContain('a.term.sync-state');
  // The same device lost its checkpoint: the right code (with the display grouping) restores the key without a bootstrap.
  await rm(join(f.directory, 'a.term.sync-state'));
  const grouped = f.code!.match(/.{4}/g)!.join('-').toUpperCase();
  const result = await synchronizeVault(f.a, f.remote, context, signal(), { recoveryCode: grouped });
  expect(result).toMatchObject({ status: 'synced', skipped: 0 }); expect(result.recoveryCode).toBeUndefined(); expect(keyboxes(f.data)).toHaveLength(1);
}, 30000);
it('aborts the bootstrap when another device uploaded a keybox between the put and the confirmation', async () => {
  const f = await fixture(password, true); const rival = await fixture(); await publish(rival);
  const [, rivalKeybox] = keyboxes(rival.data)[0]; let puts = 0;
  const racing: VaultRemote = { ...f.remote, async put(wire) { const id = await f.remote.put(wire); if (++puts === 1) f.data.set(hashWire(rivalKeybox), rivalKeybox); return id; } };
  await expect(synchronizeVault(f.a, racing, context, signal())).rejects.toMatchObject({ code: 'syncKey' });
  expect([...f.data.keys()]).toEqual([hashWire(rivalKeybox)]); expect(await readdir(f.directory)).not.toContain('a.term.sync-state'); expect(await readdir(f.directory)).not.toContain('a.term.sync-state.lock');
}, 30000);
it('continues with a new code and exactly one keybox after a crash between the keybox upload and the confirmation', async () => {
  const f = await fixture(password, true); let lists = 0;
  const crashing: VaultRemote = { ...f.remote, async list() { if (++lists === 2) throw Error('network'); return f.remote.list(); } };
  await expect(synchronizeVault(f.a, crashing, context, signal())).rejects.toThrow('network');
  expect(keyboxes(f.data)).toHaveLength(1); const [stale] = keyboxes(f.data)[0];
  expect(await checkpointOf(f.a)).toHaveProperty('keybox', stale);
  const result = await synchronizeVault(f.a, f.remote, context, signal()); f.code = result.recoveryCode; expect(f.code).toMatch(/^[0-9a-f]{32}$/);
  expect(result).toMatchObject({ status: 'synced' }); expect(keyboxes(f.data)).toHaveLength(1); expect(f.data.has(stale)).toBe(false); expect(count(f.data)).toBe(1);
  expect(await checkpointOf(f.a)).not.toHaveProperty('keybox'); f.key = accountKey(f);
  expect(await importB(f)).toMatchObject({ status: 'synced' });
}, 30000);
it('keeps the pending keybox and shows a code on the next run when the first version put fails after the confirmation', async () => {
  const f = await fixture(password, true); let failed = false;
  const failing: VaultRemote = { ...f.remote, async put(wire) { if (kindOf(wire) === 'version' && !failed) { failed = true; throw Error('network'); } return f.remote.put(wire); } };
  await expect(synchronizeVault(f.a, failing, context, signal())).rejects.toThrow('network');
  expect(keyboxes(f.data)).toHaveLength(1); expect(await checkpointOf(f.a)).toHaveProperty('keybox');
  const result = await synchronizeVault(f.a, f.remote, context, signal()); f.code = result.recoveryCode; expect(f.code).toMatch(/^[0-9a-f]{32}$/);
  expect(result).toMatchObject({ status: 'synced' }); expect(keyboxes(f.data)).toHaveLength(1); expect(count(f.data)).toBe(1);
  expect(await checkpointOf(f.a)).not.toHaveProperty('keybox'); f.key = accountKey(f);
  expect(await importB(f)).toMatchObject({ status: 'synced' });
}, 30000);
it('shows a code on the next run when the run is aborted after the own version was uploaded, without orphaning it', async () => {
  const f = await fixture(password, true); const controller = new AbortController();
  const aborting: VaultRemote = { ...f.remote, async put(wire) { const id = await f.remote.put(wire); if (kindOf(wire) === 'version') controller.abort(); return id; } };
  await expect(synchronizeVault(f.a, aborting, context, controller.signal)).rejects.toMatchObject({ code: 'locked' });
  expect(count(f.data)).toBe(1); expect(await checkpointOf(f.a)).toHaveProperty('keybox');
  const result = await synchronizeVault(f.a, f.remote, context, signal()); f.code = result.recoveryCode; expect(f.code).toMatch(/^[0-9a-f]{32}$/);
  expect(result).toMatchObject({ status: 'synced' }); expect(keyboxes(f.data)).toHaveLength(1); expect(count(f.data)).toBe(1);
  expect(await checkpointOf(f.a)).not.toHaveProperty('keybox'); f.key = accountKey(f);
  expect(await importB(f)).toMatchObject({ status: 'synced' });
}, 30000);
it('takes back own keybox, uploaded versions and checkpoint when a retried bootstrap is aborted by a rival keybox (R2)', async () => {
  const f = await fixture(password, true); const rival = await fixture(); await publish(rival);
  const [, rivalKeybox] = keyboxes(rival.data)[0]; let failed = false;
  const failing: VaultRemote = { ...f.remote, async put(wire) { const id = await f.remote.put(wire); if (kindOf(wire) === 'version' && !failed) { failed = true; throw Error('network after upload'); } return id; } };
  await expect(synchronizeVault(f.a, failing, context, signal())).rejects.toThrow('network');
  expect(count(f.data)).toBe(1); f.data.set(hashWire(rivalKeybox), rivalKeybox);
  await expect(synchronizeVault(f.a, f.remote, context, signal())).rejects.toMatchObject({ code: 'syncKey' });
  expect(await checkpointOf(f.a)).toBeUndefined(); expect([...f.data.keys()]).toEqual([hashWire(rivalKeybox)]);
  const res = await synchronizeVault(f.a, f.remote, context, signal(), { recoveryCode: rival.code });
  expect(res.status).toBe('synced'); expect(res.skipped ?? 0).toBe(0);
}, 60000);
it('R1 fixed: a failed remove of the old marker ends the run, the next run shows a code that opens the account', async () => {
  const f = await fixture(password, true); let fail = true;
  const failVersion: VaultRemote = { ...f.remote, async put(wire) { if (kindOf(wire) === 'version' && fail) throw Error('network'); return f.remote.put(wire); } };
  await expect(synchronizeVault(f.a, failVersion, context, signal())).rejects.toThrow('network');
  const failBoth: VaultRemote = { ...failVersion, async remove() { throw Error('network remove'); } };
  await expect(synchronizeVault(f.a, failBoth, context, signal())).rejects.toThrow('network remove');
  expect(keyboxes(f.data)).toHaveLength(1);
  fail = false; const result = await synchronizeVault(f.a, f.remote, context, signal()); f.code = result.recoveryCode; expect(f.code).toMatch(/^[0-9a-f]{32}$/);
  expect(result.status).toBe('synced'); expect(keyboxes(f.data)).toHaveLength(1); f.key = accountKey(f);
  expect(await importB(f)).toMatchObject({ status: 'synced' });
}, 60000);
it('tolerates the old marker without a remove method (H1 server)', async () => {
  const f = await fixture(); let failed = false;
  const failing: VaultRemote = { ...f.remote, async put(wire) { if (kindOf(wire) === 'version' && !failed) { failed = true; throw Error('network'); } return f.remote.put(wire); } };
  await expect(synchronizeVault(f.a, failing, context, signal())).rejects.toThrow('network');
  const result = await synchronizeVault(f.a, f.remote, context, signal()); expect(result).toMatchObject({ status: 'synced' }); expect(result.recoveryCode).toMatch(/^[0-9a-f]{32}$/);
}, 30000);
it('reports syncKey for versions without a keybox and recoveryCode when a code is given', async () => {
  const f = await fixture(); await publish(f);
  await rm(join(f.directory, 'a.term.sync-state'));
  for (const [id] of keyboxes(f.data)) f.data.delete(id);
  await expect(synchronizeVault(f.a, f.remote, context, signal())).rejects.toMatchObject({ code: 'syncKey' });
  await expect(synchronizeVault(f.a, f.remote, context, signal(), { recoveryCode: f.code })).rejects.toMatchObject({ code: 'recoveryCode' });
  expect(await readdir(f.directory)).not.toContain('a.term.sync-state');
}, 30000);
it('ignores a recovery code when the checkpoint already holds the key', async () => {
  const f = await fixture(); await publish(f);
  expect(await synchronizeVault(f.a, f.remote, context, signal(), { recoveryCode: 'f'.repeat(32) })).toMatchObject({ status: 'synced' });
  expect(await synchronizeVault(f.a, f.remote, context, signal(), { recoveryCode: 'nonsense' })).toMatchObject({ status: 'synced' });
}, 30000);
it('reads its checkpoint independent of extra context fields and of the device (B7)', async () => {
  const f = await fixture(); await publish(f);
  const roster = { keys: new Map<string, KeyObject>(), revoked: new Map<string, number>() }; const device = makeDevice('a', roster);
  const richer = { ...context, serverUrl: 'https://elsewhere.test', authentication: 'enrolled-device', device: device.dev } as SyncContext;
  expect(await synchronizeVault(f.a, f.remote, richer, signal())).toMatchObject({ status: 'synced' });
  expect(await synchronizeVault(f.a, f.remote, context, signal())).toMatchObject({ status: 'synced' });
  await expect(synchronizeVault(f.a, f.remote, { ...context, namespace: 'other' }, signal())).rejects.toMatchObject({ code: 'otherServer' });
}, 30000);
it('rejects a v1 checkpoint with migrate before decrypting it', async () => {
  const f = await fixture(); await writeFile(join(f.directory, 'a.term.sync-state'), JSON.stringify(['shellherd-private-sync-state-v1', { not: 'decryptable' }]), { mode: 0o600 });
  await expect(synchronizeVault(f.a, f.remote, context, signal())).rejects.toMatchObject({ code: 'migrate' });
  expect(f.data.size).toBe(0);
});
it('imports into a file with a new salt that opens only with the new password and carries a readable checkpoint', async () => {
  const f = await fixture(); await publish(f); const path = join(f.directory, 'b.term');
  await importB(f); const imported = await readEncryptedVaultFile(path); const original = await readEncryptedVaultFile(join(f.directory, 'a.term'));
  expect(imported.kdf.salt).not.toBe(original.kdf.salt); f.b.lock();
  await expect(f.b.unlock(path, password)).rejects.toThrow(); await f.b.unlock(path, newPassword);
  const state = await checkpointOf(f.b); expect(state).toMatchObject({ kind: 'shellherd-sync-state-v2' }); expect(state!.syncKey).toBeTypeOf('string');
  expect(await synchronizeVault(f.b, f.remote, context, signal())).toMatchObject({ status: 'synced' });
  await expect(importB(f, 'c.term', newPassword, context, new VaultSessionManager())).resolves.toMatchObject({ status: 'synced' });
}, 30000);
it('regenerates the recovery code: the old keybox is gone, the new code imports and the old one does not', async () => {
  const f = await fixture(password, true); await publish(f); const oldCode = f.code!; const [oldBox] = keyboxes(f.data)[0];
  const { recoveryCode } = await regenerateRecoveryCode(f.a, f.remote, context, signal());
  expect(recoveryCode).toMatch(/^[0-9a-f]{32}$/); expect(recoveryCode).not.toBe(oldCode); expect(keyboxes(f.data)).toHaveLength(1); expect(f.data.has(oldBox)).toBe(false);
  await expect(importSyncedVault(f.b, f.remote, context, oldCode, newPassword, signal(), async () => join(f.directory, 'b.term'))).rejects.toMatchObject({ code: 'recoveryCode' });
  f.code = recoveryCode; expect(await importB(f)).toMatchObject({ status: 'synced' });
  expect(await synchronizeVault(f.a, f.remote, context, signal())).toMatchObject({ status: 'synced' });
}, 30000);
it('does not return a regenerated code when removing an old keybox fails, and a second attempt cleans up', async () => {
  const f = await fixture(password, true); await publish(f);
  const failing: VaultRemote = { ...f.remote, async remove() { throw Error('network'); } };
  await expect(regenerateRecoveryCode(f.a, failing, context, signal())).rejects.toThrow('network');
  expect(keyboxes(f.data)).toHaveLength(2);
  const { recoveryCode } = await regenerateRecoveryCode(f.a, f.remote, context, signal()); expect(keyboxes(f.data)).toHaveLength(1); f.code = recoveryCode; f.key = accountKey(f);
  await expect(regenerateRecoveryCode(f.a, store().remote, context, signal())).rejects.toMatchObject({ code: 'limit' });
  const fresh = await fixture(password, true); await expect(regenerateRecoveryCode(fresh.a, fresh.remote, context, signal())).rejects.toMatchObject({ code: 'syncKey' });
}, 30000);

// ---- Author stamps and quarantine (H3 T3 stage 2) ----
interface Roster { keys: Map<string, KeyObject>; revoked: Map<string, number> }
function makeDevice(letter: string, roster: Roster) {
  const id = letter.repeat(64); const { publicKey, privateKey } = generateKeyPairSync('ed25519'); roster.keys.set(id, publicKey);
  const dev: SyncDevice = { id, sign: data => sign(null, data, privateKey), keyOf: other => roster.keys.get(other), revokedAt: other => roster.revoked.get(other) ?? null };
  return { dev, privateKey, id };
}
const withDevice = (dev: SyncDevice): SyncContext => ({ ...context, device: dev });
async function readVersion(f: Fixture, wire: string): Promise<{ parents: string[]; compacts?: string[]; portable: unknown; author?: { device: string; at: number; signature: string } }> {
  return openSyncObject(wire, 'version', f.key!, context) as { parents: string[]; compacts?: string[]; portable: unknown; author?: { device: string; at: number; signature: string } };
}
/** Forges a signed version under the account key, as a device that holds the key but was revoked. */
function forge(f: Fixture, by: { id: string; privateKey: KeyObject }, parts: { parents: string[]; portable: unknown; compacts?: string[]; at: number }): string {
  const compacts = parts.compacts ?? []; const message = JSON.stringify(['shellherd-sync-author-v1', context.serverId, context.namespace, parts.parents, compacts, hashWire(stable(parts.portable)), by.id, parts.at]);
  const author = { device: by.id, at: parts.at, signature: sign(null, Buffer.from(message), by.privateKey).toString('base64') };
  return sealSyncObject('version', { kind: 'shellherd-sync-version-v2', parents: parts.parents, portable: parts.portable, ...(compacts.length ? { compacts } : {}), author }, f.key!, context);
}
it('stamps new versions with the signed author and time only with a device context', async () => {
  const roster: Roster = { keys: new Map(), revoked: new Map() }; const A = makeDevice('a', roster);
  const f = await fixture(); await publish(f, withDevice(A.dev)); await f.a.save({ ...f.a.getSnapshot().vault, name: 'Stamped' }); await synchronizeVault(f.a, f.remote, withDevice(A.dev), signal());
  const stamped = await Promise.all(versions(f.data).map(([, wire]) => readVersion(f, wire)));
  expect(stamped).toHaveLength(2); for (const v of stamped) { expect(v.author!.device).toBe(A.id); expect(Math.abs(v.author!.at - Date.now())).toBeLessThan(60000); expect(Buffer.from(v.author!.signature, 'base64')).toHaveLength(64); }
  const plain = await fixture(); await publish(plain); for (const [, wire] of versions(plain.data)) expect(await readVersion(plain, wire)).not.toHaveProperty('author');
}, 30000);
it('imports a vault whose every version was written by a device that was revoked afterwards (lost device)', async () => {
  const roster: Roster = { keys: new Map(), revoked: new Map() }; const A = makeDevice('a', roster); const B = makeDevice('b', roster);
  const f = await fixture(); await publish(f, withDevice(A.dev)); await f.a.save({ ...f.a.getSnapshot().vault, name: 'V last' }); await synchronizeVault(f.a, f.remote, withDevice(A.dev), signal());
  roster.revoked.set(A.id, Date.now() + 60000);
  const result = await importB(f, 'b.term', newPassword, withDevice(B.dev));
  expect(result).toMatchObject({ status: 'synced', snapshot: { vault: { name: 'V last' } } }); expect(result!.quarantined).toBeUndefined(); expect(result!.unknownAuthors).toBeUndefined();
}, 30000);
it('holds back a version a revoked device wrote after its revocation, reports it and keeps syncing', async () => {
  const roster: Roster = { keys: new Map(), revoked: new Map() }; const A = makeDevice('a', roster); const B = makeDevice('b', roster);
  const f = await fixture(); await publish(f, withDevice(A.dev)); await importB(f, 'b.term', newPassword, withDevice(B.dev));
  roster.revoked.set(A.id, Date.now() - 5000);
  await f.a.save({ ...f.a.getSnapshot().vault, name: 'After revocation' }); await synchronizeVault(f.a, f.remote, withDevice(A.dev), signal());
  const held = count(f.data); const before = f.b.getSnapshot().vault.name;
  for (let run = 0; run < 2; run++) {
    const result = await synchronizeVault(f.b, f.remote, withDevice(B.dev), signal());
    expect(result).toMatchObject({ status: 'synced', quarantined: 1, versions: 1 }); expect(f.b.getSnapshot().vault.name).toBe(before);
  }
  expect(count(f.data)).toBe(held);
}, 30000);
it('accepts a version of a revoked device that is an ancestor of a version of an active device', async () => {
  const roster: Roster = { keys: new Map(), revoked: new Map() }; const A = makeDevice('a', roster); const B = makeDevice('b', roster); const C = makeDevice('c', roster);
  const f = await fixture(); await publish(f, withDevice(A.dev)); await importB(f, 'b.term', newPassword, withDevice(B.dev));
  roster.revoked.set(A.id, Date.now() - 5000);
  await f.a.save({ ...f.a.getSnapshot().vault, name: 'By revoked' }); await synchronizeVault(f.a, f.remote, withDevice(A.dev), signal());
  // B has not heard about A's key yet: the version is accepted (unknown author) and becomes the parent of B's own edit.
  const blind = withDevice({ ...B.dev, keyOf: () => undefined });
  expect(await synchronizeVault(f.b, f.remote, blind, signal())).toMatchObject({ status: 'synced', unknownAuthors: 1 });
  await f.b.save({ ...f.b.getSnapshot().vault, name: 'By active' }); await synchronizeVault(f.b, f.remote, blind, signal());
  const c = new VaultSessionManager(); cleanup.push(() => c.lock());
  const result = await importB(f, 'c.term', newPassword, withDevice(C.dev), c);
  expect(result).toMatchObject({ status: 'synced', snapshot: { vault: { name: 'By active' } } }); expect(result!.quarantined).toBeUndefined();
}, 30000);
it('holds back a new version with an invalid signature but never reclassifies acknowledged ones', async () => {
  const roster: Roster = { keys: new Map(), revoked: new Map() }; const A = makeDevice('a', roster); const B = makeDevice('b', roster);
  const f = await fixture(); await publish(f, withDevice(A.dev)); await importB(f, 'b.term', newPassword, withDevice(B.dev));
  await f.a.save({ ...f.a.getSnapshot().vault, name: 'V1' }); await synchronizeVault(f.a, f.remote, withDevice(A.dev), signal());
  expect(await synchronizeVault(f.b, f.remote, withDevice(B.dev), signal())).toMatchObject({ status: 'synced' });
  const swapped = withDevice({ ...B.dev, keyOf: () => roster.keys.get(B.id) }); // A's key is now B's key: every stamp of A fails
  const acked = await synchronizeVault(f.b, f.remote, swapped, signal()); expect(acked).toMatchObject({ status: 'synced' }); expect(acked.quarantined).toBeUndefined();
  await f.a.save({ ...f.a.getSnapshot().vault, name: 'V2' }); await synchronizeVault(f.a, f.remote, withDevice(A.dev), signal());
  expect(await synchronizeVault(f.b, f.remote, swapped, signal())).toMatchObject({ status: 'synced', quarantined: 1 });
  expect(f.b.getSnapshot().vault.name).toBe('V1');
}, 30000);
it('does not excuse a missing acknowledged version by a held compaction version (C9) and deletes nothing', async () => {
  const roster: Roster = { keys: new Map(), revoked: new Map() }; const A = makeDevice('a', roster); const X = makeDevice('c', roster);
  const f = await fixture(password, true); await publish(f, withDevice(A.dev)); await f.a.save({ ...f.a.getSnapshot().vault, name: 'V1' }); await synchronizeVault(f.a, f.remote, withDevice(A.dev), signal());
  const entries = await Promise.all(versions(f.data).map(async ([id, wire]) => ({ id, ...await readVersion(f, wire) }))); const root = entries.find(e => e.parents.length === 0)!; const head = entries.find(e => e.parents.length === 1)!;
  roster.revoked.set(X.id, Date.now() - 1000);
  const c = forge(f, X, { parents: [head.id], portable: head.portable, compacts: [root.id], at: Date.now() }); const cId = hashWire(c); f.data.set(cId, c); f.data.delete(root.id);
  let removeCalls = 0; const counting: VaultRemote = { ...f.remote, async remove(id) { removeCalls++; return f.remote.remove!(id); } };
  await expect(synchronizeVault(f.a, counting, withDevice(A.dev), signal())).rejects.toMatchObject({ code: 'history' });
  expect(removeCalls).toBe(0); expect(f.data.has(cId)).toBe(true); expect(f.data.has(head.id)).toBe(true);
}, 30000);

// ---- Compaction (H2 T4, ported to the account key) ----
const sync = (m: VaultSessionManager, r: VaultRemote, s: AbortSignal = signal()) => synchronizeVault(m, r, context, s);
/** `count` changing syncs; returns the last result. */
async function churn(m: VaultSessionManager, r: VaultRemote, count: number, label = 'V') {
  let result; for (let n = 0; n < count; n++) { await m.save({ ...m.getSnapshot().vault, name: `${label} ${n}` }); result = await sync(m, r); } return result!;
}
/** A publishes, B imports, then A runs `count` changing syncs. */
async function staleDevice(n: number) {
  const f = await fixture(password, true); await publish(f);
  expect(await importB(f)).toMatchObject({ status: 'synced' });
  f.b.lock(); await churn(f.a, f.remote, n, 'A');
  await f.b.unlock(join(f.directory, 'b.term'), newPassword); return f;
}
it('compacts after 33 versions to exactly one compaction version and keeps syncing', async () => {
  const f = await fixture(password, true); const { a, remote, data } = f; await publish(f);
  const result = await churn(a, remote, 31); expect(result).toMatchObject({ status: 'synced', versions: 32 }); expect(result.compacted).toBeUndefined();
  const before = new Set(data.keys());
  await a.save({ ...a.getSnapshot().vault, name: 'Trigger' }); const compacted = await sync(a, remote);
  expect(compacted).toMatchObject({ status: 'synced', versions: 17 }); expect(compacted.compacted).toBeGreaterThan(0);
  expect(count(data)).toBe(17); expect(keyboxes(data)).toHaveLength(1);
  const added = [...data.keys()].filter(id => !before.has(id)); expect(added.length).toBe(2); // trigger version + compaction version
  const withCompacts = []; for (const [, wire] of versions(data)) { const v = await readVersion(f, wire); if (v.compacts) withCompacts.push(v); }
  expect(withCompacts).toHaveLength(1); expect(withCompacts[0].compacts!.length).toBe(compacted.compacted); expect(withCompacts[0].compacts!.length).toBeLessThanOrEqual(SYNC_COMPACTS_MAX);
  expect(await sync(a, remote)).toMatchObject({ status: 'synced', versions: 17 });
}, 60000);
it('creates no compacts field without compaction and does no compaction without remove', async () => {
  const f = await fixture(); const { a, remote, data } = f; await publish(f);
  expect(await churn(a, remote, 33)).toMatchObject({ status: 'synced', versions: 34 });
  for (const [, wire] of versions(data)) expect(await readVersion(f, wire)).not.toHaveProperty('compacts');
}, 60000);
it('returning device whose acked id was compacted by C1 and C1 by C2 syncs without history', async () => {
  const f = await staleDevice(50); const { b, remote, data } = f;
  expect(count(data)).toBeLessThan(40);
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
  const f = await fixture(password, true); const { a, remote, data } = f; await publish(f); await churn(a, remote, 33);
  const saved = new Map(data); let c = '';
  for (const [id, wire] of versions(data)) if ((await readVersion(f, wire)).compacts) c = id;
  expect(c).not.toBe('');
  data.delete(c); await expect(sync(a, remote)).rejects.toMatchObject({ code: 'history' }); data.set(c, saved.get(c)!);
  const covered = new Set((await readVersion(f, saved.get(c)!)).compacts); const uncovered = versions(data).map(([id]) => id).filter(id => id !== c);
  expect(uncovered.length).toBeGreaterThan(0); expect(uncovered.some(id => covered.has(id))).toBe(false);
  data.delete(uncovered[0]); await expect(sync(a, remote)).rejects.toMatchObject({ code: 'history' });
}, 60000);
it('treats a compaction version under a foreign key as unreadable and reports history for acked ones', async () => {
  const f = await fixture(password, true); const { a, remote, data } = f; await publish(f); await churn(a, remote, 33);
  const other = await fixture('OTHER_LOCAL_TEST_PASSWORD'); await publish(other);
  let c = ''; for (const [id, wire] of versions(data)) if ((await readVersion(f, wire)).compacts) c = id;
  const [foreignId, foreign] = versions(other.data)[0]; const saved = data.get(c)!;
  data.delete(c); data.set(foreignId, foreign);
  await expect(sync(a, remote)).rejects.toMatchObject({ code: 'history' }); data.delete(foreignId); data.set(c, saved);
}, 60000);
it('discards a compacted object the server re-delivers, repairs it and never reports history', async () => {
  const f = await fixture(password, true); const { a, remote, data } = f; await publish(f);
  const first = versions(data)[0]; await churn(a, remote, 32); expect(data.has(first[0])).toBe(false);
  data.set(first[0], first[1]); expect(count(data)).toBe(18);
  const result = await sync(a, remote); expect(result).toMatchObject({ status: 'synced', versions: 17, compacted: 1 }); expect(data.has(first[0])).toBe(false); expect(count(data)).toBe(17);
}, 60000);
it('survives a failing remove after the first deletion and repairs on the next run', async () => {
  const f = await fixture(password, true); const { a, data } = f; await publish(f); await churn(a, f.remote, 31);
  let calls = 0; const flaky: VaultRemote = { ...f.remote, async remove(id) { if (++calls > 1) throw Error('network'); return data.delete(id); } };
  await a.save({ ...a.getSnapshot().vault, name: 'Trigger' });
  const result = await sync(a, flaky); expect(result).toMatchObject({ status: 'synced', compacted: 1 }); expect(count(data)).toBeGreaterThan(17);
  const repaired = await sync(a, f.remote); expect(repaired).toMatchObject({ status: 'synced' }); expect(repaired.compacted).toBeGreaterThan(0); expect(count(data)).toBe(17);
}, 60000);
it('repairs after an abort between the upload of the compaction version and the first remove', async () => {
  const f = await fixture(password, true); const { a, data } = f; await publish(f); await churn(a, f.remote, 31);
  const controller = new AbortController(); const aborting: VaultRemote = { ...f.remote, async put(wire) { const id = await f.remote.put(wire); if ((await readVersion(f, wire)).compacts) controller.abort(); return id; } };
  await a.save({ ...a.getSnapshot().vault, name: 'Trigger' });
  await expect(sync(a, aborting, controller.signal)).rejects.toMatchObject({ code: 'locked' }); expect(count(data)).toBe(34);
  expect(await sync(a, f.remote)).toMatchObject({ status: 'synced' }); expect(count(data)).toBe(17);
}, 60000);
/** Forges a compaction version C0 on top of the current head whose `compacts` is a full synthetic list (hex ids that sort before every real hash). */
async function forgeFullCompacts(f: Fixture): Promise<string[]> {
  const entries = new Map<string, { parents: string[]; portable: unknown }>(); for (const [id, wire] of versions(f.data)) entries.set(id, await readVersion(f, wire));
  const parents = new Set([...entries.values()].flatMap(v => v.parents)); const head = [...entries.keys()].find(id => !parents.has(id))!;
  const fake = Array.from({ length: SYNC_COMPACTS_MAX }, (_, n) => '0'.repeat(60) + n.toString(16).padStart(4, '0'));
  const c0 = sealSyncObject('version', { kind: 'shellherd-sync-version-v2', parents: [head], portable: entries.get(head)!.portable, compacts: fake }, f.key!, context);
  await f.remote.put(c0); return fake;
}
it('keeps the age order of a full compacts list: the oldest ids drop out and a device that missed two cycles stays synced', async () => {
  const f = await fixture(password, true); const { a, data } = f; await publish(f);
  expect(await importB(f)).toMatchObject({ status: 'synced' });
  f.b.lock(); await churn(a, f.remote, 31, 'A');
  const fake = await forgeFullCompacts(f); const before = new Set(data.keys());
  await a.save({ ...a.getSnapshot().vault, name: 'Trigger' }); const first = await sync(a, f.remote); expect(first).toMatchObject({ status: 'synced' }); expect(first.compacted).toBeGreaterThan(0);
  const created = versions(data).filter(([id]) => !before.has(id)); let list: string[] = [];
  for (const [, wire] of created) { const v = await readVersion(f, wire); if (v.compacts) list = v.compacts; }
  const n = first.compacted!; expect(list).toHaveLength(SYNC_COMPACTS_MAX);
  expect(list.slice(n)).toEqual(fake.slice(0, SYNC_COMPACTS_MAX - n)); // exactly the oldest fall off, order preserved
  expect(list.slice(0, n).every(id => !fake.includes(id))).toBe(true);
  await churn(a, f.remote, 17, 'A2'); // second cycle on top of the first
  await f.b.unlock(join(f.directory, 'b.term'), newPassword);
  expect(await sync(f.b, f.remote)).toMatchObject({ status: 'synced' });
}, 240000);
it('survives a failing upload of the compaction version, keeps C in the checkpoint and compacts on the next run (E5)', async () => {
  const f = await fixture(password, true); const { a, data } = f; await publish(f); await churn(a, f.remote, 31);
  const failing: VaultRemote = { ...f.remote, async put(wire) { if (kindOf(wire) === 'version' && (await readVersion(f, wire)).compacts) throw Error('network'); return f.remote.put(wire); } };
  await a.save({ ...a.getSnapshot().vault, name: 'Trigger' });
  const result = await sync(a, failing); expect(result).toMatchObject({ status: 'synced' }); expect(result.compacted).toBeUndefined(); expect(count(data)).toBe(33);
  expect(await sync(a, f.remote)).toMatchObject({ status: 'synced' });
  expect(await sync(a, f.remote)).toMatchObject({ status: 'synced' }); expect(count(data)).toBeLessThanOrEqual(18);
}, 120000);
it('does no compaction on a conflict although the graph is above the threshold', async () => {
  const f = await fixture(password, true); await publish(f);
  expect(await importB(f)).toMatchObject({ status: 'synced' });
  await churn(f.a, f.remote, 32, 'A'); expect(count(f.data)).toBeLessThanOrEqual(33);
  await f.b.save({ ...f.b.getSnapshot().vault, name: 'B renamed' }); const ids = new Set(f.data.keys());
  const result = await sync(f.b, f.remote); expect(result.status).toBe('conflict'); expect(result.compacted).toBeUndefined();
  for (const id of ids) expect(f.data.has(id)).toBe(true); expect(f.data.size).toBeLessThanOrEqual(ids.size + 1); // only B's local version is uploaded, nothing is removed
}, 120000);
it('imports after compaction with a single head', async () => {
  const f = await fixture(password, true); await publish(f); await churn(f.a, f.remote, 33);
  expect(await importB(f)).toMatchObject({ status: 'synced', snapshot: { vault: { name: 'V 32' } } });
  expect(await sync(f.b, f.remote)).toMatchObject({ status: 'synced' });
}, 60000);
it('removeForeignObjects deletes only unreadable listed objects, keeps keyboxes and ignores readable, unlisted and absent ones', async () => {
  const f = await fixture(password, true); const other = await fixture('OTHER_LOCAL_TEST_PASSWORD'); await publish(f); await publish(other);
  const [foreignId, foreign] = versions(other.data)[0]; const [rivalId, rival] = keyboxes(other.data)[0]; f.data.set(foreignId, foreign); f.data.set(rivalId, rival);
  const [ownId] = versions(f.data)[0]; const [ownBox] = keyboxes(f.data)[0];
  const legacyWire = JSON.stringify(await encryptVault(structuredClone(exampleVault), 'LEGACY_PASSWORD')); const legacyId = hashWire(legacyWire); f.data.set(legacyId, legacyWire);
  const unlisted = 'c'.repeat(64); let removeCalls = 0; const counting: VaultRemote = { ...f.remote, async remove(id) { removeCalls++; return f.remote.remove!(id); } };
  // Default: only old-format objects; unreadable version envelopes need the explicit opt-in.
  expect(await removeForeignObjects(f.a, counting, context, [foreignId, ownId, ownBox, rivalId, legacyId, unlisted], signal())).toBe(1);
  expect(removeCalls).toBe(1); expect(f.data.has(foreignId)).toBe(true); expect(f.data.has(legacyId)).toBe(false);
  expect(await removeForeignObjects(f.a, counting, context, [foreignId, ownId, ownBox, rivalId, legacyId, unlisted], signal(), { versions: true })).toBe(1);
  expect(removeCalls).toBe(2); expect(f.data.has(foreignId)).toBe(false);
  for (const id of [ownId, ownBox, rivalId]) expect(f.data.has(id)).toBe(true);
  // 404 does not count.
  f.data.set(foreignId, foreign); const absent: VaultRemote = { ...f.remote, async remove() { return false; } };
  expect(await removeForeignObjects(f.a, absent, context, [foreignId], signal())).toBe(0);
  await expect(removeForeignObjects(f.a, store().remote, context, [foreignId], signal())).rejects.toMatchObject({ code: 'limit' });
  const fresh = await fixture(password, true); await expect(removeForeignObjects(fresh.a, fresh.remote, context, [foreignId], signal())).rejects.toMatchObject({ code: 'syncKey' });
}, 30000);
it('keeps a readable object of a newer client schema', async () => {
  const f = await fixture(password, true); await publish(f);
  const [ownId] = versions(f.data)[0];
  const newer = sealSyncObject('version', { kind: 'shellherd-sync-version-v3', future: true }, f.key!, context); const newerId = hashWire(newer); f.data.set(newerId, newer);
  expect(await removeForeignObjects(f.a, f.remote, context, [newerId, ownId], signal())).toBe(0);
  expect(f.data.has(newerId)).toBe(true); expect(f.data.has(ownId)).toBe(true);
}, 30000);

it('removeForeignObjects with versions: true still keeps readable versions and keyboxes', async () => {
  const f = await fixture(password, true); await publish(f); const [ownId] = versions(f.data)[0]; const [ownBox] = keyboxes(f.data)[0];
  expect(await removeForeignObjects(f.a, f.remote, context, [ownId, ownBox], signal(), { versions: true })).toBe(0);
  expect(f.data.has(ownId) && f.data.has(ownBox)).toBe(true);
}, 30000);
it('regenerateRecoveryCode refuses an account with an unreadable version and keeps every object (foreignKey)', async () => {
  const f = await fixture(password, true); const other = await fixture('OTHER_LOCAL_TEST_PASSWORD'); await publish(f); await publish(other);
  const [foreignId, foreign] = versions(other.data)[0]; const [rivalId, rival] = keyboxes(other.data)[0]; f.data.set(foreignId, foreign); f.data.set(rivalId, rival);
  const before = new Set(f.data.keys()); let writes = 0;
  const counting: VaultRemote = { ...f.remote, async put(wire) { writes++; return f.remote.put(wire); }, async remove(id) { writes++; return f.remote.remove!(id); } };
  await expect(regenerateRecoveryCode(f.a, counting, context, signal())).rejects.toMatchObject({ code: 'foreignKey' });
  expect(writes).toBe(0); expect(new Set(f.data.keys())).toEqual(before);
}, 30000);
it('regenerateRecoveryCode returns the code although the run is aborted after the first remove (K12)', async () => {
  const f = await fixture(password, true); await publish(f); const controller = new AbortController(); const oldCode = f.code!;
  const aborting: VaultRemote = { ...f.remote, async remove(id) { const r = await f.remote.remove!(id); controller.abort(); return r; } };
  const { recoveryCode } = await regenerateRecoveryCode(f.a, aborting, context, controller.signal);
  expect(recoveryCode).toMatch(/^[0-9a-f]{32}$/); expect(recoveryCode).not.toBe(oldCode); expect(keyboxes(f.data)).toHaveLength(1);
  f.code = recoveryCode; expect(await importB(f)).toMatchObject({ status: 'synced' });
}, 30000);
it('settle writes the checkpoint despite an abort after the marker removal, and the result carries the code (R3)', async () => {
  const f = await fixture(password, true); const controller = new AbortController(); let hadMarker = false;
  vi.mocked(lockSyncState).mockImplementationOnce(async (...args) => {
    const state = await (await vi.importActual<typeof import('./vault-sync-state')>('./vault-sync-state')).lockSyncState(...args);
    return { ...state, async write(value, options) {
      await state.write(value, options); const marker = (value as { keybox?: string }).keybox;
      if (marker !== undefined) hadMarker = true; else if (hadMarker) controller.abort(); // Right after the marker removal.
    } };
  });
  const result = await synchronizeVault(f.a, f.remote, context, controller.signal);
  expect(controller.signal.aborted).toBe(true); expect(result.recoveryCode).toMatch(/^[0-9a-f]{32}$/);
  expect(await checkpointOf(f.a)).not.toHaveProperty('keybox');
}, 30000);
it('rejects a too short new vault password before any remote call (C5)', async () => {
  const f = await fixture(password, true); await publish(f); let calls = 0;
  const spy: VaultRemote = { ...f.remote, async list() { calls++; return f.remote.list(); } };
  await expect(importSyncedVault(f.b, spy, context, f.code!, 'x'.repeat(VAULT_PASSWORD_MIN_LENGTH - 1), signal(), async () => join(f.directory, 'b.term'))).rejects.toMatchObject({ code: 'wrongVault' });
  expect(calls).toBe(0);
}, 30000);
it('picks the vault of the newest version independent of the listing order (C10)', async () => {
  const f = await fixture(password, true); await publish(f);
  const other = structuredClone(f.a.getSnapshot().vault); other.id = 'second-vault-id'; other.name = 'Second';
  const sm = new VaultSessionManager(); cleanup.push(() => sm.lock());
  const path = await writeEncryptedVaultFile(join(f.directory, 's.term'), await encryptVault(other, password)); await sm.unlock(path, password);
  const { splitVaultForSync } = await import('./vault-merge'); const portable = splitVaultForSync(sm.getSnapshot().vault).portable;
  const author = { device: 'd'.repeat(64), at: Date.now() + 10_000, signature: Buffer.alloc(64).toString('base64') };
  const second = sealSyncObject('version', { kind: 'shellherd-sync-version-v2', parents: [], portable, author }, f.key!, context); f.data.set(hashWire(second), second);
  const names: string[] = [];
  for (const reverse of [false, true]) {
    const ordered: VaultRemote = { ...f.remote, async list() { const l = await f.remote.list(); return reverse ? l.reverse() : l; } };
    const target = new VaultSessionManager(); cleanup.push(() => target.lock());
    const r = await importSyncedVault(target, ordered, context, f.code!, newPassword, signal(), async () => join(f.directory, `c${reverse}.term`));
    names.push(r!.snapshot!.vault.name);
  }
  expect(names).toEqual(['Second', 'Second']);
}, 60000);
it('reports platform instead of limit on a non-linux platform (A2)', async () => {
  const f = await fixture(password, true); const spy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  try {
    await expect(synchronizeVault(f.a, f.remote, context, signal())).rejects.toMatchObject({ code: 'platform' });
    await expect(regenerateRecoveryCode(f.a, f.remote, context, signal())).rejects.toMatchObject({ code: 'platform' });
    await expect(removeForeignObjects(f.a, f.remote, context, [], signal())).rejects.toMatchObject({ code: 'platform' });
    await expect(importSyncedVault(f.b, f.remote, context, 'a'.repeat(32), newPassword, signal(), async () => undefined)).rejects.toMatchObject({ code: 'platform' });
  } finally { spy.mockRestore(); }
});
