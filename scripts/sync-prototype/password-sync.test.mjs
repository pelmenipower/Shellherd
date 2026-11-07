import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { expect, it as linuxIt } from 'vitest';
import { createAccount } from './account-auth.mjs';
import { createSyncServer } from './server.mjs';
import { AccountStore } from './account-transport.mjs';
import { probeSyncServer } from './http-common.mjs';
import { encryptVault } from '../../src/main/vault/crypto.ts';
import { writeEncryptedVaultFile } from '../../src/main/vault/storage.ts';
import { VaultSessionManager } from '../../src/main/vault/session.ts';
import { synchronizeVault, importSyncedVault } from '../../src/main/sync-prototype/vault-sync.ts';
import { exampleVault } from '../../src/shared/vault/example.ts';
// Persistence prototype relies on Linux permissions, directory fsync and process semantics.
const it = linuxIt.runIf(process.platform === 'linux');

it('syncs real local files through password HTTP transport, retries a lost upload acknowledgement and merges after server restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shellherd-password-sync-'));
  const a = new VaultSessionManager(); const b = new VaultSessionManager();
  const serverPassword = 'ONLY_TEST_SERVER_PASSWORD'; const vaultPassword = 'ONLY_TEST_VAULT_PASSWORD';
  const config = { directory: join(root, 'server'), serverId: randomBytes(32).toString('hex'), namespace: 'account', account: await createAccount('demo', serverPassword) };
  let server; let serverUrl; const clients = [];
  const signal = () => new AbortController().signal;
  async function login() {
    const info = await probeSyncServer(serverUrl, { allowLoopbackHttp: true });
    const client = new AccountStore(info); clients.push(client); await client.login('demo', serverPassword); return client;
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
    const first = await login();
    const lostReply = { list: () => first.list(), get: id => first.get(id), put: async wire => {
      await first.put(wire); throw Error('Lost acknowledgement after durable upload');
    } };
    await expect(synchronizeVault(a, lostReply, config, signal())).rejects.toThrow('Lost acknowledgement');
    expect(await synchronizeVault(a, first, config, signal())).toMatchObject({ status: 'synced', versions: 1 });
    expect(await first.list()).toHaveLength(1);
    await first.logout();

    const second = await login();
    await importSyncedVault(b, second, config, vaultPassword, signal(), async () => join(root, 'b.term'));
    await second.logout();
    const av = a.getSnapshot().vault; av.nodes[0].children[0].authentication.password = 'OFFLINE_LOCAL_CREDENTIAL';
    await a.save(av); await b.save({ ...b.getSnapshot().vault, name: 'Independent offline name' });
    const publishing = await login(); await synchronizeVault(a, publishing, config, signal()); await publishing.logout(); a.lock();

    await server.close(); server = await createSyncServer(config); serverUrl = await server.listen();
    const afterRestart = await login();
    expect(await synchronizeVault(b, afterRestart, config, signal())).toMatchObject({ status: 'synced' });
    b.lock(); await b.unlock(join(root, 'b.term'), vaultPassword);
    expect(b.getSnapshot().vault.name).toBe('Independent offline name');
    expect(b.getSnapshot().vault.nodes[0].children[0].authentication.password).toBe('OFFLINE_LOCAL_CREDENTIAL');
    for (const file of await readdir(config.directory)) {
      const wire = await readFile(join(config.directory, file), 'utf8');
      for (const secret of [serverPassword, vaultPassword, 'ONLY_TEST_CREDENTIAL', 'OFFLINE_LOCAL_CREDENTIAL', 'Independent offline name']) expect(wire).not.toContain(secret);
    }
  } finally {
    for (const client of clients) client.close();
    await server?.close(); a.lock(); b.lock(); await rm(root, { recursive: true, force: true });
  }
}, 20000);
