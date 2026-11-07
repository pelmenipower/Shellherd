import { afterEach, describe as linuxDescribe, expect, it as linuxIt } from 'vitest';
import { mkdtemp, readFile, readdir, rm, stat, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Authority, Client, OpaqueStore, device } from './protocol.mjs';
import { FileStore } from './file-store.mjs';
import { LocalState } from './local-state.mjs';
// Persistence prototype relies on Linux permissions, directory fsync and process semantics.
const it = linuxIt.runIf(process.platform === 'linux');
const describe = linuxDescribe.runIf(process.platform === 'linux');

const password = 'fixture passphrase only — not a production secret';
const paths = []; const handles = [];
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.lock();
  for (const path of paths.splice(0)) await rm(path, { recursive: true, force: true });
});
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-local-state-')); paths.push(directory);
  const file = join(directory, 'local.enc');
  const authority = new Authority('persist-vault'); const alice = device('alice'); const bob = device('bob');
  const membership = authority.setMembers([alice, bob]);
  const a = new Client(alice, authority.publicKey, 'persist-vault'); a.useMembership(membership);
  const b = new Client(bob, authority.publicKey, 'persist-vault'); b.useMembership(membership);
  const base = a.snapshot({ api: { password: 'PERSIST_MARKER_INITIAL' } });
  const root = b.receive(base);
  const local = await LocalState.create(file, password, { client: a, authority }); handles.push(local);
  return { file, directory, authority, a, b, alice, bob, root, base, local };
}
async function unlock(file, options = {}) {
  const handle = await LocalState.unlock(file, password, { context: 'persist-vault', ...options });
  handles.push(handle); return handle;
}

describe('encrypted local device/sync checkpoint', () => {
  it('restores actual private keys, authority, offline edits, known heads and outbox without reusing upload permits', async () => {
    const { file, a, local, authority, alice } = await setup();
    const publicDevice = [...alice.public]; const publicRoot = authority.publicKey;
    const wire = a.snapshot({ api: { password: 'PERSIST_OFFLINE_NEW' } }); const tip = a.heads[0];
    const challenge = a.beginPublication(wire); const permit = authority.authorize(wire, challenge);
    const pending = a.pendingSnapshots();
    await local.save(); local.lock();
    expect(alice.signing.privateKey.every(x => x === 0)).toBe(true);
    expect(() => a.snapshot({})).toThrow();
    const restored = await unlock(file, { rootKey: publicRoot });
    expect(restored.client.identity.public).toEqual(publicDevice);
    expect(restored.authority.publicKey).toBe(publicRoot);
    expect(restored.client.value(tip).api.password).toBe('PERSIST_OFFLINE_NEW');
    expect(restored.client.pendingSnapshots()).toEqual(pending);
    expect(() => restored.client.finishPublication(wire, permit)).toThrow('Unknown');
    expect(() => restored.client.assertServerHeads([])).toThrow('omitted');
    const fresh = restored.client.beginPublication(wire);
    expect(restored.client.finishPublication(wire, restored.authority.authorize(wire, fresh))).toBe(wire);
    restored.client.acknowledgePublication(tip); await restored.save(); restored.lock();
    const again = await unlock(file);
    expect(again.client.pendingSnapshots().map(o => o.hash)).not.toContain(tip);
  });

  it('preserves both credential conflict variants and resolves them after a restart', async () => {
    const { file, local, a, b, root } = await setup();
    const left = a.snapshot({ api: { password: 'PERSIST_LEFT' } });
    const right = b.snapshot({ api: { password: 'PERSIST_RIGHT' } });
    const l = b.receive(left); const r = a.receive(right);
    const merge = a.stageMerge(root, l, r);
    expect(merge.conflicts).toHaveLength(1);
    await local.save(); local.lock();
    const restored = await unlock(file);
    const conflict = restored.client.stagedMerges()[0];
    expect(conflict.mergeId).toBe(merge.mergeId);
    expect(conflict.conflicts[0].left.password).toBe('PERSIST_LEFT');
    expect(conflict.conflicts[0].right.password).toBe('PERSIST_RIGHT');
    const wire = restored.client.resolveMerge(conflict.mergeId, { api: { password: 'PERSIST_EXPLICIT_CHOICE' } });
    expect(restored.client.stagedMerges()).toEqual([]);
    expect(b.value(b.receive(wire)).api.password).toBe('PERSIST_EXPLICIT_CHOICE');
    await restored.save();
    expect(await readFile(file, 'utf8')).not.toContain('PERSIST_');
  });

  it('restores historical epochs without accepting stale live membership', async () => {
    const { file, local, a, authority, alice } = await setup();
    const oldState = a.exportState();
    const next = authority.setMembers([alice]); a.useMembership(next);
    a.snapshot({ api: { password: 'AFTER_REVOCATION' } });
    await local.save(); local.lock();
    const restored = await unlock(file);
    expect(restored.client.heads).toHaveLength(1);
    expect(() => restored.client.useMembership(oldState[4][0])).toThrow('rollback');
    expect(() => restored.client.receive(oldState[5][0])).toThrow('epoch');
  });

  it('rejects wrong passwords, wrong pinned context/root and modified envelopes with bounded KDF settings', async () => {
    const { file, local } = await setup(); local.lock();
    await expect(LocalState.unlock(file, 'incorrect', { context: 'persist-vault' })).rejects.toThrow('Wrong password');
    await expect(unlock(file, { context: 'other-vault' })).rejects.toThrow('mismatch');
    await expect(unlock(file, { rootKey: new Authority('elsewhere').publicKey })).rejects.toThrow('mismatch');
    const original = await readFile(file, 'utf8');
    for (const attack of ['ciphertext', 'nonce', 'kdf', 'version']) {
      const value = JSON.parse(original);
      if (attack === 'kdf') value[0][2] = 2 ** 40;
      else if (attack === 'version') value[0][0] = 'shellherd-lab-local-v0';
      else { const index = attack === 'ciphertext' ? 2 : 1; value[index] = (value[index][0] === 'A' ? 'B' : 'A') + value[index].slice(1); }
      await writeFile(file, JSON.stringify(value));
      await expect(unlock(file)).rejects.toThrow();
    }
  });

  it('never writes plaintext keys or content, uses restrictive modes, and produces fresh ciphertext on every save', async () => {
    const { file, directory, local, alice, authority } = await setup();
    const keys = [alice.exportState()[2], alice.exportState()[3], authority.exportState()[2]];
    const before = await readFile(file, 'utf8'); await local.save();
    const after = await readFile(file, 'utf8');
    expect(before).not.toBe(after);
    expect(JSON.parse(before)[1]).not.toBe(JSON.parse(after)[1]);
    for (const marker of [...keys, 'PERSIST_', password, 'persist-vault', 'alice']) expect(after).not.toContain(marker);
    expect(() => new OpaqueStore().put(after)).toThrow('snapshot envelopes only');
    await expect(new FileStore(join(directory, 'server')).put(after)).rejects.toThrow('snapshot envelopes only');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect((await stat(directory)).mode & 0o777).toBe(0o700);
    expect(await readdir(directory)).toEqual(['local.enc']);
  });

  it('does not overwrite newer state from another unlocked handle or an existing file', async () => {
    const { file, local } = await setup();
    const other = await unlock(file);
    local.client.snapshot({ api: { password: 'newer' } }); await local.save();
    const accepted = await readFile(file, 'utf8');
    other.client.snapshot({ api: { password: 'stale' } });
    await expect(other.save()).rejects.toThrow('changed externally');
    expect(await readFile(file, 'utf8')).toBe(accepted);
    await expect(LocalState.create(file, password, { client: other.client })).rejects.toThrow('already exists');
  });

  it('keeps the old complete checkpoint on a write failure before rename', async () => {
    const { file, local, directory } = await setup();
    const before = await readFile(file, 'utf8');
    local.client.snapshot({ api: { password: 'NOT_YET_DURABLE' } });
    await expect(local.save({ fault: stage => { if (stage === 'beforeRename') throw Error('injected write failure'); } })).rejects.toThrow('injected');
    expect(await readFile(file, 'utf8')).toBe(before);
    expect(await readdir(directory)).toEqual(['local.enc']);
    await local.save();
    expect(await readFile(file, 'utf8')).not.toBe(before);
  });

  it('requires reloading after an uncertain post-rename failure, preserving a complete new checkpoint', async () => {
    const { file, local } = await setup();
    local.client.snapshot({ api: { password: 'COMMITTED_NEW' } });
    const heads = local.client.heads;
    await expect(local.save({ fault: stage => { if (stage === 'afterRename') throw Error('directory sync failed'); } })).rejects.toThrow('sync failed');
    await expect(local.save()).rejects.toThrow('uncertain');
    const restored = await unlock(file);
    expect(restored.client.heads).toEqual(heads);
    expect(restored.client.value(heads[0]).api.password).toBe('COMMITTED_NEW');
  });

  it('survives actual process termination before rename and refuses to clear the orphan lock automatically', async () => {
    const { file, local, directory } = await setup(); local.lock();
    const before = await readFile(file, 'utf8');
    const source = `import { LocalState } from ${JSON.stringify(new URL('./local-state.mjs', import.meta.url).href)};
      const state = await LocalState.unlock(process.env.TEST_CHECKPOINT, ${JSON.stringify(password)}, {context:'persist-vault'});
      state.client.snapshot({api:{password:'INTERRUPTED_CHILD'}});
      await state.save({fault: stage => {if(stage==='beforeRename') process.kill(process.pid,'SIGKILL')}});`;
    // Only a public fixture passphrase is embedded. Real secrets never go in argv/env.
    const child = spawn(process.execPath, ['--input-type=module', '-e', source], { env: { ...process.env, TEST_CHECKPOINT: file }, stdio: 'ignore' });
    const [code, signal] = await once(child, 'exit');
    expect(code).toBe(null); expect(signal).toBe('SIGKILL');
    expect(await readFile(file, 'utf8')).toBe(before);
    const restored = await unlock(file);
    await expect(restored.save()).rejects.toMatchObject({ code: 'EEXIST' });
    const files = await readdir(directory);
    expect(files.some(name => name.endsWith('.local-tmp'))).toBe(true);
    for (const name of files) expect(await readFile(join(directory, name), 'utf8')).not.toContain('INTERRUPTED_CHILD');
  });

  it('rejects symlink replacement and malformed authenticated checkpoint internals', async () => {
    const { file, directory, local, a } = await setup(); local.lock();
    const alias = join(directory, 'alias.enc'); await symlink(file, alias);
    await expect(unlock(alias)).rejects.toThrow();
    const fresh = await unlock(file); const state = fresh.client.exportState();
    const brokenHeads = structuredClone(state); brokenHeads[6] = [];
    expect(() => Client.restore(brokenHeads)).toThrow('heads mismatch');
    const duplicated = structuredClone(state); duplicated[5].push(duplicated[5][0]);
    expect(() => Client.restore(duplicated)).toThrow('Duplicate');
    const badKeys = structuredClone(state); badKeys[3][2] = state[3][3];
    expect(() => Client.restore(badKeys)).toThrow();
    expect(() => a.exportState()).toThrow();
  });

  it('serializes writes and prevents locking while a captured state is being saved', async () => {
    const { file, local } = await setup(); const other = await unlock(file);
    let release; let reached;
    const gate = new Promise(resolve => { release = resolve; });
    const ready = new Promise(resolve => { reached = resolve; });
    const save = local.save({ fault: async stage => { if (stage === 'beforeRename') { reached(); await gate; } } });
    await ready;
    const capturedHeads = local.client.heads;
    try {
      await expect(local.save()).rejects.toThrow('busy');
      expect(() => local.lock()).toThrow('progress');
      await expect(other.save()).rejects.toMatchObject({ code: 'EEXIST' });
      local.client.snapshot({ api: { password: 'EDIT_DURING_SAVE' } });
    } finally { release(); }
    const receipt = await save;
    expect(receipt.heads).toEqual(capturedHeads);
    expect(receipt.heads).not.toEqual(local.client.heads);
    const restored = await unlock(file); expect(restored.client.heads).toEqual(capturedHeads);
    await local.save();
    const latest = await unlock(file); expect(latest.client.heads).toEqual(local.client.heads);
  });
});
