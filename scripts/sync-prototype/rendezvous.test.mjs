import { mkdtemp, readFile, readdir, rm, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, expect, it as platformIt, vi } from 'vitest';
import { createAccount } from './account-auth.mjs';
import { createSyncServer } from './server.mjs';
import { AccountStore } from './account-transport.mjs';
import { boundedJson, probeSyncServer } from './http-common.mjs';
import { createRendezvousIdentity, RendezvousPeer } from './rendezvous-client.mjs';
import { registrationProof } from './rendezvous.mjs';
import { createDeviceIdentity } from './device-proof.mjs';
import { readConfig, replaceAccount, startServer } from '../../server/main.mjs';
vi.setConfig({ testTimeout: 20_000 }); // network tests are load-sensitive
const it = platformIt.runIf(process.platform === 'linux');
const password = 'ONLY_TEST_RENDEZVOUS_PASSWORD';
const cleanup = []; let account;
beforeAll(async () => { account = await createAccount('testuser', password); });
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup({ enabled = true } = {}) {
  let now = Date.now();
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-rendezvous-'));
  cleanup.push(() => rm(directory, { force: true, recursive: true }));
  const config = { directory, serverId: randomBytes(32).toString('hex'), namespace: 'test', account, rendezvous: enabled, clock: () => now, limits: { login: 100, session: 100, challenge: 100 } }; // overrides: tests create many peers per minute
  const server = await createSyncServer(config); cleanup.push(() => server.close());
  const url = await server.listen(); const info = await probeSyncServer(url, { allowLoopbackHttp: true });
  async function peer(name) {
    const store = new AccountStore(info); cleanup.push(() => store.close()); const identity = createDeviceIdentity();
    await store.enroll(identity, { username: 'testuser', password, name, ephemeral: false }); await store.openSession(identity);
    const client = new RendezvousPeer(store, identity); await client.register(name); return client;
  }
  return { directory, config, server, url, info, peer, advance: amount => { now += amount; } };
}
async function pair(ctx, scope = 'view') {
  const alice = await ctx.peer('Alice'); const bob = await ctx.peer('Bob');
  const session = await alice.request(bob.identity.id, scope);
  const a = alice.channel(session, bob.identity.id, scope);
  const b = bob.channel(session, alice.identity.id, scope);
  cleanup.push(() => { a.dispose(); b.dispose(); });
  return { alice, bob, session, a, b };
}
// Drives both sides until both channels are ready (K21: direct rounds, no sleeping).
async function handshake(a, b) {
  await b.accept();
  for (let round = 0; round < 6 && !(a.ready && b.ready); round++) { await a.receive(); await b.receive(); }
  expect(a.ready && b.ready).toBe(true);
}
// Raw registration with an explicit identity, so tests can tamper with single fields.
async function rawPut(ctx, peer, identity, { name = 'Raw', mutate = body => body, challenge } = {}) {
  const issued = challenge ?? await peer.store.request('GET', '/v1/rendezvous/challenge');
  const proof = registrationProof({ privateKey: identity.privateKey, peerKey: issued.serverKey, serverId: ctx.info.serverId, challenge: issued.challenge, publicKey: identity.publicKey, name });
  return request(peer, 'PUT', '/v1/rendezvous/devices', mutate({ challenge: issued.challenge, name, proof, publicKey: identity.publicKey }));
}
const request = (peer, method, path, body) => peer.store.request(method, path, body === undefined ? undefined : JSON.stringify(body));
it('requires login, keeps the existing sync probe compatible, and is opt-in', async () => {
  const ctx = await setup();
  const info = await boundedJson(new URL('v1/info', ctx.url)); expect(info.rendezvous).toBe(true);
  await expect(boundedJson(new URL('v1/rendezvous/devices', ctx.url))).rejects.toMatchObject({ status: 401 });
  const disabled = await setup({ enabled: false });
  expect((await boundedJson(new URL('v1/info', disabled.url))).rendezvous).toBe(false);
  const store = new AccountStore(disabled.info); cleanup.push(() => store.close()); const identity = createDeviceIdentity();
  await store.enroll(identity, { username: 'testuser', password, name: 'Alice', ephemeral: false }); await store.openSession(identity);
  await expect(store.request('GET', '/v1/rendezvous/devices')).rejects.toMatchObject({ status: 404 });
});
it('requires target approval and a cryptographically verified consent frame before sending', async () => {

  const ctx = await setup(); const { alice, bob, session, a, b } = await pair(ctx, 'control');
  expect(await alice.devices()).toHaveLength(2); expect(await bob.sessions()).toEqual([session]);
  await expect(a.send('before consent')).rejects.toThrow();
  await expect(request(alice, 'POST', `/v1/rendezvous/sessions/${session.id}/accept`, {})).rejects.toMatchObject({ status: 403 });
  await expect(request(bob, 'POST', `/v1/rendezvous/sessions/${session.id}/accept`, 7)).rejects.toMatchObject({ status: 400 });
  await expect(request(bob, 'POST', `/v1/rendezvous/sessions/${session.id}/accept`, [])).rejects.toMatchObject({ status: 400 });
  await b.accept(); expect(b.ready).toBe(false); expect(a.ready).toBe(false);
  await handshake(a, b);
  await a.send({ type: 'signal', marker: 'NEVER_SERVER_PLAINTEXT' });
  expect(await b.receive()).toEqual([{ type: 'signal', marker: 'NEVER_SERVER_PLAINTEXT' }]);
  expect(await b.receive()).toEqual([]);
  await b.send('reply'); expect(await a.receive()).toEqual(['reply']);
  await a.close(); await expect(b.send('closed')).rejects.toMatchObject({ status: 404 });
  for (const file of await readdir(ctx.directory)) {
    const contents = await readFile(join(ctx.directory, file), 'utf8');
    expect(contents).not.toContain('NEVER_SERVER_PLAINTEXT'); expect(contents).not.toContain(password);
  }
});
it('rejects key substitution, wrong scope and a server-forged approval', async () => {
  const ctx = await setup(); const { alice, bob, session, a } = await pair(ctx);
  const attacker = createRendezvousIdentity();
  expect(() => alice.channel(session, attacker.id, 'view')).toThrow();
  expect(() => alice.channel(session, bob.identity.id, 'control')).toThrow();
  await request(bob, 'POST', `/v1/rendezvous/sessions/${session.id}/accept`, {});
  await expect(a.send('server state is insufficient')).rejects.toThrow();
  await request(bob, 'POST', `/v1/rendezvous/sessions/${session.id}/messages`, { sequence: 1, frame: Buffer.from('forged approval').toString('base64') });
  await expect(a.receive()).rejects.toThrow(); expect(a.ready).toBe(false);
  // A failed verification poisons the channel (K19).
  await expect(a.receive()).rejects.toThrow();
});
it('rejects server replacement of a locally generated request challenge and channel reuse', async () => {
  const ctx = await setup(); const alice = await ctx.peer('Alice'); const bob = await ctx.peer('Bob');
  const original = alice.store.request.bind(alice.store);
  alice.store.request = async (...args) => {
    const result = await original(...args);
    return args[0] === 'POST' && args[1] === '/v1/rendezvous/sessions' ? { ...result, nonce: '0'.repeat(64) } : result;
  };
  await expect(alice.request(bob.identity.id)).rejects.toThrow();
  alice.store.request = original;
  // The tampered request already holds the (alice,bob) pair on the server, so use a third device.
  const carol = await ctx.peer('Carol');
  const session = await alice.request(carol.identity.id);
  const channel = alice.channel(session, carol.identity.id, 'view'); cleanup.push(() => channel.dispose());
  expect(() => alice.channel(session, carol.identity.id, 'view')).toThrow();
});
it('handles a lost handshake reply and data in the same receive batch as consent', async () => {
  const ctx = await setup(); const { bob, a, b } = await pair(ctx);
  const original = bob.store.request.bind(bob.store); let lose = true;
  bob.store.request = async (...args) => {
    const result = await original(...args);
    if (lose && args[1].endsWith('/messages') && args[0] === 'POST' && JSON.parse(args[2]).sequence === 2) { lose = false; throw Error('Lost consent reply'); } return result;
  };
  await b.accept(); await a.receive(); expect(b.ready).toBe(false);
  await expect(b.receive()).rejects.toThrow('Lost consent reply'); expect(b.ready).toBe(false);
  await b.retry(); await b.receive(); expect(b.ready).toBe(true);
  await b.send('data after consent');
  expect(await a.receive()).toEqual(['data after consent']); expect(a.ready).toBe(true);
  await a.send('confirmed'); expect(await b.receive()).toEqual(['confirmed']);
}, 20_000);
it('isolates session participants even when they share the server account', async () => {
  const ctx = await setup(); const { alice, bob, session } = await pair(ctx); const outsider = await ctx.peer('Outsider');
  expect(await outsider.sessions()).toEqual([]);
  for (const suffix of ['', '/messages', '/accept', '/ack']) {
    await expect(request(outsider, suffix === '/accept' || suffix === '/ack' ? 'POST' : 'GET', `/v1/rendezvous/sessions/${session.id}${suffix}`, suffix === '/accept' ? {} : suffix === '/ack' ? { through: 0 } : undefined)).rejects.toMatchObject({ status: 404 });
  }
  // Without Bob's private key the outsider cannot prove ownership of Bob's public key.
  await expect(rawPut(ctx, outsider, createRendezvousIdentity(), { name: 'Bob', mutate: body => ({ ...body, publicKey: bob.identity.publicKey }) })).rejects.toMatchObject({ status: 400 });
  await expect(alice.request(alice.identity.id)).rejects.toMatchObject({ status: 404 });
  await expect(alice.request(randomBytes(32).toString('hex'))).rejects.toMatchObject({ status: 404 });
});
it('expires pending requests and presence, removes sessions on logout and unregister', async () => {
  const ctx = await setup(); const { alice, bob, b } = await pair(ctx);
  ctx.advance(30_000); await alice.register('Alice'); await bob.register('Bob');
  ctx.advance(30_001); expect(await bob.sessions()).toEqual([]);
  await expect(b.accept()).rejects.toMatchObject({ status: 404 });
  await alice.request(bob.identity.id); await bob.store.logout(); expect(await alice.sessions()).toEqual([]);
  expect(await alice.devices()).toHaveLength(1);
  await alice.unregister(); expect(await alice.devices()).toEqual([]);
});
it('enforces a five-minute active session limit even with fresh presence leases', async () => {
  const ctx = await setup(); const { alice, bob, a, b } = await pair(ctx); await handshake(a, b);
  for (let i = 0; i < 10; i++) { ctx.advance(30_000); await alice.register('Alice'); await bob.register('Bob'); }
  expect(await alice.sessions()).toEqual([]);
  await expect(a.send('expired')).rejects.toMatchObject({ status: 404 });
});
it('bounds pending requests, payloads, sequence order and unacknowledged messages', async () => {
  const ctx = await setup(); const { alice, bob, session, a, b } = await pair(ctx);
  // One session per (from,to) pair; the four-per-device cap is exercised with distinct targets.
  await expect(alice.request(bob.identity.id)).rejects.toMatchObject({ status: 429 });
  const others = []; for (let i = 0; i < 4; i++) others.push(await ctx.peer(`Other${i}`));
  for (let i = 0; i < 3; i++) await alice.request(others[i].identity.id);
  await expect(alice.request(others[3].identity.id)).rejects.toMatchObject({ status: 429 });
  await b.accept();
  const path = `/v1/rendezvous/sessions/${session.id}/messages`;
  const frame = sequence => ({ sequence, frame: randomBytes(24).toString('base64') });
  await expect(request(alice, 'POST', path, frame(2))).rejects.toMatchObject({ status: 409 });
  const first = frame(1); await request(alice, 'POST', path, first); await request(alice, 'POST', path, first);
  await expect(request(alice, 'POST', path, frame(1))).rejects.toMatchObject({ status: 409 });
  for (let i = 2; i <= 32; i++) await request(alice, 'POST', path, frame(i));
  await expect(request(alice, 'POST', path, frame(33))).rejects.toMatchObject({ status: 429 });
  await request(bob, 'POST', `/v1/rendezvous/sessions/${session.id}/ack`, { through: 32 });
  await request(alice, 'POST', path, frame(33));
  await expect(request(bob, 'POST', `/v1/rendezvous/sessions/${session.id}/ack`, { through: 34 })).rejects.toMatchObject({ status: 400 });
});
it('recovers lost send and receive acknowledgments without duplicated delivery', async () => {
  const ctx = await setup(); const { alice, bob, a, b } = await pair(ctx); await handshake(a, b);
  const original = alice.store.request.bind(alice.store); let failSend = true;
  alice.store.request = async (...args) => {
    const result = await original(...args);
    if (failSend && args[0] === 'POST' && args[1].endsWith('/messages')) { failSend = false; throw Error('Lost send reply'); }
    return result;
  };
  await expect(a.send('once')).rejects.toThrow('Lost send reply');
  // Receiver consumes and acknowledges before sender retries the lost reply.
  expect(await b.receive()).toEqual(['once']); await a.retry(); expect(await b.receive()).toEqual([]);
  const originalBob = bob.store.request.bind(bob.store); let failAck = true;
  bob.store.request = async (...args) => {
    const result = await originalBob(...args);
    if (failAck && args[1].endsWith('/ack')) { failAck = false; throw Error('Lost ack reply'); } return result;
  };
  await a.send('second'); await expect(b.receive()).rejects.toThrow('Lost ack reply');
  expect(await b.receive()).toEqual(['second']); expect(await b.receive()).toEqual([]);
});
it('does not restore presence, sessions or authentication tokens after a restart', async () => {
  const ctx = await setup(); const { alice, b } = await pair(ctx); await b.accept();
  await ctx.server.close();
  const restarted = await createSyncServer(ctx.config); cleanup.push(() => restarted.close());
  const next = await restarted.listen();
  const info = await probeSyncServer(next, { allowLoopbackHttp: true });
  // Repoint only the endpoint to verify the old token against the restarted server.
  alice.store.info.serverUrl = next;
  await expect(alice.devices()).rejects.toMatchObject({ status: 401 });
  // The enrollment is persistent: the same device signs in again, but presence and tokens are gone.
  const store = new AccountStore(info); cleanup.push(() => store.close());
  await store.openSession(alice.identity); expect(await store.request('GET', '/v1/rendezvous/devices')).toEqual({ devices: [] });
});
it('loads private persisted configuration, rejects unsafe files and starts the standalone server', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-standalone-')); cleanup.push(() => rm(directory, { force: true, recursive: true }));
  const config = { account, serverId: randomBytes(32).toString('hex'), namespace: 'persisted' }; const path = join(directory, 'server.json');
  await writeFile(path, JSON.stringify(config), { mode: 0o600 }); expect(await readConfig(path)).toEqual(config);
  await chmod(path, 0o644); await expect(readConfig(path)).rejects.toThrow(); await chmod(path, 0o600);
  const link = join(directory, 'linked.json'); await symlink(path, link); await expect(readConfig(link)).rejects.toThrow();
  const server = await startServer({ dataDirectory: directory, port: 0 }); cleanup.push(() => server.close());
  const url = `http://127.0.0.1:${server.server.address().port}/`;
  expect((await boundedJson(new URL('v1/info', url))).rendezvous).toBe(true);
  await expect(startServer({ dataDirectory: directory, port: -1 })).rejects.toThrow();
});
it('rotates persisted account credentials without changing the server identity or namespace', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-rotation-')); cleanup.push(() => rm(directory, { force: true, recursive: true }));
  const config = { account, serverId: randomBytes(32).toString('hex'), namespace: 'preserved' };
  await writeFile(join(directory, 'server.json'), JSON.stringify(config), { mode: 0o600 });
  const replacement = await createAccount('replacement-user', 'ONLY_TEST_REPLACEMENT_PASSWORD');
  await replaceAccount(directory, replacement);
  expect(await readConfig(join(directory, 'server.json'))).toEqual({ ...config, account: replacement });
  expect(await readdir(directory)).toEqual(['server.json']);
  const server = await startServer({ dataDirectory: directory, port: 0 }); cleanup.push(() => server.close());
  const info = await probeSyncServer(`http://127.0.0.1:${server.server.address().port}/`, { allowLoopbackHttp: true });
  const store = new AccountStore(info); cleanup.push(() => store.close());
  const identity = createDeviceIdentity();
  await expect(store.enroll(identity, { username: 'testuser', password, name: 'Old', ephemeral: false })).rejects.toMatchObject({ status: 401 });
  await store.enroll(identity, { username: 'replacement-user', password: 'ONLY_TEST_REPLACEMENT_PASSWORD', name: 'New', ephemeral: false });
  await store.openSession(identity); expect(await store.list()).toEqual([]);
});
it('exposes rendezvous in the probe and the session expiry from the device session', async () => {
  const ctx = await setup(); expect(ctx.info.rendezvous).toBe(true);
  const off = await setup({ enabled: false }); expect(off.info.rendezvous).toBe(false);
  const store = new AccountStore(ctx.info); cleanup.push(() => store.close());
  const identity = createDeviceIdentity(); await store.enroll(identity, { username: 'testuser', password, name: 'Alice', ephemeral: false });
  const before = Date.now(); const result = await store.openSession(identity);
  expect(result.signedIn).toBe(true); expect(result.expiresAt).toBeGreaterThanOrEqual(before + 899000);
});
it('refresh extends the session by 15 minutes and keeps the token', async () => {
  const ctx = await setup(); const alice = await ctx.peer('Alice');
  ctx.advance(600000);
  const result = await alice.store.refresh(); expect(result.expiresAt - Date.now()).toBeGreaterThan(800000);
  ctx.advance(600000); await alice.register('Alice'); expect(await alice.devices()).toHaveLength(1);
});
it('refresh stops at the 12 hour limit', async () => {
  const ctx = await setup(); const alice = await ctx.peer('Alice');
  for (let elapsed = 0; elapsed < 43200000 - 300000; elapsed += 300000) {
    ctx.advance(300000); await alice.store.refresh(); await alice.register('Alice');
  }
  ctx.advance(300000);
  await expect(alice.store.refresh()).rejects.toMatchObject({ status: 401 });
});
it('expires after 15 minutes without refresh', async () => {
  const ctx = await setup(); const alice = await ctx.peer('Alice');
  ctx.advance(900000); await expect(alice.devices()).rejects.toMatchObject({ status: 401 });
});
it('keeps presence alive across the 15 minute mark only with refresh', async () => {
  const ctx = await setup(); const alice = await ctx.peer('Alice'); const bob = await ctx.peer('Bob');
  for (let t = 30000; t <= 1200000; t += 30000) {
    ctx.advance(30000); await alice.register('Alice'); await alice.store.refresh();
    await bob.register('Bob').catch(error => { expect(error.status).toBe(401); });
  }
  const names = (await alice.devices()).map(d => d.name); expect(names).toEqual(['Alice']);
});
it('rejects refresh without token or with a body', async () => {
  const ctx = await setup(); const alice = await ctx.peer('Alice');
  await expect(boundedJson(new URL('v1/refresh', ctx.url), { method: 'POST' })).rejects.toMatchObject({ status: 401 });
  await expect(alice.store.request('POST', '/v1/refresh', '{}')).rejects.toMatchObject({ status: 400 });
});
it('requires a valid single-use ownership proof for every registration', async () => {
  const ctx = await setup(); const peer = await ctx.peer('Alice'); const id = peer.identity; const fresh = createRendezvousIdentity();
  const noProof = body => { const { proof, ...rest } = body; return rest; };
  await expect(rawPut(ctx, peer, id, { mutate: noProof })).rejects.toMatchObject({ status: 400 });
  await expect(rawPut(ctx, peer, id, { mutate: body => ({ ...body, proof: '0'.repeat(64) }) })).rejects.toMatchObject({ status: 400 });
  await expect(rawPut(ctx, peer, id, { name: 'A', mutate: body => ({ ...body, name: 'B' }) })).rejects.toMatchObject({ status: 400 });
  // Registering a key whose private half the caller does not hold fails even with the caller's own challenge.
  const victim = createRendezvousIdentity();
  await expect(rawPut(ctx, peer, fresh, { mutate: body => ({ ...body, publicKey: victim.publicKey }) })).rejects.toMatchObject({ status: 400 });
  // Challenge reuse, also after a failed attempt.
  const issued = await peer.store.request('GET', '/v1/rendezvous/challenge');
  await rawPut(ctx, peer, id, { challenge: issued, name: 'Alice' });
  await expect(rawPut(ctx, peer, id, { challenge: issued, name: 'Alice' })).rejects.toMatchObject({ status: 400 });
  const burned = await peer.store.request('GET', '/v1/rendezvous/challenge');
  await expect(rawPut(ctx, peer, id, { challenge: burned, mutate: body => ({ ...body, proof: '1'.repeat(64) }) })).rejects.toMatchObject({ status: 400 });
  await expect(rawPut(ctx, peer, id, { challenge: burned })).rejects.toMatchObject({ status: 400 });
  // Renewal needs a new proof as well, and register() fetches its own challenge.
  await peer.register('Alice'); expect(await peer.devices()).toHaveLength(1);
});
it('expires challenges after 30 seconds and binds them to their owner', async () => {
  const ctx = await setup(); const alice = await ctx.peer('Alice'); const other = await ctx.peer('Other');
  const issued = await alice.store.request('GET', '/v1/rendezvous/challenge');
  expect(issued.expiresAt).toBeGreaterThan(Date.now() - 1000); expect(issued.serverKey).toHaveLength(60);
  ctx.advance(31_000); await expect(rawPut(ctx, alice, alice.identity, { challenge: issued, name: 'Alice' })).rejects.toMatchObject({ status: 400 });
  const mine = await alice.store.request('GET', '/v1/rendezvous/challenge');
  const identity = createRendezvousIdentity();
  await expect(rawPut(ctx, other, identity, { challenge: mine, name: 'Other' })).rejects.toMatchObject({ status: 400 });
  await expect(alice.store.request('GET', '/v1/rendezvous/challenge?x=1')).rejects.toMatchObject({ status: 400 });
  await expect(request(alice, 'POST', '/v1/rendezvous/challenge', {})).rejects.toMatchObject({ status: 405 });
});
it('caps open challenges at four per owner', async () => {
  const ctx = await setup(); const alice = await ctx.peer('Alice');
  for (let i = 0; i < 4; i++) await alice.store.request('GET', '/v1/rendezvous/challenge');
  await expect(alice.store.request('GET', '/v1/rendezvous/challenge')).rejects.toMatchObject({ status: 429 });
  ctx.advance(31_000); await alice.store.request('GET', '/v1/rendezvous/challenge');
});
it('rejects a low-order device public key', async () => {
  const ctx = await setup(); const peer = await ctx.peer('Alice');
  const publicKey = Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), Buffer.alloc(32)]).toString('base64');
  const issued = await peer.store.request('GET', '/v1/rendezvous/challenge');
  await expect(request(peer, 'PUT', '/v1/rendezvous/devices', { challenge: issued.challenge, name: 'Evil', proof: '0'.repeat(64), publicKey })).rejects.toMatchObject({ status: 400 });
});
it('blocks the pair for 30 s only when the target drops a pending request', async () => {
  const ctx = await setup(); const alice = await ctx.peer('Alice'); const bob = await ctx.peer('Bob');
  const first = await alice.request(bob.identity.id);
  await expect(alice.request(bob.identity.id)).rejects.toMatchObject({ status: 429 });
  await request(bob, 'DELETE', `/v1/rendezvous/sessions/${first.id}`);
  await expect(alice.request(bob.identity.id)).rejects.toMatchObject({ status: 429 });
  ctx.advance(29_000); await alice.register('Alice'); await bob.register('Bob');
  await expect(alice.request(bob.identity.id)).rejects.toMatchObject({ status: 429 });
  ctx.advance(1_000); await alice.register('Alice'); await bob.register('Bob');
  const next = await alice.request(bob.identity.id);
  // The requester withdrawing, or the target ending an active session, does not block.
  await request(alice, 'DELETE', `/v1/rendezvous/sessions/${next.id}`);
  const again = await alice.request(bob.identity.id);
  await request(bob, 'POST', `/v1/rendezvous/sessions/${again.id}/accept`, {});
  await request(bob, 'DELETE', `/v1/rendezvous/sessions/${again.id}`);
  await alice.request(bob.identity.id);
});
it('binds channel roles to the session direction', async () => {
  const ctx = await setup(); const { alice, bob, session } = await pair(ctx);
  expect(() => alice.channel({ ...session }, alice.identity.id, 'view')).toThrow();
  expect(() => bob.channel({ ...session }, bob.identity.id, 'view')).toThrow();
  const third = createRendezvousIdentity();
  expect(() => bob.channel({ ...session, to: third.id }, third.id, 'view')).toThrow();
});
it('reports rendezvousProof in the probe', async () => {
  const ctx = await setup(); expect(ctx.info.rendezvousProof).toBe(true);
  const off = await setup({ enabled: false }); expect(off.info.rendezvousProof).toBe(false);
});
it('binds presence to the enrolled device of the session and its enrolled X25519 key', async () => {
  const ctx = await setup(); const alice = await ctx.peer('Alice'); const bob = await ctx.peer('Bob');
  // Bob's key with Alice's token is refused (403) even with a valid proof of possession.
  await expect(rawPut(ctx, alice, bob.identity, { name: 'Bob' })).rejects.toMatchObject({ status: 403 });
  // A fresh key that was never enrolled is refused too.
  await expect(rawPut(ctx, alice, createRendezvousIdentity(), { name: 'Stray' })).rejects.toMatchObject({ status: 403 });
  expect(await alice.devices()).toHaveLength(2);
});
it('lets the same device take over its own presence with a new session token', async () => {
  const ctx = await setup(); const alice = await ctx.peer('Alice');
  const second = new AccountStore(ctx.info); cleanup.push(() => second.close());
  await second.openSession(alice.identity); const again = new RendezvousPeer(second, alice.identity);
  await expect(again.register('Alice')).resolves.toMatchObject({ id: alice.identity.id });
  expect(await again.devices()).toHaveLength(1);
});
it('drops presence and rendezvous sessions of a revoked device immediately', async () => {
  const ctx = await setup(); const { alice, bob, session } = await pair(ctx);
  const admin = await ctx.peer('Admin');
  expect((await admin.devices()).map(d => d.id).sort()).toEqual([alice.identity.id, bob.identity.id, admin.identity.id].sort());
  await admin.store.revoke(admin.identity, bob.identity.id);
  expect((await admin.devices()).map(d => d.id).sort()).toEqual([alice.identity.id, admin.identity.id].sort());
  await expect(bob.devices()).rejects.toMatchObject({ status: 401 });
  await expect(alice.sessions()).resolves.toEqual([]); expect(session.to).toBe(bob.identity.id);
});
