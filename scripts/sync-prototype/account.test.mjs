import { chmod, mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes, sign } from 'node:crypto';
import { afterEach, beforeAll, expect, it as linuxIt, vi } from 'vitest';
import { createAccount, accountAuth, generatePassword } from './account-auth.mjs';
import { createSyncServer } from './server.mjs';
import { AccountStore } from './account-transport.mjs';
import { probeSyncServer, boundedJson } from './http-common.mjs';
import { createDeviceIdentity, enrollmentBody, requestProofV2, sessionProof } from './device-proof.mjs';
import { encryptVault } from '../../src/main/vault/crypto.ts';
import { exampleVault } from '../../src/shared/vault/example.ts';
// Persistence prototype relies on Linux permissions, directory fsync and process semantics.
const it = linuxIt.runIf(process.platform === 'linux');
const serverPassword = 'ONLY_TEST_SERVER_PASSWORD'; const vaultPassword = 'ONLY_TEST_LOCAL_VAULT_PASSWORD';
let account; const cleanup = [];
beforeAll(async () => { account = await createAccount('testuser', serverPassword); });
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });

const b64 = (n, fill) => Buffer.alloc(n, fill).toString('base64');
/** A well-formed sync object envelope (the server cannot tell it from real ciphertext). */
const syncObject = (n, size = 100, kind = 'version') => JSON.stringify({ format: 'shellherd-sync-object', version: 1, kind, cipher: { algorithm: 'aes-256-gcm', nonce: b64(12, 2), authTag: b64(16, 3) }, payload: b64(size, n) });
const legacy = (n, size = 100) => JSON.stringify({ format: 'terminus-encrypted-vault', version: 1, kdf: { algorithm: 'argon2id', salt: b64(16, 1), memoryKiB: 65536, iterations: 3, parallelism: 1 }, cipher: { algorithm: 'aes-256-gcm', nonce: b64(12, 2), authTag: b64(16, 3) }, payload: b64(size, n) });
const sha = value => createHash('sha256').update(value).digest('hex');

async function setup(options = {}) {
  const { prepare, ...rest } = options;
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-account-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await prepare?.(directory);
  const config = { directory, namespace: 'account', serverId: randomBytes(32).toString('hex'), account, limits: { login: 100, session: 100, challenge: 100 }, ...rest };
  const server = await createSyncServer(config); cleanup.push(() => server.close());
  const info = await probeSyncServer(await server.listen(), { allowLoopbackHttp: true });
  const client = new AccountStore(info); cleanup.push(() => client.close());
  return { directory, config, server, info, client, origin: new URL(info.serverUrl).origin };
}
/** Enrolled device with an open session on its own store. */
async function signedIn(ctx, name = 'Laptop', { ephemeral = false } = {}) {
  const identity = createDeviceIdentity(); const store = new AccountStore(ctx.info); cleanup.push(() => store.close());
  await store.enroll(identity, { username: 'testuser', password: serverPassword, name, ephemeral }); await store.openSession(identity);
  return { identity, store };
}

// Raw protocol access for the edge cases the client refuses to produce.
const http = async (ctx, method, path, { headers = {}, body } = {}) => {
  const response = await fetch(new URL(path, ctx.info.serverUrl), { method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers }, body });
  return { status: response.status, json: await response.json().catch(() => null), headers: response.headers };
};
const nonceOf = async ctx => (await http(ctx, 'GET', '/v1/challenge')).json.nonce;
const enrollmentOf = (ctx, identity, name = 'Raw') => {
  const body = enrollmentBody(ctx.config.serverId, ctx.config.namespace, ctx.origin, identity.id, identity.signingPublicKey, identity.publicKey, name);
  return [JSON.parse(body), sign(null, Buffer.from(body), identity.signingKey).toString('base64')];
};
const enrollRaw = (ctx, identity, extra = {}) => http(ctx, 'POST', '/v1/devices', { body: JSON.stringify({ username: 'testuser', password: serverPassword, enrollment: enrollmentOf(ctx, identity), ...extra }) });
const sessionRaw = async (ctx, identity, { nonce, signer = identity, device = identity.id } = {}) => {
  nonce ??= await nonceOf(ctx);
  const signature = sign(null, Buffer.from(sessionProof(ctx.config.serverId, ctx.config.namespace, ctx.origin, nonce, device)), signer.signingKey).toString('base64');
  return { nonce, ...await http(ctx, 'POST', '/v1/session', { body: JSON.stringify({ device, nonce, signature }) }) };
};
const bearer = result => ({ authorization: `Bearer ${result.json.token}` });
async function revokeRaw(ctx, { signer, token, id, deviceHeader = signer.id, path = '/v1/devices/' + id, signedPath = path, body }) {
  const nonce = await nonceOf(ctx);
  const signature = sign(null, Buffer.from(requestProofV2(ctx.config.serverId, ctx.config.namespace, ctx.origin, 'DELETE', signedPath, nonce, signer.id)), signer.signingKey).toString('base64');
  return http(ctx, 'DELETE', path, { headers: { authorization: `Bearer ${token}`, 'x-shellherd-device': deviceHeader, 'x-shellherd-nonce': nonce, 'x-shellherd-signature': signature }, body });
}

it('enrolls a device with the server password, signs in without it and transfers sync objects', async () => {
  const ctx = await setup(); const { client, config, directory } = ctx;
  expect(ctx.info).toMatchObject({ authentication: 'enrolled-device', deviceSessions: true });
  const identity = createDeviceIdentity();
  await expect(client.list()).rejects.toThrow();
  expect(await client.enroll(identity, { username: 'testuser', password: serverPassword, name: 'Büro', ephemeral: false })).toMatchObject({ id: identity.id, name: 'Büro', ephemeral: false });
  await expect(client.list()).rejects.toThrow(); // enrollment grants no token
  await client.openSession(identity);
  const wire = syncObject(1); const id = await client.put(wire); expect(await client.put(wire)).toBe(id); await client.logout(); await ctx.server.close();
  const next = await createSyncServer(config); cleanup.push(() => next.close());
  const other = new AccountStore(await probeSyncServer(await next.listen(), { allowLoopbackHttp: true })); cleanup.push(() => other.close());
  await other.openSession(identity); // persistent enrollment, no password
  expect(await other.list()).toEqual([id]); expect(await other.get(id)).toBe(wire);
  for (const file of await readdir(directory)) {
    const stored = await readFile(join(directory, file), 'utf8');
    for (const secret of [serverPassword, vaultPassword]) expect(stored).not.toContain(secret);
  }
}, 15000);
it('rejects missing/wrong credentials, plaintext and legacy uploads and removed routes', async () => {
  const { client, info } = await setup(); const identity = createDeviceIdentity();
  await expect(client.enroll(identity, { username: 'testuser', password: 'wrong', name: 'A', ephemeral: false })).rejects.toMatchObject({ status: 401 });
  await expect(client.enroll(identity, { username: 'unknown', password: serverPassword, name: 'A', ephemeral: false })).rejects.toMatchObject({ status: 401 });
  await expect(client.list()).rejects.toThrow();
  await client.enroll(identity, { username: 'testuser', password: serverPassword, name: 'A', ephemeral: false }); await client.openSession(identity);
  await expect(client.put(JSON.stringify(exampleVault))).rejects.toThrow();
  await expect(client.put(JSON.stringify(await encryptVault(exampleVault, vaultPassword)))).rejects.toThrow();
  await expect(client.request('PUT', '/v1/vaults/account/objects', JSON.stringify(exampleVault))).rejects.toMatchObject({ status: 400 });
  await expect(client.request('PUT', '/v1/vaults/account/objects', legacy(1))).rejects.toMatchObject({ status: 400 });
  await expect(client.request('PUT', '/v1/vaults/account/objects/' + 'a'.repeat(64), '{}')).rejects.toMatchObject({ status: 405 });
  await expect(client.request('GET', '/v1/access')).rejects.toMatchObject({ status: 404 });
  await expect(boundedJson(new URL('/v1/vaults/account/objects', info.serverUrl))).rejects.toMatchObject({ status: 401 });
  await expect(boundedJson(new URL('/v1/login', info.serverUrl), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'testuser', password: serverPassword }) })).rejects.toMatchObject({ status: 404 });
  expect(await client.list()).toEqual([]);
});
it('reports the enrolled-device mode and the sync object format in /v1/info', async () => {
  const ctx = await setup(); const raw = await http(ctx, 'GET', '/v1/info');
  expect(raw.json).toMatchObject({ authentication: 'enrolled-device', deviceSessions: true, objectFormat: 'sync-object', namespace: 'account' });
});
it('expires sessions, revokes logout tokens and refreshes', async () => {
  let now = 1000; const ctx = await setup({ clock: () => now }); const { identity } = await signedIn(ctx);
  const first = await sessionRaw(ctx, identity); expect(first.status).toBe(200); const headers = bearer(first);
  expect((await http(ctx, 'GET', '/v1/vaults/account/objects', { headers })).json).toEqual({ objects: [] });
  expect((await http(ctx, 'POST', '/v1/logout', { headers })).status).toBe(200);
  expect((await http(ctx, 'GET', '/v1/vaults/account/objects', { headers })).status).toBe(401);
  const fresh = await sessionRaw(ctx, identity); expect((await http(ctx, 'POST', '/v1/refresh', { headers: bearer(fresh) })).status).toBe(200);
  now += 900000; expect((await http(ctx, 'GET', '/v1/vaults/account/objects', { headers: bearer(fresh) })).status).toBe(401);
});
it('limits enrollment attempts per source and counts malformed bodies as failures', async () => {
  const ctx = await setup({ limits: { challenge: 100, session: 100 }, clock: () => 1000 }); const identity = createDeviceIdentity();
  const attempt = () => enrollRaw(ctx, identity);
  for (let i = 0; i < 5; i++) expect((await attempt()).status).toBe(i === 0 ? 201 : 200);
  const sixth = await attempt(); expect(sixth.status).toBe(429); expect(sixth.headers.get('retry-after')).toBe('12');
  const other = await setup({ limits: { challenge: 100, login: 100 }, clock: () => 1000 });
  for (let i = 0; i < 3; i++) expect((await http(other, 'POST', '/v1/devices', { body: '{}' })).status).toBe(400);
  expect((await enrollRaw(other, createDeviceIdentity())).status).toBe(429); // backoff after three failures
});
it('refuses mixed authentication modes and does not persist a plaintext account password', async () => {
  expect(account).not.toHaveProperty('password'); expect(JSON.stringify(account)).not.toContain(serverPassword);
  expect(await createAccount('testuser', serverPassword)).not.toEqual(account);
  await expect(setup({ devices: [{ id: 'injected', signingKey: randomBytes(32).toString('base64') }] })).rejects.toThrow();
});

it('consumes the nonce on a wrong signature, an unknown and a revoked device (second use is 401)', async () => {
  const ctx = await setup(); const { identity } = await signedIn(ctx); const stranger = createDeviceIdentity(); const revoked = await signedIn(ctx, 'Gone');
  const admin = await signedIn(ctx, 'Admin'); await admin.store.revoke(admin.identity, revoked.identity.id);
  const wrong = await sessionRaw(ctx, identity, { signer: stranger }); expect(wrong.status).toBe(401);
  expect((await sessionRaw(ctx, identity, { nonce: wrong.nonce })).status).toBe(401);
  const unknown = await sessionRaw(ctx, stranger); expect(unknown.status).toBe(401); expect((await sessionRaw(ctx, stranger, { nonce: unknown.nonce })).status).toBe(401);
  const gone = await sessionRaw(ctx, revoked.identity); expect(gone.status).toBe(401); expect((await sessionRaw(ctx, identity, { nonce: gone.nonce })).status).toBe(401);
  const ok = await sessionRaw(ctx, identity); expect(ok.status).toBe(200); expect(ok.json.device).toBe(identity.id);
  expect((await sessionRaw(ctx, identity, { nonce: ok.nonce })).status).toBe(401);
});
it('rejects a session proof for another device id and malformed session bodies', async () => {
  const ctx = await setup(); const { identity } = await signedIn(ctx); const other = await signedIn(ctx, 'Other');
  expect((await sessionRaw(ctx, identity, { device: other.identity.id })).status).toBe(401);
  expect((await http(ctx, 'POST', '/v1/session', { body: JSON.stringify({ device: identity.id }) })).status).toBe(400);
  expect((await http(ctx, 'POST', '/v1/session', { body: 'x'.repeat(4097) })).status).toBe(413);
  expect((await http(ctx, 'GET', '/v1/session')).status).toBe(405);
});
it('expires a nonce after 30 seconds', async () => {
  let now = 1000; const ctx = await setup({ clock: () => now }); const { identity } = await signedIn(ctx);
  const nonce = await nonceOf(ctx); now += 30_000; expect((await sessionRaw(ctx, identity, { nonce })).status).toBe(401);
  const fresh = await nonceOf(ctx); now += 29_999; expect((await sessionRaw(ctx, identity, { nonce: fresh })).status).toBe(200);
});
it('rejects a replayed nonce, a forged MAC and a nonce from the future with 401', async () => {
  const ctx = await setup(); const { identity } = await signedIn(ctx);
  const nonce = await nonceOf(ctx); expect((await sessionRaw(ctx, identity, { nonce })).status).toBe(200);
  expect((await sessionRaw(ctx, identity, { nonce })).status).toBe(401); // replay
  const issued = await nonceOf(ctx); const forged = issued.slice(0, 32) + '0'.repeat(32);
  expect((await sessionRaw(ctx, identity, { nonce: forged })).status).toBe(401);
  expect((await sessionRaw(ctx, identity, { nonce: issued })).status).toBe(200); // the forgery did not burn the real nonce
  const future = Buffer.from(await nonceOf(ctx), 'hex'); future.writeBigUInt64BE(BigInt(Date.now() + 60_000), 0);
  expect((await sessionRaw(ctx, identity, { nonce: future.toString('hex') })).status).toBe(401);
});
it('keeps no state for issued challenges: 200 challenges from 16 sources never block another source', async () => {
  const ctx = await setup({ trustedProxy: '127.0.0.1', limits: { source: 1000, global: 1000, challenge: 100 } });
  const challenge = n => http(ctx, 'GET', '/v1/challenge', { headers: { 'x-forwarded-for': `198.51.100.${n}` } });
  for (let i = 0; i < 200; i++) expect((await challenge(1 + (i % 16))).status).toBe(200);
  expect((await challenge(77)).status).toBe(200);
  const nonces = new Set(); for (let i = 0; i < 20; i++) nonces.add((await challenge(77)).json.nonce); expect(nonces.size).toBe(20);
});
it('fails closed with 429 when 4096 spent nonces are still valid and frees the set once they expire', async () => {
  let now = 1_000_000; const ctx = await setup({ clock: () => now, trustedProxy: '127.0.0.1', limits: { source: 1e6, global: 1e6, challenge: 1e6, session: 1e6, concurrentPerSource: 100 } });
  const post = async (nonce, n) => (await http(ctx, 'POST', '/v1/session', { headers: { 'x-forwarded-for': `10.${n >> 8}.${n & 255}.7` }, body: JSON.stringify({ device: 'a'.repeat(64), nonce, signature: 'AAAA' }) })).status;
  const tick = async n => (await http(ctx, 'GET', '/v1/challenge', { headers: { 'x-forwarded-for': `10.${n >> 8}.${n & 255}.7` } })).json.nonce;
  for (let i = 0; i < 4096; i++) { const status = await post(await tick(1 + (i % 600)), 1 + (i % 600)); expect(status, 'nonce ' + i).toBe(401); } // spent, then rejected as an unknown device
  const extra = await tick(1000); expect(await post(extra, 1000)).toBe(429);
  now += 30_000; expect(await post(await tick(1001), 1001)).toBe(401); // expired entries were pruned: spending works again
}, 120_000);
it('limits challenges per source with their own budget', async () => {
  const ctx = await setup({ clock: () => 1000, limits: { login: 100, session: 100, challenge: 12 } }); const codes = [];
  for (let i = 0; i < 14; i++) codes.push((await http(ctx, 'GET', '/v1/challenge')).status);
  expect(codes.filter(code => code === 200).length).toBeGreaterThan(0); expect(codes.at(-1)).toBe(429);
});
it('lets a fifth session of a device displace the oldest one', async () => {
  let now = 1000; const ctx = await setup({ clock: () => now }); const { identity } = await signedIn(ctx); const tokens = [];
  for (let i = 0; i < 5; i++) { now += 10; tokens.push(await sessionRaw(ctx, identity)); }
  const status = async result => (await http(ctx, 'GET', '/v1/devices', { headers: bearer(result) })).status;
  expect(await status(tokens[0])).toBe(401); for (const result of tokens.slice(1)) expect(await status(result)).toBe(200);
});
it('lists devices with signing keys, sorted, and without trusting a client-side self', async () => {
  let now = 1000; const ctx = await setup({ clock: () => now }); const a = await signedIn(ctx, 'A'); now += 5; const b = await signedIn(ctx, 'B', { ephemeral: true });
  const listed = await http(ctx, 'GET', '/v1/devices', { headers: bearer(await sessionRaw(ctx, a.identity)) });
  expect(listed.json.devices.map(d => d.name)).toEqual(['A', 'B']);
  expect(listed.json.devices[0]).toEqual({ id: a.identity.id, name: 'A', signingKey: a.identity.signingPublicKey, enrolledAt: 1000, revokedAt: null, ephemeral: false, self: true });
  expect(listed.json.devices[1]).toMatchObject({ id: b.identity.id, ephemeral: true, self: false });
  expect(await a.store.devices()).toHaveLength(2);
});
it('enrolls idempotently, rejects a mismatching device id and the identity-point key', async () => {
  const ctx = await setup(); const id = createDeviceIdentity();
  expect((await enrollRaw(ctx, id)).status).toBe(201); expect((await enrollRaw(ctx, id)).status).toBe(200);
  expect((await enrollRaw(ctx, id, { ephemeral: true })).status).toBe(409);
  const bad = enrollmentOf(ctx, id); bad[0][4] = createDeviceIdentity().id;
  const doc = JSON.stringify([bad[0], bad[1]]); expect((await http(ctx, 'POST', '/v1/devices', { body: JSON.stringify({ username: 'testuser', password: serverPassword, enrollment: JSON.parse(doc) }) })).status).toBe(400);
  const weak = createDeviceIdentity(); const body = JSON.parse(enrollmentBody(ctx.config.serverId, ctx.config.namespace, ctx.origin, weak.id, weak.signingPublicKey, weak.publicKey, 'W'));
  body[5] = Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]).toString('base64');
  const point = [body, Buffer.concat([Buffer.from([1]), Buffer.alloc(63)]).toString('base64')];
  expect((await http(ctx, 'POST', '/v1/devices', { body: JSON.stringify({ username: 'testuser', password: serverPassword, enrollment: point }) })).status).toBe(400);
});
it('enrolls with a re-enrollment name update and lifts a revocation', async () => {
  const ctx = await setup(); const a = await signedIn(ctx, 'A'); const admin = await signedIn(ctx, 'Admin');
  await admin.store.revoke(admin.identity, a.identity.id);
  expect((await sessionRaw(ctx, a.identity)).status).toBe(401);
  expect(await a.store.enroll(a.identity, { username: 'testuser', password: serverPassword, name: 'A2', ephemeral: false })).toMatchObject({ name: 'A2' });
  expect((await sessionRaw(ctx, a.identity)).status).toBe(200);
});
it('evicts the oldest idle temporary device at 8 and answers 429 when all have sessions', async () => {
  const ctx = await setup(); const devices = [];
  for (let i = 0; i < 8; i++) devices.push(await signedIn(ctx, 'e' + i, { ephemeral: true }));
  // All eight hold a session: a ninth is refused.
  expect((await enrollRaw(ctx, createDeviceIdentity(), { ephemeral: true })).status).toBe(429);
  // Free one by logging its session out; it becomes the one evicted.
  await devices[3].store.logout();
  const ninth = createDeviceIdentity(); expect((await enrollRaw(ctx, ninth, { ephemeral: true })).status).toBe(201);
  expect((await sessionRaw(ctx, devices[3].identity)).status).toBe(401);
  // Ten password checks (scrypt N=2^17) exceed the 5 s default under full-suite load.
}, 30_000);
it('persists across restart: persistent entries stay, temporary ones are lost', async () => {
  const ctx = await setup(); const p = await signedIn(ctx, 'P'); const e = await signedIn(ctx, 'E', { ephemeral: true });
  await ctx.server.close(); const next = await createSyncServer(ctx.config); cleanup.push(() => next.close());
  const info = await probeSyncServer(await next.listen(), { allowLoopbackHttp: true }); const store = new AccountStore(info); cleanup.push(() => store.close());
  await expect(store.openSession(e.identity)).rejects.toMatchObject({ status: 401 });
  await expect(store.openSession(p.identity)).resolves.toMatchObject({ signedIn: true });
});
it('answers 503 after an uncertain roster write and refuses to start on a foreign or non-canonical devices.json', async () => {
  let armed = false; const ctx = await setup({ rosterFault: async point => { if (armed && point === 'afterDevicesRename') throw Error('boom'); } });
  await signedIn(ctx, 'First'); armed = true;
  expect((await enrollRaw(ctx, createDeviceIdentity())).status).toBe(400); armed = false; // the failed write surfaces as a rejected request
  expect((await enrollRaw(ctx, createDeviceIdentity())).status).toBe(503);
  expect((await http(ctx, 'DELETE', '/v1/devices/' + 'a'.repeat(64))).status).toBe(401);
  await ctx.server.close();
  const file = join(ctx.directory, 'devices.json'); const text = await readFile(file, 'utf8');
  await writeFile(file, text.replace(ctx.config.serverId, '3'.repeat(64)), { mode: 0o600 });
  await expect(createSyncServer(ctx.config)).rejects.toThrow();
  await writeFile(file, JSON.stringify(JSON.parse(text), null, 1), { mode: 0o600 });
  await expect(createSyncServer(ctx.config)).rejects.toThrow();
  await writeFile(file, text, { mode: 0o600 }); await chmod(file, 0o600);
  const again = await createSyncServer(ctx.config); await again.close();
});
it('revokes with a device-bound proof: header, path, body and nonce checks', async () => {
  const ctx = await setup(); const a = await signedIn(ctx, 'A'); const b = await signedIn(ctx, 'B');
  const token = bearer(await sessionRaw(ctx, a.identity)).authorization.slice(7);
  const target = b.identity.id;
  expect((await revokeRaw(ctx, { signer: a.identity, token, id: target, deviceHeader: b.identity.id })).status).toBe(401); // header names another device
  expect((await revokeRaw(ctx, { signer: a.identity, token, id: target, signedPath: '/v1/devices/' + a.identity.id })).status).toBe(401); // proof for another path
  expect((await revokeRaw(ctx, { signer: a.identity, token, id: target, body: '{}' })).status).toBe(400);
  expect((await revokeRaw(ctx, { signer: b.identity, token, id: target })).status).toBe(401); // signer is not the session device
  expect((await http(ctx, 'DELETE', '/v1/devices/' + target, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
  expect((await sessionRaw(ctx, b.identity)).status).toBe(200); // not revoked yet
  const done = await revokeRaw(ctx, { signer: a.identity, token, id: target }); expect(done.status).toBe(200); expect(done.json).toEqual({ revoked: true });
  expect((await revokeRaw(ctx, { signer: a.identity, token, id: target })).status).toBe(200); // second revoke
  expect((await revokeRaw(ctx, { signer: a.identity, token, id: '9'.repeat(64) })).status).toBe(404);
  expect((await sessionRaw(ctx, b.identity)).status).toBe(401);
  await expect(b.store.list()).rejects.toMatchObject({ status: 401 }); // its existing token died with the revocation
  const nonce = await nonceOf(ctx); // a spent nonce cannot be reused
  const sig = sign(null, Buffer.from(requestProofV2(ctx.config.serverId, ctx.config.namespace, ctx.origin, 'DELETE', '/v1/devices/' + target, nonce, a.identity.id)), a.identity.signingKey).toString('base64');
  const headers = { authorization: `Bearer ${token}`, 'x-shellherd-device': a.identity.id, 'x-shellherd-nonce': nonce, 'x-shellherd-signature': sig };
  expect((await http(ctx, 'DELETE', '/v1/devices/' + target, { headers })).status).toBe(200); expect((await http(ctx, 'DELETE', '/v1/devices/' + target, { headers })).status).toBe(401);
});
it('serves legacy objects with GET and DELETE but refuses to store one', async () => {
  const old = legacy(5); const id = sha(old);
  const ctx = await setup({ prepare: async directory => { await writeFile(join(directory, id + '.blob'), old, { mode: 0o600 }); } });
  const { store } = await signedIn(ctx); expect(await store.list()).toEqual([id]); expect(await store.get(id)).toBe(old);
  await expect(store.put(old)).rejects.toThrow(); await expect(store.request('PUT', '/v1/vaults/account/objects', old)).rejects.toMatchObject({ status: 400 });
  expect(await store.remove(id)).toBe(true); expect(await store.list()).toEqual([]);
});
it('budgets object writes per device', async () => {
  const ctx = await setup({ clock: () => 1000, limits: { login: 100, session: 100, challenge: 100, deviceWrites: 3 } }); const { store } = await signedIn(ctx);
  for (let i = 1; i <= 3; i++) await store.put(syncObject(i));
  await expect(store.put(syncObject(9))).rejects.toMatchObject({ status: 429 });
});
it('reports rendezvousNoise only when the broker runs', async () => {
  const plain = await setup(); expect(plain.info.rendezvousNoise).toBe(false);
  const raw = await boundedJson(new URL('v1/info', plain.info.serverUrl)); expect(raw.rendezvousNoise).toBe(false);
  const broker = await setup({ rendezvous: true }); expect(broker.info.rendezvousNoise).toBe(true);
  expect(raw.rendezvous).toBe(false);
});
it('deletes one object: listing shrinks, file is gone, total drops, survives restart', async () => {
  const ctx = await setup(); const { directory, config, server } = ctx; const { store, identity } = await signedIn(ctx);
  const ids = []; for (let i = 1; i <= 32; i++) ids.push(await store.put(syncObject(i, 780_000)));
  await expect(store.put(syncObject(99, 780_000))).rejects.toMatchObject({ status: 507 });
  expect(await store.remove(ids[0])).toBe(true);
  expect(await store.list()).toEqual(ids.slice(1).sort());
  expect((await readdir(directory)).includes(ids[0] + '.blob')).toBe(false);
  const extra = await store.put(syncObject(99, 780_000)); expect(await store.list()).toContain(extra);
  expect(await store.remove(ids[0])).toBe(false);
  await server.close(); const next = await createSyncServer(config); cleanup.push(() => next.close());
  const other = new AccountStore(await probeSyncServer(await next.listen(), { allowLoopbackHttp: true })); cleanup.push(() => other.close());
  await other.openSession(identity); expect(await other.list()).toEqual([...ids.slice(1), extra].sort());
}, 60000);
it('rejects malformed, unauthenticated and body-carrying deletes; unknown id is 404', async () => {
  const ctx = await setup(); const { store } = await signedIn(ctx); const id = await store.put(syncObject(1));
  const url = new URL(`/v1/vaults/account/objects/${id}`, ctx.info.serverUrl);
  await expect(boundedJson(url, { method: 'DELETE' })).rejects.toMatchObject({ status: 401 });
  await expect(store.request('DELETE', `/v1/vaults/account/objects/${id}`, '{}')).rejects.toMatchObject({ status: 400 });
  await expect(store.request('DELETE', '/v1/vaults/account/objects')).rejects.toMatchObject({ status: 405 });
  await expect(store.request('DELETE', `/v1/vaults/account/objects/${'b'.repeat(64)}`)).rejects.toMatchObject({ status: 404 });
  expect(await store.list()).toEqual([id]);
  await expect(store.remove('nope')).rejects.toThrow();
});
it('answers 409 to a delete while another write is running and never loses consistency', async () => {
  const ctx = await setup(); const { store } = await signedIn(ctx);
  const id = await store.put(syncObject(1)); const path = `/v1/vaults/account/objects/${id}`;
  const results = await Promise.allSettled(Array.from({ length: 6 }, () => store.request('DELETE', path)));
  const codes = results.map(r => r.status === 'fulfilled' ? 200 : r.reason.status);
  expect(codes.filter(c => c === 200)).toHaveLength(1); expect(codes.every(c => [200, 404, 409].includes(c))).toBe(true);
  expect(await store.list()).toEqual([]);
});
it('limits the rendezvous budget per token', async () => {
  const ctx = await setup({ clock: () => 1000, rendezvous: true }); const { identity } = await signedIn(ctx);
  const session = await sessionRaw(ctx, identity); const headers = bearer(session);
  const poll = () => fetch(new URL('v1/rendezvous/devices', ctx.info.serverUrl), { headers });
  for (let i = 0; i < 180; i++) expect((await poll()).status).toBe(200);
  const over = await poll(); expect(over.status).toBe(429); expect(over.headers.get('retry-after')).toBe('1');
  expect((await fetch(new URL('v1/rendezvous/devices', ctx.info.serverUrl), { headers: { authorization: `Bearer ${'0'.repeat(64)}` } })).status).toBe(401);
}, 30000);

// accountAuth unit tests: password check with backoff and the device session table.
const rejects = async (promise, status, retryAfter) => { const error = await promise.then(() => null, e => e); expect(error?.status).toBe(status); if (retryAfter !== undefined) expect(error.retryAfter).toBe(retryAfter); };
const body = (password = serverPassword, username = 'testuser') => ({ username, password });
const roster = (...active) => ({ isActive: id => active.includes(id) });
it('backs off 1s, 2s, 4s from the third consecutive failure and resets on success', async () => {
  let now = 1000; const auth = accountAuth(account, () => now);
  await rejects(auth.verifyPassword(body('x'), 'a'), 401); await rejects(auth.verifyPassword(body('x'), 'a'), 401);
  expect(await auth.verifyPassword(body(), 'a')).toBe(true); // two failures, then success: no backoff
  for (let i = 0; i < 3; i++) await rejects(auth.verifyPassword(body('x'), 'b'), 401);
  await rejects(auth.verifyPassword(body(), 'b'), 429, 1); expect(await auth.verifyPassword(body(), 'c')).toBe(true); // other source unaffected
  now += 1000; await rejects(auth.verifyPassword(body('x'), 'b'), 401); // 4th failure
  now += 1999; await rejects(auth.verifyPassword(body(), 'b'), 429, 1); now += 1; await rejects(auth.verifyPassword(body('x'), 'b'), 401); // 5th failure
  now += 3999; await rejects(auth.verifyPassword(body(), 'b'), 429, 1); now += 1; expect(await auth.verifyPassword(body(), 'b')).toBe(true);
  for (let i = 0; i < 2; i++) await rejects(auth.verifyPassword(body('x'), 'b'), 401);
  expect(await auth.verifyPassword(body(), 'b')).toBe(true); // counter was reset by the success
}, 30000);
it('counts malformed bodies as failures and caps the backoff at 60 seconds', async () => {
  let now = 1000; const auth = accountAuth(account, () => now);
  for (let i = 0; i < 3; i++) await rejects(auth.verifyPassword({}, 'a'), 400);
  await rejects(auth.verifyPassword(body(), 'a'), 429, 1);
  for (let i = 0; i < 12; i++) { now += 61_000; await rejects(auth.verifyPassword({}, 'a'), 400); }
  await rejects(auth.verifyPassword(body(), 'a'), 429, 60);
});
it('refuses every source before scrypt after 20 wrong passwords per 10 minutes and lifts the cap with the window', async () => {
  let now = 1000; const auth = accountAuth(account, () => now);
  for (let i = 0; i < 20; i++) await rejects(auth.verifyPassword(body('x'), 'spray' + i), 401);
  const before = Date.now(); await rejects(auth.verifyPassword(body(), 'fresh'), 429, 600); expect(Date.now() - before).toBeLessThan(100); // refused before scrypt
  now += 599_000; await rejects(auth.verifyPassword(body(), 'fresh'), 429, 1);
  now += 1000; expect(await auth.verifyPassword(body(), 'fresh')).toBe(true);
}, 60000);
it('counts only wrong password comparisons toward the global cap, not malformed bodies', async () => {
  const auth = accountAuth(account, () => 1000);
  for (let i = 0; i < 30; i++) await rejects(auth.verifyPassword({}, 'junk' + i), 400);
  expect(await auth.verifyPassword(body(), 'owner')).toBe(true);
});
it('rejects a wrong user name with the correct password', async () => {
  const auth = accountAuth(account); await rejects(auth.verifyPassword(body(serverPassword, 'testusex'), 'a'), 401);
  await rejects(auth.verifyPassword(body(serverPassword, 'x'.repeat(64)), 'a'), 401);
});
it('generates 24 character passwords from the unambiguous alphabet', () => {
  const seen = new Set(); for (let i = 0; i < 100; i++) { const p = generatePassword(); expect(p).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{24}$/); seen.add(p); }
  expect(seen.size).toBe(100);
});
it('keeps at most 4 sessions per device and ties sessions to the roster', () => {
  let now = 1000; const d = 'd'.repeat(64); const e = 'e'.repeat(64); let active = [d, e]; const auth = accountAuth(account, () => now, undefined, { isActive: id => active.includes(id) });
  const tokens = []; for (let i = 0; i < 5; i++) { now += 1; tokens.push(auth.openSession(d)); }
  expect(() => auth.authorize(`Bearer ${tokens[0].token}`)).toThrow(); const key = auth.authorize(`Bearer ${tokens[4].token}`);
  expect(auth.deviceOf(key)).toBe(d); expect(auth.hasSession(d)).toBe(true); expect(auth.hasSession(e)).toBe(false); expect(auth.isActive(key)).toBe(true);
  active = [e]; expect(auth.isActive(key)).toBe(false);
  expect(() => auth.authorize(`Bearer ${tokens[4].token}`)).toThrow(); // the session of a revoked device is dropped on use
  active = [d, e]; auth.dropDevice(d); expect(auth.hasSession(d)).toBe(false);
});
it('answers 429 once 64 sessions are open and 500 without a roster', () => {
  const auth = accountAuth(account, () => 1000, undefined, { isActive: () => true });
  for (let device = 0; device < 16; device++) for (let i = 0; i < 4; i++) auth.openSession(device.toString(16).repeat(64));
  expect(() => auth.openSession('f'.repeat(63) + '0')).toThrow(expect.objectContaining({ status: 429 }));
  const bare = accountAuth(account); expect(() => bare.openSession('d'.repeat(64))).toThrow(expect.objectContaining({ status: 500 }));
  expect(() => bare.authorize('Bearer ' + '0'.repeat(64))).toThrow(expect.objectContaining({ status: 500 }));
});

// Review fixes: cheap rejections before scrypt, separate session failure budget, nonce first, DELETE budget.
const weakKey = Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]).toString('base64');
const enrollWith = (ctx, identity, { password = serverPassword, patch = {} } = {}) => {
  const body = JSON.parse(enrollmentBody(ctx.config.serverId, ctx.config.namespace, ctx.origin, identity.id, identity.signingPublicKey, identity.publicKey, 'Raw'));
  Object.entries(patch).forEach(([i, v]) => { body[i] = v; });
  const text = JSON.stringify(body);
  return http(ctx, 'POST', '/v1/devices', { body: JSON.stringify({ username: 'testuser', password, enrollment: [body, sign(null, Buffer.from(text), identity.signingKey).toString('base64')] }) });
};
it('rejects a weak signing key and a mismatching device id with 400 before the password is checked', async () => {
  const ctx = await setup({ limits: { login: 100, session: 100, challenge: 100 } });
  // A wrong password would answer 401 if scrypt ran first; 400 proves the structural checks come first and leak nothing.
  expect((await enrollWith(ctx, createDeviceIdentity(), { password: 'wrong-wrong-wrong', patch: { 4: weakKey } })).status).toBe(400);
  expect((await enrollWith(ctx, createDeviceIdentity(), { password: 'wrong-wrong-wrong', patch: { 3: createDeviceIdentity().id } })).status).toBe(400);
  expect((await enrollWith(ctx, createDeviceIdentity(), { password: 'wrong-wrong-wrong' })).status).toBe(401);
}, 30000);
it('keeps failed session attempts out of the password backoff and gives them their own backoff', async () => {
  let now = 1000; const ctx = await setup({ clock: () => now, limits: { login: 100, session: 100, challenge: 100, source: 1000, global: 1000 } }); const stranger = createDeviceIdentity();
  for (let i = 0; i < 10; i++) expect((await sessionRaw(ctx, stranger)).status).toBe(401);
  expect((await enrollRaw(ctx, createDeviceIdentity())).status).toBe(201); // no password backoff and no global failure budget spent
  const blocked = await sessionRaw(ctx, stranger); expect(blocked.status).toBe(429); expect(blocked.headers.get('retry-after')).toBe('1');
  now += 1000; expect((await sessionRaw(ctx, stranger)).status).toBe(401);
}, 30000);
it('spends the nonce before shape, token and length checks', async () => {
  const ctx = await setup(); const a = await signedIn(ctx, 'A'); const identity = a.identity;
  let nonce = await nonceOf(ctx);
  expect((await http(ctx, 'POST', '/v1/session', { body: JSON.stringify({ nonce }) })).status).toBe(400);
  expect((await sessionRaw(ctx, identity, { nonce })).status).toBe(401); // already spent
  nonce = await nonceOf(ctx);
  expect((await http(ctx, 'DELETE', '/v1/devices/' + '9'.repeat(64), { headers: { authorization: 'Bearer nope', 'x-shellherd-nonce': nonce } })).status).toBe(401);
  expect((await sessionRaw(ctx, identity, { nonce })).status).toBe(401);
  nonce = await nonceOf(ctx);
  expect((await http(ctx, 'DELETE', '/v1/devices/' + '9'.repeat(64), { headers: { 'x-shellherd-nonce': nonce, 'content-length': '5' }, body: 'xxxxx' })).status).toBe(401);
  expect((await sessionRaw(ctx, identity, { nonce })).status).toBe(401);
  expect((await sessionRaw(ctx, identity)).status).toBe(200);
});
it('budgets device revocations like other writes', async () => {
  const ctx = await setup({ clock: () => 1000, limits: { login: 100, session: 100, challenge: 100, deviceWrites: 2 } }); const a = await signedIn(ctx, 'A');
  const token = bearer(await sessionRaw(ctx, a.identity)).authorization.slice(7);
  for (let i = 0; i < 2; i++) expect((await revokeRaw(ctx, { signer: a.identity, token, id: '9'.repeat(64) })).status).toBe(404);
  expect((await revokeRaw(ctx, { signer: a.identity, token, id: '9'.repeat(64) })).status).toBe(429);
});

// H3.1: origin binding (C1), base load (S1), startup care (S6), password file (S10).
it('binds enrollment, session and revocation proofs to the server origin (same serverId and namespace on two servers)', async () => {
  const serverId = randomBytes(32).toString('hex');
  const a = await setup({ serverId }); const b = await setup({ serverId });
  expect(a.origin).not.toBe(b.origin); expect((await http(b, 'GET', '/v1/info')).json.origin).toBe(b.origin);
  const d = createDeviceIdentity(); const peer = createDeviceIdentity();
  // An enrollment signed for A's origin is refused by B.
  const foreign = JSON.parse(enrollmentBody(serverId, 'account', a.origin, d.id, d.signingPublicKey, d.publicKey, 'D'));
  const foreignDoc = [foreign, sign(null, Buffer.from(JSON.stringify(foreign)), d.signingKey).toString('base64')];
  expect((await enrollRaw(b, d, { enrollment: foreignDoc })).status).toBe(400);
  await b.client.enroll(d, { username: 'testuser', password: serverPassword, name: 'D', ephemeral: false });
  const second = new AccountStore(b.info); cleanup.push(() => second.close());
  await second.enroll(peer, { username: 'testuser', password: serverPassword, name: 'Peer', ephemeral: false });
  // A session proof over A's origin is a 401 at B; the proof over B's own origin works.
  const nonce = await nonceOf(b);
  const wrong = sign(null, Buffer.from(sessionProof(serverId, 'account', a.origin, nonce, d.id)), d.signingKey).toString('base64');
  expect((await http(b, 'POST', '/v1/session', { body: JSON.stringify({ device: d.id, nonce, signature: wrong }) })).status).toBe(401);
  const session = await sessionRaw(b, d); expect(session.status).toBe(200);
  // Same for a DELETE proof.
  const n2 = await nonceOf(b); const path = '/v1/devices/' + peer.id;
  const bad = sign(null, Buffer.from(requestProofV2(serverId, 'account', a.origin, 'DELETE', path, n2, d.id)), d.signingKey).toString('base64');
  expect((await http(b, 'DELETE', path, { headers: { ...bearer(session), 'x-shellherd-device': d.id, 'x-shellherd-nonce': n2, 'x-shellherd-signature': bad } })).status).toBe(401);
  expect((await revokeRaw(b, { signer: d, token: session.json.token, id: peer.id })).status).toBe(200);
});
it('uses a configured origin instead of the listen origin and the probe refuses a server reporting another origin', async () => {
  const configured = 'https://sync.example.org';
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-origin-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const config = { directory, namespace: 'account', serverId: randomBytes(32).toString('hex'), account, origin: configured, limits: { login: 100, session: 100, challenge: 100 } };
  const server = await createSyncServer(config); cleanup.push(() => server.close()); const url = await server.listen();
  const ctx = { config, info: { serverUrl: url }, origin: new URL(url).origin }; const d = createDeviceIdentity();
  expect((await http(ctx, 'GET', '/v1/info')).json.origin).toBe(configured);
  await expect(probeSyncServer(url, { allowLoopbackHttp: true })).rejects.toThrow(); // reached at 127.0.0.1, reports another origin
  expect((await enrollRaw(ctx, d)).status).toBe(400); // proofs for the listen origin do not verify
  ctx.origin = configured; expect((await enrollRaw(ctx, d)).status).toBe(201);
});
it('rejects malformed origins and unparsable trusted proxy settings at creation', async () => {
  const base = { directory: await mkdtemp(join(tmpdir(), 'shellherd-bad-')), namespace: 'account', serverId: randomBytes(32).toString('hex'), account };
  cleanup.push(() => rm(base.directory, { recursive: true, force: true }));
  for (const origin of ['https://sync.example.org/', 'https://Sync.example.org', 'https://sync.example.org:443', 'sync.example.org']) await expect(createSyncServer({ ...base, origin })).rejects.toMatchObject({ status: 400 });
  await expect(createSyncServer({ ...base, trustedProxy: true })).rejects.toMatchObject({ status: 400 });
  await expect(createSyncServer({ ...base, trustedProxy: '1' })).rejects.toMatchObject({ hint: expect.stringContaining('SHELLHERD_SERVER_TRUSTED_PROXY') });
});
const rawSlow = (port, source, length = 4000) => new Promise(resolve => {
  const socket = connect(port, '127.0.0.1'); const started = Date.now(); let seen = '';
  socket.on('data', chunk => { seen += chunk.toString('latin1'); }); socket.on('error', () => {});
  socket.on('close', () => resolve({ ms: Date.now() - started, seen }));
  socket.write(`POST /v1/session HTTP/1.1\r\nHost: x\r\nx-forwarded-for: ${source}\r\ncontent-type: application/json\r\ncontent-length: ${length}\r\n\r\n{`);
});
it('closes a slow pre-auth body after the read deadline while another source is served', async () => {
  const ctx = await setup({ trustedProxy: '127.0.0.1' }); const port = Number(new URL(ctx.info.serverUrl).port);
  const slow = rawSlow(port, '198.51.100.1');
  await new Promise(resolve => setTimeout(resolve, 300));
  expect((await http(ctx, 'GET', '/v1/info', { headers: { 'x-forwarded-for': '198.51.100.2' } })).status).toBe(200);
  const result = await slow; expect(result.ms).toBeGreaterThanOrEqual(2500); expect(result.ms).toBeLessThan(4500);
}, 15000);
it('answers 429 with retry-after to the fifth concurrent request of one source', async () => {
  const ctx = await setup({ trustedProxy: '127.0.0.1' }); const port = Number(new URL(ctx.info.serverUrl).port);
  const slow = Array.from({ length: 4 }, () => rawSlow(port, '198.51.100.9'));
  await new Promise(resolve => setTimeout(resolve, 300));
  const fifth = await http(ctx, 'GET', '/v1/info', { headers: { 'x-forwarded-for': '198.51.100.9' } });
  expect(fifth.status).toBe(429); expect(fifth.headers.get('retry-after')).toBe('1');
  expect((await http(ctx, 'GET', '/v1/info', { headers: { 'x-forwarded-for': '198.51.100.10' } })).status).toBe(200);
  await Promise.all(slow);
  expect((await http(ctx, 'GET', '/v1/info', { headers: { 'x-forwarded-for': '198.51.100.9' } })).status).toBe(200); // the counter was released
}, 15000);
it('deletes the generated password file after the first successful enrollment only', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'shellherd-pw-')); cleanup.push(() => rm(dir, { recursive: true, force: true }));
  const initialPasswordFile = join(dir, 'initial-password.txt'); await writeFile(initialPasswordFile, 'x', { mode: 0o600 });
  const ctx = await setup({ initialPasswordFile }); const d = createDeviceIdentity();
  await expect(ctx.client.enroll(d, { username: 'testuser', password: 'wrong', name: 'D', ephemeral: false })).rejects.toMatchObject({ status: 401 });
  await expect(stat(initialPasswordFile)).resolves.toBeDefined();
  await ctx.client.enroll(d, { username: 'testuser', password: serverPassword, name: 'D', ephemeral: false });
  await expect(stat(initialPasswordFile)).rejects.toMatchObject({ code: 'ENOENT' });
  await ctx.client.enroll(d, { username: 'testuser', password: serverPassword, name: 'D', ephemeral: false }); // idempotent 200, file already gone
});
it('removes stale temp files at start, keeps fresh ones, and skips unreadable objects without leaking content', async () => {
  const hex = () => randomBytes(16).toString('hex'); const old = hex() + '.tmp'; const oldRoster = hex() + '.devices-tmp'; const fresh = hex() + '.access-tmp'; const odd = hex() + '.part';
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  const badWire = JSON.stringify({ secret: 'SYNTHETIC_UNREADABLE_CONTENT' }); const badName = 'e'.repeat(64) + '.blob';
  const ctx = await setup({ prepare: async directory => {
    for (const name of [old, oldRoster, fresh]) await writeFile(join(directory, name), 'x', { mode: 0o600 });
    const past = new Date(Date.now() - 2 * 3600_000); await utimes(join(directory, old), past, past); await utimes(join(directory, oldRoster), past, past);
    await writeFile(join(directory, badName), badWire, { mode: 0o600 });
  } });
  const files = await readdir(ctx.directory);
  expect(files).not.toContain(old); expect(files).not.toContain(oldRoster); expect(files).toContain(fresh); void odd;
  expect(errors.mock.calls.flat().join('\n')).toContain('Skipping unreadable object ' + badName); expect(errors.mock.calls.flat().join('\n')).not.toContain('SYNTHETIC_UNREADABLE_CONTENT');
  const { store } = await signedIn(ctx); expect(await store.list()).toEqual([]); // not counted, not listed
  expect(await store.remove('e'.repeat(64))).toBe(true); expect(await readdir(ctx.directory)).not.toContain(badName); // quarantined file can be removed
  errors.mockRestore();
});
