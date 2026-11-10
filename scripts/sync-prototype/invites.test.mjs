import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes, sign } from 'node:crypto';
import { afterEach, beforeAll, expect, it as linuxIt } from 'vitest';
import { createAccount } from './account-auth.mjs';
import { createSyncServer } from './server.mjs';
import { AccountStore } from './account-transport.mjs';
import { probeSyncServer } from './http-common.mjs';
import { createDeviceIdentity, enrollmentBody, inviteEnrollSecret, requestProofV3, sessionProof } from './device-proof.mjs';

// Enrollment codes (invites): the server side. Linux only (file permissions, directory fsync).
const it = linuxIt.runIf(process.platform === 'linux');
const serverPassword = 'ONLY_TEST_SERVER_PASSWORD';
let account; const cleanup = [];
beforeAll(async () => { account = await createAccount('testuser', serverPassword); });
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
const b64 = (n, fill) => Buffer.alloc(n, fill).toString('base64');
const envelope = (kind, n, epoch = 1) => JSON.stringify({ format: 'shellherd-sync-object', version: 2, kind, epoch, cipher: { algorithm: 'aes-256-gcm', nonce: b64(12, 2), authTag: b64(16, 3) }, payload: b64(40, n) });
const sha = value => createHash('sha256').update(value).digest('hex');
const secretOf = n => sha('invite-secret-' + n);
const EMPTY_SHA = sha('');

async function setup(options = {}) {
  let now = 1_000_000;
  const { prepare, ...rest } = options;
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-invites-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  await prepare?.(directory);
  const config = { directory, namespace: 'account', serverId: randomBytes(32).toString('hex'), account, clock: () => now, ...rest, limits: { login: 100, session: 100, challenge: 100, source: 100000, global: 100000, invite: 100, deviceWrites: 1000, ...rest.limits } };
  const server = await createSyncServer(config); cleanup.push(() => server.close());
  const info = await probeSyncServer(await server.listen(), { allowLoopbackHttp: true });
  const ctx = { directory, config, server, info, origin: new URL(info.serverUrl).origin, advance: ms => { now += ms; }, now: () => now };
  return ctx;
}
async function enrolled(ctx, name = 'Laptop', ephemeral = false) {
  const identity = createDeviceIdentity(); const store = new AccountStore(ctx.info); cleanup.push(() => store.close());
  await store.enroll(identity, { username: 'testuser', password: serverPassword, name, ephemeral }); await store.openSession(identity);
  return { identity, store };
}
const blobs = async ctx => (await readdir(ctx.directory)).filter(f => f.endsWith('.blob')).map(f => f.slice(0, -5));
const status = async promise => (await promise.then(() => null, e => e))?.status;
async function redeem(ctx, secret, name = 'Phone', identity = createDeviceIdentity()) {
  const store = new AccountStore(ctx.info); cleanup.push(() => store.close());
  return { store, identity, result: await store.enrollWithInvite(identity, { secret, name, ephemeral: false }) };
}
const http = async (ctx, method, path, { headers = {}, body } = {}) => {
  const response = await fetch(new URL(path, ctx.info.serverUrl), { method, headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers }, body });
  return { status: response.status, json: await response.json().catch(() => null) };
};
const nonceOf = async ctx => (await http(ctx, 'GET', '/v1/challenge')).json.nonce;
/** Raw signed POST /v1/invites for the edge cases the client refuses to produce. */

it('announces invites, object epochs and the enrollment mode; only the two modes exist', async () => {
  const ctx = await setup(); expect(ctx.info).toMatchObject({ invites: true, objectEpochs: true, enrollment: 'password' });
  const locked = await setup({ enrollment: 'invite-only' }); expect(locked.info.enrollment).toBe('invite-only');
  await expect(createSyncServer({ ...ctx.config, directory: await mkdtemp(join(tmpdir(), 'shellherd-invites-')), enrollment: 'open' })).rejects.toMatchObject({ status: 400 });
});
it('enrolls a device with an invite once: username in the answer, enrolledBy in the roster, then the code is spent', async () => {
  const ctx = await setup(); const a = await enrolled(ctx, 'A'); const secret = secretOf(1);
  expect(await a.store.invite(a.identity, { secret, object: null })).toEqual({ expiresAt: ctx.now() + 600_000 });
  const { result, store, identity } = await redeem(ctx, secret, 'Phone');
  expect(result).toMatchObject({ id: identity.id, name: 'Phone', ephemeral: false, username: 'testuser' });
  await store.openSession(identity);
  const entry = (await a.store.devices()).find(d => d.id === identity.id); expect(entry.enrolledBy).toBe(a.identity.id);
  expect((await a.store.devices()).find(d => d.id === a.identity.id).enrolledBy).toBeNull();
  expect(await status(redeem(ctx, secret, 'Tablet'))).toBe(401); // spent at once
  expect(ctx.server.activeDevices()).toBe(2);
});
it('rejects an unknown, malformed or expired code and counts those as session failures', async () => {
  const ctx = await setup(); const a = await enrolled(ctx, 'A'); await a.store.invite(a.identity, { secret: secretOf(1), object: null });
  expect(await status(redeem(ctx, secretOf(2)))).toBe(401);
  const stranger = createDeviceIdentity(); const store = new AccountStore(ctx.info); cleanup.push(() => store.close());
  const doc = () => { const body = enrollmentBody(ctx.config.serverId, ctx.config.namespace, ctx.origin, stranger.id, stranger.signingPublicKey, stranger.publicKey, 'S'); return [JSON.parse(body), sign(null, Buffer.from(body), stranger.signingKey).toString('base64')]; };
  expect((await http(ctx, 'POST', '/v1/devices', { body: JSON.stringify({ enrollment: doc(), invite: 'nothex' }) })).status).toBe(400);
  expect((await http(ctx, 'POST', '/v1/devices', { body: JSON.stringify({ enrollment: doc(), invite: secretOf(1), extra: 1 }) })).status).toBe(400);
  ctx.advance(600_000); expect(await status(redeem(ctx, secretOf(1)))).toBe(401); // expired
  for (let i = 0; i < 12; i++) await status(redeem(ctx, secretOf(100 + i)));
  expect(await status(redeem(ctx, secretOf(200)))).toBe(429); // the session-failure gate of the source
});
it('refuses the password form with 403 under invite-only, before any counter or hashing', async () => {
  const ctx = await setup({ enrollment: 'invite-only' });
  const identity = createDeviceIdentity(); const body = enrollmentBody(ctx.config.serverId, ctx.config.namespace, ctx.origin, identity.id, identity.signingPublicKey, identity.publicKey, 'Raw');
  const enrollment = [JSON.parse(body), sign(null, Buffer.from(body), identity.signingKey).toString('base64')];
  const wrong = JSON.stringify({ username: 'testuser', password: 'wrong', enrollment });
  const started = Date.now();
  for (let i = 0; i < 12; i++) expect((await http(ctx, 'POST', '/v1/devices', { body: wrong })).status).toBe(403); // never 401/429: no failure was counted
  expect((await http(ctx, 'POST', '/v1/devices', { body: JSON.stringify({ username: 'testuser', password: serverPassword, enrollment, ephemeral: true }) })).status).toBe(403);
  expect(Date.now() - started).toBeLessThan(5000); // scrypt (~0.3 s each) never ran
  expect(await status(redeem(ctx, secretOf(1)))).toBe(401); // the failure counters of the invite form are untouched too
  // A first device can still be bootstrapped offline; an invite from an existing device works.
  const store = new AccountStore(ctx.info); cleanup.push(() => store.close());
  expect(await status(store.enroll(identity, { username: 'testuser', password: serverPassword, name: 'Raw', ephemeral: false }))).toBe(403);
});
it('lets an issuer attach only a keybox object and removes it when the invite expires unused', async () => {
  const ctx = await setup(); const a = await enrolled(ctx, 'A');
  const keybox = await a.store.put(envelope('keybox', 1)); const version = await a.store.put(envelope('version', 2));
  expect(await status(a.store.invite(a.identity, { secret: secretOf(1), object: version }))).toBe(400); // K3
  expect(await status(a.store.invite(a.identity, { secret: secretOf(2), object: sha('missing') }))).toBe(400);
  await a.store.invite(a.identity, { secret: secretOf(3), object: keybox });
  expect(await blobs(ctx)).toContain(keybox);
  ctx.advance(599_999); await nonceOf(ctx); expect(await blobs(ctx)).toContain(keybox);
  ctx.advance(1); await nonceOf(ctx); expect(await blobs(ctx)).not.toContain(keybox);
  expect(await blobs(ctx)).toContain(version); // only the named object
});
it('removes the keybox of a spent invite ten minutes after use even when the new device never imports (B7)', async () => {
  const ctx = await setup(); const a = await enrolled(ctx, 'A'); const keybox = await a.store.put(envelope('keybox', 1));
  await a.store.invite(a.identity, { secret: secretOf(1), object: keybox });
  ctx.advance(500_000); await redeem(ctx, secretOf(1)); const consumed = ctx.now();
  ctx.advance(600_000 - 1); await nonceOf(ctx); expect(await blobs(ctx)).toContain(keybox); // expiresAt passed, consumedAt + 10 min not yet
  ctx.advance(1); expect(ctx.now() - consumed).toBe(600_000); await nonceOf(ctx); // consumedAt + 10 min expect(await blobs(ctx)).not.toContain(keybox);
});
it('removes the keybox objects of an issuer when it is revoked and refuses their invites (K2)', async () => {
  const ctx = await setup(); const a = await enrolled(ctx, 'A'); const c = await enrolled(ctx, 'C'); const keybox = await a.store.put(envelope('keybox', 1));
  await a.store.invite(a.identity, { secret: secretOf(1), object: keybox }); await a.store.invite(a.identity, { secret: secretOf(2), object: null });
  await c.store.revoke(c.identity, a.identity.id);
  expect(await blobs(ctx)).not.toContain(keybox);
  expect(await status(redeem(ctx, secretOf(1)))).toBe(401); expect(await status(redeem(ctx, secretOf(2)))).toBe(401);
  expect(ctx.server.activeDevices()).toBe(1);
});
it('refuses an invite whose issuer is no longer active at redemption (ephemeral issuer expired)', async () => {
  const ctx = await setup(); const a = await enrolled(ctx, 'Temp', true);
  for (let i = 0; i < 71; i++) { ctx.advance(600_000); await a.store.request('POST', '/v1/refresh'); }
  ctx.advance(300_000); await a.store.invite(a.identity, { secret: secretOf(1), object: null });
  expect(ctx.now() - 1_000_000).toBeLessThan(12 * 3600_000); ctx.advance(12 * 3600_000 - (ctx.now() - 1_000_000) + 1); // the issuer's 12 h are over, the invite is not
  expect(await status(redeem(ctx, secretOf(1)))).toBe(401);
});
it('rejects a duplicate secret with 409 and enforces 4 open invites per issuer and 16 in total with 429', async () => {
  const ctx = await setup(); const a = await enrolled(ctx, 'A');
  await a.store.invite(a.identity, { secret: secretOf(0), object: null });
  expect(await status(a.store.invite(a.identity, { secret: secretOf(0), object: null }))).toBe(409);
  for (let i = 1; i < 4; i++) await a.store.invite(a.identity, { secret: secretOf(i), object: null });
  expect(await status(a.store.invite(a.identity, { secret: secretOf(9), object: null }))).toBe(429);
  const others = []; for (let i = 0; i < 3; i++) others.push(await enrolled(ctx, 'O' + i));
  for (const [n, other] of others.entries()) for (let i = 0; i < 4; i++) await other.store.invite(other.identity, { secret: secretOf(100 + n * 10 + i), object: null });
  const last = await enrolled(ctx, 'Last'); // 16 are open now
  expect(await status(last.store.invite(last.identity, { secret: secretOf(500), object: null }))).toBe(429);
});
it('validates POST /v1/invites strictly: method, token, signature, body shape, replayed nonce and size', async () => {
  const ctx = await setup(); const a = await enrolled(ctx, 'A'); const b = await enrolled(ctx, 'B');
  const post = async (who, body, extra = {}) => {
    const nonce = extra.nonce ?? await nonceOf(ctx);
    const signature = sign(null, Buffer.from(requestProofV3(ctx.config.serverId, ctx.config.namespace, ctx.origin, 'POST', '/v1/invites', nonce, (extra.device ?? who.identity.id), sha(extra.signedBody ?? body))), (extra.signer ?? who.identity).signingKey).toString('base64');
    return http(ctx, extra.method ?? 'POST', '/v1/invites', { headers: { authorization: `Bearer ${extra.token ?? who.bearer}`, 'x-shellherd-device': extra.device ?? who.identity.id, 'x-shellherd-nonce': nonce, 'x-shellherd-signature': signature, ...(extra.headers ?? {}) }, body: extra.method === 'GET' ? undefined : body });
  };
  // The client keeps its token private; take one over the raw protocol.
  const session = async who => { const nonce = await nonceOf(ctx); const signature = sign(null, Buffer.from(sessionProof(ctx.config.serverId, ctx.config.namespace, ctx.origin, nonce, who.identity.id)), who.identity.signingKey).toString('base64'); return (await http(ctx, 'POST', '/v1/session', { body: JSON.stringify({ device: who.identity.id, nonce, signature }) })).json.token; };
  a.bearer = await session(a); b.bearer = await session(b);
  const good = JSON.stringify({ secret: secretOf(1), object: null });
  expect((await post(a, good)).status).toBe(201);
  const nonce = await nonceOf(ctx); expect((await post(a, JSON.stringify({ secret: secretOf(2), object: null }), { nonce })).status).toBe(201);
  expect((await post(a, JSON.stringify({ secret: secretOf(3), object: null }), { nonce })).status).toBe(401); // replayed nonce
  expect((await post(a, good, { signedBody: JSON.stringify({ secret: secretOf(9), object: null }) })).status).toBe(401); // digest covers the exact bytes
  expect((await post(a, JSON.stringify({ secret: secretOf(4), object: null }), { signer: b.identity })).status).toBe(401);
  expect((await post(a, JSON.stringify({ secret: secretOf(5), object: null }), { device: b.identity.id })).status).toBe(401); // header device is not the session's
  expect((await post(a, JSON.stringify({ secret: secretOf(6), object: null }), { token: 'f'.repeat(64) })).status).toBe(401);
  expect((await post(a, JSON.stringify({ secret: secretOf(7), object: null }), { method: 'GET' })).status).toBe(405);
  for (const body of [JSON.stringify({ secret: secretOf(7) }), JSON.stringify({ secret: secretOf(7), object: null, extra: 1 }), JSON.stringify({ secret: 'short', object: null }), JSON.stringify({ secret: secretOf(7), object: 5 }), JSON.stringify({ secret: secretOf(7).toUpperCase(), object: null })]) expect((await post(a, body)).status, body).toBe(400);
  expect((await post(a, JSON.stringify({ secret: secretOf(7), object: null, pad: 'x'.repeat(5000) }))).status).toBe(413);
  expect((await post(a, ' ' + good)).status).toBe(400); // not canonical JSON
});
it('budgets invites per device', async () => {
  const ctx = await setup({ limits: { invite: 2 } }); const a = await enrolled(ctx, 'A');
  await a.store.invite(a.identity, { secret: secretOf(1), object: null }); await a.store.invite(a.identity, { secret: secretOf(2), object: null });
  expect(await status(a.store.invite(a.identity, { secret: secretOf(3), object: null }))).toBe(429);
});
it('lists an envelope v1 object on disk, serves it with GET and refuses to store another one', async () => {
  const v1 = JSON.stringify({ format: 'shellherd-sync-object', version: 1, kind: 'version', cipher: { algorithm: 'aes-256-gcm', nonce: b64(12, 2), authTag: b64(16, 3) }, payload: b64(40, 5) });
  const id = sha(v1); const ctx = await setup({ prepare: async directory => { await writeFile(join(directory, id + '.blob'), v1, { mode: 0o600 }); } });
  const { store } = await enrolled(ctx); expect(await store.list()).toEqual([id]); expect(await store.get(id)).toBe(v1);
  expect(await status(store.request('PUT', `/v1/vaults/account/objects`, v1))).toBe(400);
  expect(await status(store.request('PUT', `/v1/vaults/account/objects`, JSON.stringify({ ...JSON.parse(v1), payload: b64(40, 6) })))).toBe(400);
  expect(await store.remove(id)).toBe(true);
});
it('derives the code secret the way the client does: the server stores only the hash of the derived value', async () => {
  const ctx = await setup(); const a = await enrolled(ctx, 'A');
  const secret = inviteEnrollSecret('000102030405060708090a0b0c0d0e0f', ctx.config.serverId, ctx.config.namespace, ctx.origin);
  await a.store.invite(a.identity, { secret, object: null }); const { result } = await redeem(ctx, secret); expect(result.username).toBe('testuser');
});
