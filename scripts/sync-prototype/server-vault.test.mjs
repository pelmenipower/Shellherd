import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { expect, it as linuxIt } from 'vitest';
import { exampleVault } from '../../src/shared/vault/example.ts';
import { splitVaultForSync, mergePortableVaults, materializeVault } from '../../src/main/sync-prototype/vault-merge.ts';
import { Authority, Client, device } from './protocol.mjs';
import { createSyncServer } from './server.mjs';
import { probeSyncServer, RemoteStore } from './http-transport.mjs';
// Persistence prototype relies on Linux permissions, directory fsync and process semantics.
const it = linuxIt.runIf(process.platform === 'linux');

it('consolidates real Vault edits through the server when the two clients are never online together after setup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-server-vault-'));
  const alice = device('alice'); const bob = device('bob'); const authority = new Authority('central');
  let server; let activeA; let activeB;
  try {
    const membership = authority.setMembers([alice, bob]);
    activeA = new Client(alice, authority.publicKey, 'central'); activeA.useMembership(membership);
    activeB = new Client(bob, authority.publicKey, 'central'); activeB.useMembership(membership);
    server = await createSyncServer({ directory, namespace: 'central', serverId: randomBytes(32).toString('hex'), devices: [alice, bob].map(d => ({ id: d.id, signingKey: d.public[1] })) });
    const info = await probeSyncServer(await server.listen(), { allowLoopbackHttp: true });
    let remoteA = new RemoteStore(info, alice); let remoteB = new RemoteStore(info, bob);
    const base = structuredClone(exampleVault); const api = base.nodes[0].children[0];
    api.authentication = { method: 'password', password: 'BASE' };
    base.nodes[0].children.push({ ...structuredClone(api), id: 'db' });
    await remoteA.put(activeA.snapshot(splitVaultForSync(base).portable)); await remoteB.pull(activeB);
    const localA = structuredClone(base); localA.nodes[0].children[0].authentication.password = 'OFFLINE_A';
    const aWire = activeA.snapshot(splitVaultForSync(localA).portable);
    const savedA = activeA.exportState(); activeA.destroy(); authority.destroy();
    const localB = structuredClone(base); localB.nodes[0].children[1].authentication.password = 'OFFLINE_B';
    await remoteB.put(activeB.snapshot(splitVaultForSync(localB).portable));
    const savedB = activeB.exportState(); activeB.destroy(); // B is now offline before A returns.
    activeA = Client.restore(savedA); remoteA = new RemoteStore(info, activeA.identity);
    await remoteA.put(aWire); const heads = await remoteA.pull(activeA); expect(heads).toHaveLength(2);
    const merged = mergePortableVaults(splitVaultForSync(base).portable, activeA.value(heads[0]), activeA.value(heads[1]));
    expect(merged.conflicts).toEqual([]);
    await remoteA.put(activeA.snapshot(merged.portable, heads)); activeA.destroy();
    activeB = Client.restore(savedB); remoteB = new RemoteStore(info, activeB.identity);
    const finalHeads = await remoteB.pull(activeB); expect(finalHeads).toHaveLength(1);
    const final = materializeVault(activeB.value(finalHeads[0])).vault;
    expect(final.nodes[0].children[0].authentication.password).toBe('OFFLINE_A');
    expect(final.nodes[0].children[1].authentication.password).toBe('OFFLINE_B');
  } finally {
    activeA?.destroy(); activeB?.destroy(); alice.destroy(); bob.destroy(); authority.destroy();
    await server?.close(); await rm(directory, { recursive: true, force: true });
  }
});
