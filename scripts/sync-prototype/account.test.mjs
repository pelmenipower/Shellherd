import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, expect, it as linuxIt } from 'vitest';
import { createAccount } from './account-auth.mjs';
import { createSyncServer } from './server.mjs';
import { AccountStore } from './account-transport.mjs';
import { probeSyncServer, boundedJson } from './http-common.mjs';
import { encryptVault, unlockVault } from '../../src/main/vault/crypto.ts';
import { exampleVault } from '../../src/shared/vault/example.ts';
// Persistence prototype relies on Linux permissions, directory fsync and process semantics.
const it = linuxIt.runIf(process.platform === 'linux');
const serverPassword = 'ONLY_TEST_SERVER_PASSWORD'; const vaultPassword = 'ONLY_TEST_LOCAL_VAULT_PASSWORD';
let account; const cleanup = [];
beforeAll(async () => { account = await createAccount('testuser', serverPassword); });
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-account-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const config = { directory, namespace: 'account', serverId: randomBytes(32).toString('hex'), account, ...options };
  const server = await createSyncServer(config); cleanup.push(() => server.close());
  const info = await probeSyncServer(await server.listen(), { allowLoopbackHttp: true });
  const client = new AccountStore(info); cleanup.push(() => client.close());
  return { directory, config, server, info, client };
}
it('logs in with username/password and transfers real encrypted Vault files with no device setup', async () => {
  const { client, server, config, directory } = await setup();
  await client.login('testuser', serverPassword);
  const vault = structuredClone(exampleVault); vault.nodes[0].children[0].authentication = { method: 'password', password: 'NEVER_SERVER_PLAINTEXT' };
  const wire = JSON.stringify(await encryptVault(vault, vaultPassword)); const id = await client.put(wire);
  expect(await client.put(wire)).toBe(id); await client.logout(); await server.close();
  const next = await createSyncServer(config); cleanup.push(() => next.close());
  const info = await probeSyncServer(await next.listen(), { allowLoopbackHttp: true });
  expect(info).toMatchObject({ authentication: 'password', enrollmentAvailable: false });
  const other = new AccountStore(info); cleanup.push(() => other.close()); await other.login('testuser', serverPassword);
  expect(await other.list()).toEqual([id]); const downloaded = JSON.parse(await other.get(id));
  await expect(unlockVault(downloaded, serverPassword)).rejects.toThrow();
  const opened = await unlockVault(downloaded, vaultPassword);
  try { expect(opened.vault.nodes[0].children[0].authentication.password).toBe('NEVER_SERVER_PLAINTEXT'); }
  finally { opened.key.fill(0); }
  for (const file of await readdir(directory)) {
    const stored = await readFile(join(directory, file), 'utf8');
    for (const secret of [serverPassword, vaultPassword, 'NEVER_SERVER_PLAINTEXT']) expect(stored).not.toContain(secret);
  }
}, 15000);
it('rejects missing/wrong credentials, plaintext uploads and device administration in account mode', async () => {
  const { client, info } = await setup();
  await expect(client.list()).rejects.toThrow();
  await expect(client.login('testuser', 'wrong')).rejects.toMatchObject({ status: 401 });
  await expect(client.login('unknown', serverPassword)).rejects.toMatchObject({ status: 401 });
  await client.login('testuser', serverPassword);
  await expect(client.put(JSON.stringify(exampleVault))).rejects.toThrow();
  await expect(client.request('PUT', '/v1/vaults/account/objects', JSON.stringify(exampleVault))).rejects.toMatchObject({ status: 400 });
  await expect(client.request('GET', '/v1/access')).rejects.toMatchObject({ status: 404 });
  await expect(boundedJson(new URL('/v1/vaults/account/objects', info.serverUrl))).rejects.toMatchObject({ status: 401 });
  await expect(boundedJson(new URL('/v1/challenge', info.serverUrl))).rejects.toMatchObject({ status: 404 });
  expect(await client.list()).toEqual([]);
});
it('expires sessions, revokes logout tokens and limits password attempts', async () => {
  let now = 1000; const { info } = await setup({ clock: () => now });
  const login = () => boundedJson(new URL('v1/login', info.serverUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'testuser', password: serverPassword }) });
  const { token } = await login(); const headers = { authorization: `Bearer ${token}` };
  expect(await boundedJson(new URL('/v1/vaults/account/objects', info.serverUrl), { headers })).toEqual({ objects: [] });
  await boundedJson(new URL('/v1/logout', info.serverUrl), { method: 'POST', headers });
  await expect(boundedJson(new URL('/v1/vaults/account/objects', info.serverUrl), { headers })).rejects.toMatchObject({ status: 401 });
  const fresh = await login(); now += 900000;
  await expect(boundedJson(new URL('/v1/vaults/account/objects', info.serverUrl), { headers: { authorization: `Bearer ${fresh.token}` } })).rejects.toMatchObject({ status: 401 });
  // Malformed attempts also consume the bounded login budget without expensive hashing.
  for (let i = 0; i < 10; i++) await boundedJson(new URL('/v1/login', info.serverUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => {});
  await expect(login()).rejects.toMatchObject({ status: 429 });
});
it('refuses mixed authentication modes and does not persist a plaintext account password', async () => {
  expect(account).not.toHaveProperty('password'); expect(JSON.stringify(account)).not.toContain(serverPassword);
  expect(await createAccount('testuser', serverPassword)).not.toEqual(account);
  await expect(setup({ devices: [{ id: 'injected', signingKey: randomBytes(32).toString('base64') }] })).rejects.toThrow();
});
