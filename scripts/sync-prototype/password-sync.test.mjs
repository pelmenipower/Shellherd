import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey, randomBytes, sign } from 'node:crypto';
import { expect, it as linuxIt } from 'vitest';
import { createAccount } from './account-auth.mjs';
import { createSyncServer } from './server.mjs';
import { AccountStore } from './account-transport.mjs';
import { probeSyncServer } from './http-common.mjs';
import { createDeviceIdentity, ed25519Spki } from './device-proof.mjs';
import { encryptVault } from '../../src/main/vault/crypto.ts';
import { writeEncryptedVaultFile } from '../../src/main/vault/storage.ts';
import { VaultSessionManager } from '../../src/main/vault/session.ts';
import { synchronizeVault, importSyncedVault } from '../../src/main/sync-prototype/vault-sync.ts';
import { exampleVault } from '../../src/shared/vault/example.ts';
// Persistence prototype relies on Linux permissions, directory fsync and process semantics.
const it = linuxIt.runIf(process.platform === 'linux');

it('syncs real local files through enrolled-device HTTP transport, retries a lost upload acknowledgement, hands the account key over by code and revokes a device', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shellherd-password-sync-'));
  const a = new VaultSessionManager(); const b = new VaultSessionManager();
  const serverPassword = 'ONLY_TEST_SERVER_PASSWORD'; const vaultPassword = 'ONLY_TEST_VAULT_PASSWORD';
  const config = { directory: join(root, 'server'), serverId: randomBytes(32).toString('hex'), namespace: 'account', account: await createAccount('demo', serverPassword) };
  let server; let serverUrl; const clients = [];
  const signal = () => new AbortController().signal;
  const identities = { a: createDeviceIdentity(), b: createDeviceIdentity() }; let recoveryCode;
  // The password goes over the wire once per device (enrollment); every later session is a signature.
  async function open(who, enroll = false) {
    const info = await probeSyncServer(serverUrl, { allowLoopbackHttp: true });
    expect(info).toMatchObject({ authentication: 'enrolled-device', deviceSessions: true });
    const client = new AccountStore(info); clients.push(client);
    if (enroll) await client.enroll(identities[who], { username: 'demo', password: serverPassword, name: `Device ${who}`, ephemeral: false });
    await client.openSession(identities[who]); return client;
  }
  /** Sync context of a device: its signer plus the freshly loaded roster. */
  async function context(client, who) {
    const list = await client.devices(); const keys = new Map(list.map(d => [d.id, createPublicKey({ key: ed25519Spki(Buffer.from(d.signingKey, 'base64')), format: 'der', type: 'spki' })]));
    return { serverId: config.serverId, namespace: config.namespace, device: { id: identities[who].id, sign: data => sign(null, data, identities[who].signingKey), keyOf: id => keys.get(id), revokedAt: id => list.find(d => d.id === id)?.revokedAt } };
  }
  try {
    server = await createSyncServer(config); serverUrl = await server.listen();
    const vault = structuredClone(exampleVault); vault.workspaces = [];
    vault.nodes = [{ id: 'folder', type: 'folder', name: 'Test', children: [{
      id: 'ssh', type: 'connection', protocol: 'ssh', name: 'Test SSH', host: 'example.test', port: 22,
      tags: [], authentication: { method: 'password', password: 'ONLY_TEST_CREDENTIAL' },
    }] }];
    const aPath = await writeEncryptedVaultFile(join(root, 'a.term'), await encryptVault(vault, vaultPassword));
    await a.unlock(aPath, vaultPassword);
    const first = await open('a', true);
    const lostReply = { list: () => first.list(), get: id => first.get(id), put: async wire => {
      await first.put(wire); throw Error('Lost acknowledgement after durable upload');
    } };
    await expect(synchronizeVault(a, lostReply, await context(first, 'a'), signal())).rejects.toThrow('Lost acknowledgement');
    // The key bootstrap is already durable (keybox put + checkpoint); the retry shows a fresh code and finishes the upload.
    const firstRun = await synchronizeVault(a, first, await context(first, 'a'), signal());
    expect(firstRun).toMatchObject({ status: 'synced', versions: 1 }); recoveryCode = firstRun.recoveryCode; expect(recoveryCode).toMatch(/^[0-9a-f]{32}$/);
    expect((await synchronizeVault(a, first, await context(first, 'a'), signal())).recoveryCode).toBeUndefined();
    expect(await first.list()).toHaveLength(2); // keybox + version
    first.close();

    const second = await open('b', true);
    expect(await second.devices()).toHaveLength(2);
    await importSyncedVault(b, second, await context(second, 'b'), recoveryCode, vaultPassword, signal(), async () => join(root, 'b.term'));
    second.close();
    const av = a.getSnapshot().vault; av.nodes[0].children[0].authentication.password = 'OFFLINE_LOCAL_CREDENTIAL';
    await a.save(av); await b.save({ ...b.getSnapshot().vault, name: 'Independent offline name' });
    const publishing = await open('a'); await synchronizeVault(a, publishing, await context(publishing, 'a'), signal()); publishing.close(); a.lock();

    await server.close(); server = await createSyncServer(config); serverUrl = await server.listen();
    const afterRestart = await open('b');
    expect(await synchronizeVault(b, afterRestart, await context(afterRestart, 'b'), signal())).toMatchObject({ status: 'synced' });
    b.lock(); await b.unlock(join(root, 'b.term'), vaultPassword);
    expect(b.getSnapshot().vault.name).toBe('Independent offline name');
    expect(b.getSnapshot().vault.nodes[0].children[0].authentication.password).toBe('OFFLINE_LOCAL_CREDENTIAL');

    // Revocation: A removes B; B's session is gone and a new one is refused.
    const admin = await open('a'); await admin.revoke(identities.a, identities.b.id);
    await expect(afterRestart.list()).rejects.toThrow(); await expect(open('b')).rejects.toThrow();
    expect((await admin.devices()).find(d => d.id === identities.b.id)).toMatchObject({ revokedAt: expect.any(Number) }); admin.close();
    for (const file of await readdir(config.directory)) {
      const wire = await readFile(join(config.directory, file), 'utf8');
      for (const secret of [serverPassword, vaultPassword, recoveryCode, 'ONLY_TEST_CREDENTIAL', 'OFFLINE_LOCAL_CREDENTIAL', 'Independent offline name']) expect(wire).not.toContain(secret);
    }
  } finally {
    for (const client of clients) client.close();
    await server?.close(); a.lock(); b.lock(); await rm(root, { recursive: true, force: true });
  }
}, 20000);
