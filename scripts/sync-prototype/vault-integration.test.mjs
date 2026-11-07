import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it as linuxIt } from 'vitest';
import { exampleVault } from '../../src/shared/vault/example.ts';
import { materializeVault, mergePortableVaults, splitVaultForSync } from '../../src/main/sync-prototype/vault-merge.ts';
import { Authority, Client, OpaqueStore, device } from './protocol.mjs';
import { LocalState } from './local-state.mjs';
// Persistence prototype relies on Linux permissions, directory fsync and process semantics.
const it = linuxIt.runIf(process.platform === 'linux');

it('consolidates real encrypted Vault versions after restart while local SSH keys/actions never reach the server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-real-vault-'));
  const authority = new Authority('real-vault'); const alice = device('alice'); const bob = device('bob');
  let local; let reopened;
  try {
    const base = structuredClone(exampleVault); const api = base.nodes[0].children[0];
    api.authentication = { method: 'privateKey', keyPath: '/device-only/id_ed25519', passphrase: 'DEVICE_ONLY_KEY_SECRET' };
    api.login = { commands: ['echo DEVICE_ONLY_START_ACTION'] };
    base.nodes[0].children.push({ ...structuredClone(api), id: 'db', host: 'db.internal', authentication: { method: 'password', password: 'VAULT_INITIAL_DB' } });
    const split = splitVaultForSync(base);
    const membership = authority.setMembers([alice, bob]);
    const a = new Client(alice, authority.publicKey, 'real-vault'); a.useMembership(membership);
    const b = new Client(bob, authority.publicKey, 'real-vault'); b.useMembership(membership);
    const store = new OpaqueStore();
    const publish = (client, wire, issuer = authority) => store.put(client.finishPublication(wire, issuer.authorize(wire, client.beginPublication(wire))));
    const root = publish(a, a.snapshot(split.portable)); b.receive(store.get(root));
    const left = structuredClone(base); left.nodes[0].children[0].name = 'Locally renamed';
    const right = structuredClone(base); right.nodes[0].children[1].authentication.password = 'VAULT_REMOTE_DB';
    const l = publish(a, a.snapshot(splitVaultForSync(left).portable));
    const r = publish(b, b.snapshot(splitVaultForSync(right).portable));
    a.receive(store.get(r)); b.receive(store.get(l));
    local = await LocalState.create(join(directory, 'device.enc'), 'public fixture password', { client: a, authority, deviceData: split.local });
    local.lock();
    reopened = await LocalState.unlock(join(directory, 'device.enc'), 'public fixture password', { context: 'real-vault' });
    const merge = mergePortableVaults(reopened.client.value(root), reopened.client.value(l), reopened.client.value(r));
    expect(merge.conflicts).toEqual([]);
    const view = materializeVault(merge.portable, reopened.deviceData);
    expect(view.needsBindings).toEqual([]);
    expect(view.vault.nodes[0].children[0].authentication.keyPath).toBe('/device-only/id_ed25519');
    expect(view.vault.nodes[0].children[0].login.commands).toEqual(['echo DEVICE_ONLY_START_ACTION']);
    expect(view.vault.nodes[0].children[1].authentication.password).toBe('VAULT_REMOTE_DB');
    expect(view.vault.nodes[0].children[1].disabled).toBe(true);
    const final = publish(reopened.client, reopened.client.snapshot(merge.portable, [l, r]), reopened.authority);
    b.receive(store.get(final));
    const received = b.value(final);
    expect(materializeVault(received).needsBindings).toContain(api.id);
    for (const marker of ['DEVICE_ONLY', '/device-only/', 'login', 'keyPath']) expect(JSON.stringify(received)).not.toContain(marker);
    for (const marker of ['DEVICE_ONLY', '/device-only/', 'VAULT_REMOTE_DB', 'Locally renamed']) expect(store.dump()).not.toContain(marker);
    const encryptedLocal = await readFile(join(directory, 'device.enc'), 'utf8');
    expect(encryptedLocal).not.toContain('/device-only/');
    expect(() => store.put(encryptedLocal)).toThrow('snapshot envelopes only');
  } finally {
    local?.lock(); reopened?.lock(); alice.destroy(); bob.destroy(); authority.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps real Vault credential conflicts as authenticated heads and recomputes them after restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-vault-conflict-'));
  const authority = new Authority('real-conflict'); const alice = device('alice'); const bob = device('bob');
  let local; let restored;
  try {
    const base = structuredClone(exampleVault);
    base.nodes[0].children[0].authentication = { method: 'password', password: 'INITIAL' };
    const membership = authority.setMembers([alice, bob]);
    const a = new Client(alice, authority.publicKey, 'real-conflict'); a.useMembership(membership);
    const b = new Client(bob, authority.publicKey, 'real-conflict'); b.useMembership(membership);
    const root = b.receive(a.snapshot(splitVaultForSync(base).portable));
    const left = structuredClone(base); left.nodes[0].children[0].authentication.password = 'LEFT_CREDENTIAL';
    const right = structuredClone(base); right.nodes[0].children[0].authentication.password = 'RIGHT_CREDENTIAL';
    const l = a.receive(a.snapshot(splitVaultForSync(left).portable));
    const r = a.receive(b.snapshot(splitVaultForSync(right).portable));
    const file = join(directory, 'local.enc');
    local = await LocalState.create(file, 'public conflict fixture', { client: a, authority }); local.lock();
    restored = await LocalState.unlock(file, 'public conflict fixture', { context: 'real-conflict' });
    const result = mergePortableVaults(restored.client.value(root), restored.client.value(l), restored.client.value(r));
    expect(result.portable).toBeNull(); expect(result.conflicts).toHaveLength(1);
    expect(JSON.stringify(result.variants.left)).toContain('LEFT_CREDENTIAL');
    expect(JSON.stringify(result.variants.right)).toContain('RIGHT_CREDENTIAL');
    expect(restored.client.heads.sort()).toEqual([l, r].sort());
  } finally {
    local?.lock(); restored?.lock(); alice.destroy(); bob.destroy(); authority.destroy();
    await rm(directory, { recursive: true, force: true });
  }
});
