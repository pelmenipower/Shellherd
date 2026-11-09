import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, expect, it as linuxIt } from 'vitest';
import { createAccount, accountAuth, generatePassword } from './account-auth.mjs';
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
  await expect(client.request('PUT', '/v1/vaults/account/objects/' + 'a'.repeat(64), '{}')).rejects.toMatchObject({ status: 405 });
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

const rejects = async (promise, status, retryAfter) => { const error = await promise.then(() => null, e => e); expect(error?.status).toBe(status); if (retryAfter !== undefined) expect(error.retryAfter).toBe(retryAfter); };
const body = (password = serverPassword, username = 'testuser') => ({ username, password });
it('backs off 1s, 2s, 4s from the third consecutive failure and resets on success', async () => {
  let now = 1000; const auth = accountAuth(account, () => now);
  await rejects(auth.login(body('x'), 'a'), 401); await rejects(auth.login(body('x'), 'a'), 401);
  expect((await auth.login(body(), 'a')).token).toMatch(/^[a-f0-9]{64}$/); // two failures, then success: no backoff
  for (let i = 0; i < 3; i++) await rejects(auth.login(body('x'), 'b'), 401);
  await rejects(auth.login(body(), 'b'), 429, 1); expect((await auth.login(body(), 'c')).token).toBeTruthy(); // other source unaffected
  now += 1000; await rejects(auth.login(body('x'), 'b'), 401); // 4th failure
  now += 1999; await rejects(auth.login(body(), 'b'), 429, 1); now += 1; await rejects(auth.login(body('x'), 'b'), 401); // 5th failure
  now += 3999; await rejects(auth.login(body(), 'b'), 429, 1); now += 1; expect((await auth.login(body(), 'b')).token).toBeTruthy();
  for (let i = 0; i < 2; i++) await rejects(auth.login(body('x'), 'b'), 401);
  expect((await auth.login(body(), 'b')).token).toBeTruthy(); // counter was reset by the success
}, 30000);
it('counts malformed bodies as failures and caps the backoff at 60 seconds', async () => {
  let now = 1000; const auth = accountAuth(account, () => now);
  for (let i = 0; i < 3; i++) await rejects(auth.login({}, 'a'), 400);
  await rejects(auth.login(body(), 'a'), 429, 1);
  for (let i = 0; i < 12; i++) { now += 61_000; await rejects(auth.login({}, 'a'), 400); }
  await rejects(auth.login(body(), 'a'), 429, 60);
});
it('refuses only already failing sources once the global failure budget is spent', async () => {
  const now = 1000; const auth = accountAuth(account, () => now);
  await rejects(auth.login(body('x'), 'dirty'), 401);
  for (let i = 0; i < 29; i++) await rejects(auth.login({}, 'spray' + i), 400);
  await rejects(auth.login(body(), 'dirty'), 429);
  expect((await auth.login(body(), 'clean')).token).toBeTruthy();
}, 30000);
it('rejects a wrong user name with the correct password', async () => {
  const auth = accountAuth(account); await rejects(auth.login(body(serverPassword, 'testusex'), 'a'), 401);
  await rejects(auth.login(body(serverPassword, 'x'.repeat(64)), 'a'), 401);
});
it('generates 24 character passwords from the unambiguous alphabet', () => {
  const seen = new Set(); for (let i = 0; i < 100; i++) { const p = generatePassword(); expect(p).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{24}$/); seen.add(p); }
  expect(seen.size).toBe(100);
});
it('limits logins to five per minute and source and the rendezvous budget per token', async () => {
  const { info } = await setup({ clock: () => 1000, rendezvous: true });
  const attempt = () => fetch(new URL('v1/login', info.serverUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'testuser', password: serverPassword }) });
  const first = await attempt(); expect(first.status).toBe(200); const { token } = await first.json();
  for (let i = 0; i < 4; i++) expect((await attempt()).status).toBe(200);
  const sixth = await attempt(); expect(sixth.status).toBe(429); expect(sixth.headers.get('retry-after')).toBe('12');
  const poll = () => fetch(new URL('v1/rendezvous/devices', info.serverUrl), { headers: { authorization: `Bearer ${token}` } });
  for (let i = 0; i < 180; i++) expect((await poll()).status).toBe(200);
  const over = await poll(); expect(over.status).toBe(429); expect(over.headers.get('retry-after')).toBe('1');
  expect((await fetch(new URL('v1/rendezvous/devices', info.serverUrl), { headers: { authorization: `Bearer ${'0'.repeat(64)}` } })).status).toBe(401);
}, 30000);

const fake = (n, size = 100) => JSON.stringify({ format: 'terminus-encrypted-vault', version: 1, kdf: { algorithm: 'argon2id', salt: Buffer.alloc(16, 1).toString('base64'), memoryKiB: 65536, iterations: 3, parallelism: 1 }, cipher: { algorithm: 'aes-256-gcm', nonce: Buffer.alloc(12, 2).toString('base64'), authTag: Buffer.alloc(16, 3).toString('base64') }, payload: Buffer.alloc(size, n).toString('base64') });
it('reports rendezvousNoise only when the broker runs', async () => {
  const plain = await setup(); expect(plain.info.rendezvousNoise).toBe(false);
  const raw = await boundedJson(new URL('v1/info', plain.info.serverUrl)); expect(raw.rendezvousNoise).toBe(false);
  const broker = await setup({ rendezvous: true }); expect(broker.info.rendezvousNoise).toBe(true);
  expect(raw.rendezvous).toBe(false);
});
it('deletes one object: listing shrinks, file is gone, total drops, survives restart', async () => {
  const { client, directory, config, server, info } = await setup(); await client.login('testuser', serverPassword);
  const ids = []; for (let i = 1; i <= 32; i++) ids.push(await client.put(fake(i, 780_000)));
  await expect(client.put(fake(99, 780_000))).rejects.toMatchObject({ status: 507 });
  expect(await client.remove(ids[0])).toBe(true);
  expect(await client.list()).toEqual(ids.slice(1).sort());
  expect((await readdir(directory)).includes(ids[0] + '.blob')).toBe(false);
  const extra = await client.put(fake(99, 780_000)); expect(await client.list()).toContain(extra);
  expect(await client.remove(ids[0])).toBe(false);
  await server.close(); const next = await createSyncServer(config); cleanup.push(() => next.close());
  const other = new AccountStore(await probeSyncServer(await next.listen(), { allowLoopbackHttp: true })); cleanup.push(() => other.close());
  await other.login('testuser', serverPassword); expect(await other.list()).toEqual([...ids.slice(1), extra].sort());
}, 60000);
it('rejects malformed, unauthenticated and body-carrying deletes; unknown id is 404', async () => {
  const { client, info } = await setup(); const id = await (async () => { await client.login('testuser', serverPassword); return client.put(fake(1)); })();
  const url = new URL(`/v1/vaults/account/objects/${id}`, info.serverUrl);
  await expect(boundedJson(url, { method: 'DELETE' })).rejects.toMatchObject({ status: 401 });
  await expect(client.request('DELETE', `/v1/vaults/account/objects/${id}`, '{}')).rejects.toMatchObject({ status: 400 });
  await expect(client.request('DELETE', '/v1/vaults/account/objects')).rejects.toMatchObject({ status: 405 });
  await expect(client.request('DELETE', `/v1/vaults/account/objects/${'b'.repeat(64)}`)).rejects.toMatchObject({ status: 404 });
  expect(await client.list()).toEqual([id]);
  await expect(client.remove('nope')).rejects.toThrow();
});
it('answers 409 to a delete while another write is running and never loses consistency', async () => {
  const { client } = await setup(); await client.login('testuser', serverPassword);
  const id = await client.put(fake(1)); const path = `/v1/vaults/account/objects/${id}`;
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => client.request('DELETE', path)));
  const codes = results.map(r => r.status === 'fulfilled' ? 200 : r.reason.status);
  expect(codes.filter(c => c === 200)).toHaveLength(1); expect(codes.every(c => [200, 404, 409].includes(c))).toBe(true);
  expect(await client.list()).toEqual([]);
});
