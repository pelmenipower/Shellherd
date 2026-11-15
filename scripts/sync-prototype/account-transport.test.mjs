import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash, verify } from 'node:crypto';
import { AccountStore } from './account-transport.mjs';
import { probeSyncServer } from './http-common.mjs';
import { createDeviceIdentity, enrollmentBody, sessionProof, requestProofV3 } from './device-proof.mjs';

const origin = 'http://127.0.0.1:4000'; const serverId = 'a'.repeat(64); const namespace = 'ns_1'; const nonce = 'b'.repeat(64); const token = 'c'.repeat(64);
const info = (extra = {}) => ({ serverUrl: 'http://127.0.0.1:4000/', serverId, namespace, authentication: 'enrolled-device', deviceSessions: true, ...extra });
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const identity = createDeviceIdentity();
const calls = [];
const route = handler => vi.stubGlobal('fetch', vi.fn(async (url, options) => { const call = { url: new URL(url), options, body: options.body === undefined ? undefined : options.body }; calls.push(call); return handler(call); }));
afterEach(() => { vi.unstubAllGlobals(); calls.length = 0; });

const legacy = JSON.stringify({ format: 'terminus-encrypted-vault', version: 1, kdf: { algorithm: 'argon2id', salt: Buffer.alloc(16, 3).toString('base64'), memoryKiB: 65536, iterations: 3, parallelism: 1 }, cipher: { algorithm: 'aes-256-gcm', nonce: Buffer.alloc(12, 1).toString('base64'), authTag: Buffer.alloc(16, 2).toString('base64') }, payload: Buffer.from('x').toString('base64') });
const sha = wire => createHash('sha256').update(wire).digest('hex');
const syncWire = JSON.stringify({ format: 'shellherd-sync-object', version: 2, kind: 'version', epoch: 1, cipher: { algorithm: 'aes-256-gcm', nonce: Buffer.alloc(12, 1).toString('base64'), authTag: Buffer.alloc(16, 2).toString('base64') }, payload: Buffer.from('x').toString('base64') });
const EMPTY_SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const entry = (n, extra = {}) => ({ id: n.toString(16).padStart(64, '0'), name: `d${n}`, signingKey: createDeviceIdentity().signingPublicKey, enrolledAt: n, enrolledBy: null, revokedAt: null, ephemeral: false, self: false, ...extra });

describe('AccountStore constructor', () => {
  it('rejects password authentication and a missing deviceSessions flag', () => {
    expect(() => new AccountStore(info({ authentication: 'password' }))).toThrow();
    expect(() => new AccountStore(info({ deviceSessions: false }))).toThrow();
    expect(() => new AccountStore(info({ deviceSessions: undefined }))).toThrow();
    expect(() => new AccountStore(info())).not.toThrow();
  });
});

describe('enroll', () => {
  it('posts exactly four keys with a verifiable signed enrollment and sets no token', async () => {
    route(() => json({ device: { id: identity.id, name: 'Laptop', enrolledAt: 5, ephemeral: true } }));
    const store = new AccountStore(info());
    const result = await store.enroll(identity, { username: 'demo', password: 'pw', name: 'Laptop', ephemeral: true });
    expect(result).toEqual({ id: identity.id, name: 'Laptop', enrolledAt: 5, ephemeral: true });
    const sent = JSON.parse(calls[0].body);
    expect(Object.keys(sent).sort()).toEqual(['enrollment', 'ephemeral', 'password', 'username']);
    expect(calls[0].url.pathname).toBe('/v1/devices'); expect(calls[0].options.method).toBe('POST');
    const body = enrollmentBody(serverId, namespace, origin, identity.id, identity.signingPublicKey, identity.publicKey, 'Laptop');
    expect(sent.enrollment[0]).toEqual(JSON.parse(body));
    expect(verify(null, Buffer.from(body), identity.signingKey, Buffer.from(sent.enrollment[1], 'base64'))).toBe(true);
    await expect(store.list()).rejects.toThrow();
  });
  it('refuses a name that breaks the device name rule before sending anything', async () => {
    route(() => json({}));
    await expect(new AccountStore(info()).enroll(identity, { username: 'demo', password: 'pw', name: '3f9a 12c4', ephemeral: false })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
  it('signs the origin of the server URL, not a trailing slash form', async () => {
    route(() => json({ device: { id: identity.id, name: 'Laptop', enrolledAt: 5, ephemeral: false } }));
    await new AccountStore(info()).enroll(identity, { username: 'demo', password: 'pw', name: 'Laptop', ephemeral: false });
    expect(JSON.parse(calls[0].body).enrollment[0][3]).toBe('http://127.0.0.1:4000');
  });
  it('throws when the answer names a different device', async () => {
    route(() => json({ device: { id: 'd'.repeat(64), name: 'Laptop', enrolledAt: 5, ephemeral: false } }));
    await expect(new AccountStore(info()).enroll(identity, { username: 'demo', password: 'pw', name: 'Laptop', ephemeral: false })).rejects.toThrow();
  });
});

describe('openSession', () => {
  const session = device => route(call => call.url.pathname === '/v1/challenge' ? json({ nonce }) : json({ token, expiresAt: 99, device }));
  it('signs the challenge and replaces an existing token', async () => {
    session(identity.id);
    const store = new AccountStore(info());
    expect(await store.openSession(identity)).toEqual({ signedIn: true, expiresAt: 99, device: identity.id });
    const post = calls.find(c => c.url.pathname === '/v1/session'); const sent = JSON.parse(post.body);
    expect(sent.device).toBe(identity.id); expect(sent.nonce).toBe(nonce);
    expect(verify(null, Buffer.from(sessionProof(serverId, namespace, origin, nonce, identity.id)), identity.signingKey, Buffer.from(sent.signature, 'base64'))).toBe(true);
    route(call => call.url.pathname === '/v1/challenge' ? json({ nonce }) : json({ token: 'e'.repeat(64), expiresAt: 100, device: identity.id }));
    await store.openSession(identity); calls.length = 0; route(() => json({ objects: [] }));
    await store.list(); expect(calls[0].options.headers.authorization).toBe(`Bearer ${'e'.repeat(64)}`);
  });
  it('throws on a foreign device in the answer', async () => {
    session('f'.repeat(64));
    await expect(new AccountStore(info()).openSession(identity)).rejects.toThrow();
  });
});

describe('revoke', () => {
  it('sends three headers plus authorization and signs the exact path', async () => {
    route(call => call.url.pathname === '/v1/challenge' ? json({ nonce }) : call.url.pathname === '/v1/session' ? json({ token, expiresAt: 99, device: identity.id }) : json({ revoked: true }));
    const store = new AccountStore(info()); await store.openSession(identity);
    const id = '9'.repeat(64);
    expect(await store.revoke(identity, id)).toEqual({ revoked: true });
    const call = calls.at(-1); const h = call.options.headers;
    expect(call.options.method).toBe('DELETE'); expect(call.url.pathname).toBe(`/v1/devices/${id}`);
    expect(h['x-shellherd-device']).toBe(identity.id); expect(h['x-shellherd-nonce']).toBe(nonce); expect(h.authorization).toBe(`Bearer ${token}`);
    expect(verify(null, Buffer.from(requestProofV3(serverId, namespace, origin, 'DELETE', `/v1/devices/${id}`, nonce, identity.id, EMPTY_SHA)), identity.signingKey, Buffer.from(h['x-shellherd-signature'], 'base64'))).toBe(true);
    await expect(store.revoke(identity, 'xyz')).rejects.toThrow();
  });
});

describe('devices', () => {
  const open = async list => {
    route(call => call.url.pathname === '/v1/challenge' ? json({ nonce }) : call.url.pathname === '/v1/session' ? json({ token, expiresAt: 99, device: identity.id }) : json({ devices: list }));
    const store = new AccountStore(info()); await store.openSession(identity); return store;
  };
  it('keeps enrolledBy (null or hex64) and drops self', async () => {
    const list = [entry(1, { enrolledBy: 'a'.repeat(64) }), entry(2)];
    expect((await (await open(list)).devices()).map(d => d.enrolledBy)).toEqual(['a'.repeat(64), null]);
  });
  it('returns the entries without self', async () => {
    const list = [entry(1), entry(2, { revokedAt: 9, self: true })];
    const result = await (await open(list)).devices();
    expect(result).toEqual(list.map(({ self, ...rest }) => rest));
  });
  it('rejects 65 entries, duplicate ids, weak keys and extra fields', async () => {
    await expect((await open(Array.from({ length: 65 }, (_, i) => entry(i + 1)))).devices()).rejects.toThrow();
    await expect((await open([entry(1), entry(1)])).devices()).rejects.toThrow();
    await expect((await open([entry(1, { signingKey: Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]).toString('base64') })])).devices()).rejects.toThrow();
    await expect((await open([entry(1, { extra: 1 })])).devices()).rejects.toThrow();
    const { enrolledBy, ...without } = entry(1);
    await expect((await open([without])).devices()).rejects.toThrow();
    await expect((await open([entry(1, { enrolledBy: 'XY' })])).devices()).rejects.toThrow();
    await expect((await open([entry(1, { name: 'a\nb' })])).devices()).rejects.toThrow();
    await expect((await open([entry(1, { name: '3f9a12c4' })])).devices()).rejects.toThrow();
  });
});

describe('objects', () => {
  const open = async () => {
    route(call => call.url.pathname === '/v1/challenge' ? json({ nonce }) : call.url.pathname === '/v1/session' ? json({ token, expiresAt: 99, device: identity.id }) : json({}));
    const store = new AccountStore(info()); await store.openSession(identity); return store;
  };
  it('get accepts sync objects and the legacy format, rejects anything else', async () => {
    const store = await open();
    for (const wire of [syncWire, legacy]) { route(() => json({ id: sha(wire), wire })); expect(await store.get(sha(wire))).toBe(wire); }
    route(() => json({ id: sha('{}'), wire: '{}' }));
    await expect(store.get(sha('{}'))).rejects.toThrow();
  });
  it('put accepts sync objects and rejects the legacy format', async () => {
    const store = await open();
    route(() => json({ id: sha(syncWire) }));
    expect(await store.put(syncWire)).toBe(sha(syncWire));
    await expect(store.put(legacy)).rejects.toThrow();
  });
});

describe('request timeouts', () => {
  const open = async () => {
    route(call => call.url.pathname === '/v1/challenge' ? json({ nonce }) : call.url.pathname === '/v1/session' ? json({ token, expiresAt: 99, device: identity.id }) : json({}));
    const store = new AccountStore(info()); await store.openSession(identity); return store;
  };
  it('scales the put timeout with the body (5 s plus 1 s per 64 KiB) and gives get 21 s', async () => {
    const store = await open(); const timeout = vi.spyOn(AbortSignal, 'timeout');
    route(() => json({ id: sha(syncWire) })); await store.put(syncWire); expect(timeout).toHaveBeenLastCalledWith(6000);
    const big = JSON.stringify({ ...JSON.parse(syncWire), payload: Buffer.alloc(700_000).toString('base64') });
    route(() => json({ id: sha(big) })); await store.put(big); expect(timeout).toHaveBeenLastCalledWith(20_000);
    route(() => json({ id: sha(syncWire), wire: syncWire })); await store.get(sha(syncWire)); expect(timeout).toHaveBeenLastCalledWith(21_000);
    route(() => json({ objects: [] })); await store.list(); expect(timeout).toHaveBeenLastCalledWith(5000);
  });
});

const signedIn = async () => {
  route(call => call.url.pathname === '/v1/challenge' ? json({ nonce }) : call.url.pathname === '/v1/session' ? json({ token, expiresAt: 99, device: identity.id }) : json({ expiresAt: 777 }));
  const store = new AccountStore(info()); await store.openSession(identity); calls.length = 0; return store;
};

describe('enrollWithInvite', () => {
  const secret = '7'.repeat(64);
  const answer = (extra = {}) => json({ device: { id: identity.id, name: 'Laptop', enrolledAt: 5, ephemeral: false }, username: 'demo', ...extra });
  it('posts exactly enrollment, invite and ephemeral with a verifiable enrollment', async () => {
    route(() => answer());
    const result = await new AccountStore(info()).enrollWithInvite(identity, { secret, name: 'Laptop', ephemeral: false });
    expect(result).toEqual({ id: identity.id, name: 'Laptop', enrolledAt: 5, ephemeral: false, username: 'demo' });
    const sent = JSON.parse(calls[0].body);
    expect(Object.keys(sent)).toEqual(['enrollment', 'invite', 'ephemeral']); expect(sent.invite).toBe(secret);
    const body = enrollmentBody(serverId, namespace, origin, identity.id, identity.signingPublicKey, identity.publicKey, 'Laptop');
    expect(verify(null, Buffer.from(body), identity.signingKey, Buffer.from(sent.enrollment[1], 'base64'))).toBe(true);
    expect(calls[0].url.pathname).toBe('/v1/devices');
  });
  it('rejects a bad secret, foreign device, bad name and bad username', async () => {
    route(() => answer());
    await expect(new AccountStore(info()).enrollWithInvite(identity, { secret: 'zz', name: 'Laptop', ephemeral: false })).rejects.toThrow();
    expect(calls).toHaveLength(0);
    for (const extra of [{ username: 'a b' }, { username: 5 }, { username: undefined }, { device: { id: 'd'.repeat(64), name: 'Laptop', enrolledAt: 5, ephemeral: false } }, { device: { id: identity.id, name: '3f9a12c4', enrolledAt: 5, ephemeral: false } }]) {
      route(() => answer(extra));
      await expect(new AccountStore(info()).enrollWithInvite(identity, { secret, name: 'Laptop', ephemeral: false })).rejects.toThrow();
    }
  });
});

describe('invite', () => {
  const secret = '7'.repeat(64); const object = '8'.repeat(64);
  it('signs the body digest with the v4 proof and sends the exact body', async () => {
    const store = await signedIn();
    expect(await store.invite(identity, { secret, object })).toEqual({ expiresAt: 777 });
    const post = calls.at(-1); const h = post.options.headers;
    expect(post.url.pathname).toBe('/v1/invites'); expect(post.options.method).toBe('POST');
    expect(post.body).toBe(JSON.stringify({ secret, object }));
    expect(h.authorization).toBe(`Bearer ${token}`); expect(h['content-type']).toBe('application/json');
    expect(h['x-shellherd-device']).toBe(identity.id); expect(h['x-shellherd-nonce']).toBe(nonce);
    expect(verify(null, Buffer.from(requestProofV3(serverId, namespace, origin, 'POST', '/v1/invites', nonce, identity.id, sha(post.body))), identity.signingKey, Buffer.from(h['x-shellherd-signature'], 'base64'))).toBe(true);
  });
  it('accepts object null', async () => {
    const store = await signedIn(); await store.invite(identity, { secret, object: null });
    expect(calls.at(-1).body).toBe(JSON.stringify({ secret, object: null }));
  });
  it('rejects bad arguments, a missing token and a bad answer', async () => {
    const store = await signedIn();
    await expect(store.invite(identity, { secret: 'x', object })).rejects.toThrow();
    await expect(store.invite(identity, { secret, object: 'x' })).rejects.toThrow();
    await expect(store.invite(identity, { secret, object: undefined })).rejects.toThrow();
    await expect(new AccountStore(info()).invite(identity, { secret, object })).rejects.toThrow();
    route(call => call.url.pathname === '/v1/challenge' ? json({ nonce }) : json({ expiresAt: 'x' }));
    await expect(store.invite(identity, { secret, object })).rejects.toThrow();
  });
});

describe('probeSyncServer', () => {
  const base = { service: 'shellherd-sync-prototype', protocol: 1, serverId, namespace, maxObjectBytes: 1048576, origin };
  const probe = extra => { route(() => json({ ...base, ...extra })); return probeSyncServer(origin + '/', { allowLoopbackHttp: true }); };
  it('reports the H4 fields and does not throw when they are missing', async () => {
    expect(await probe({ invites: true, objectEpochs: true, enrollment: 'invite-only' })).toMatchObject({ invites: true, objectEpochs: true, enrollment: 'invite-only' });
    expect(await probe({})).toMatchObject({ invites: false, objectEpochs: false, enrollment: 'password' });
    expect(await probe({ invites: 'yes', enrollment: 'x' })).toMatchObject({ invites: false, enrollment: 'password' });
  });
});
