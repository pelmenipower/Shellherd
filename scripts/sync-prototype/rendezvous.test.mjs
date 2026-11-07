import { mkdtemp, readFile, readdir, rm, writeFile, chmod, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { afterEach, beforeAll, expect, it as platformIt } from 'vitest';
import { createAccount } from './account-auth.mjs';
import { createSyncServer } from './server.mjs';
import { AccountStore } from './account-transport.mjs';
import { boundedJson, probeSyncServer } from './http-common.mjs';
import { createRendezvousIdentity, RendezvousPeer } from './rendezvous-client.mjs';
import { readConfig, replaceAccount, startServer } from '../../server/main.mjs';
const it = platformIt.runIf(process.platform === 'linux');
const password = 'ONLY_TEST_RENDEZVOUS_PASSWORD';
const cleanup = []; let account;
beforeAll(async () => { account = await createAccount('testuser', password); });
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup({ enabled = true } = {}) {
  let now = Date.now();
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-rendezvous-'));
  cleanup.push(() => rm(directory, { force: true, recursive: true }));
  const config = { directory, serverId: randomBytes(32).toString('hex'), namespace: 'test', account, rendezvous: enabled, clock: () => now };
  const server = await createSyncServer(config); cleanup.push(() => server.close());
  const url = await server.listen(); const info = await probeSyncServer(url, { allowLoopbackHttp: true });
  async function peer(name) {
    const store = new AccountStore(info); cleanup.push(() => store.close());
    await store.login('testuser', password); const client = new RendezvousPeer(store); await client.register(name); return client;
  }
  return { directory, config, server, url, info, peer, advance: amount => { now += amount; } };
}
async function pair(ctx, scope = 'view') {
  const alice = await ctx.peer('Alice'); const bob = await ctx.peer('Bob');
  const session = await alice.request(bob.identity.id, scope);
  const a = alice.channel(session, bob.identity.publicKey, bob.identity.id, scope);
  const b = bob.channel(session, alice.identity.publicKey, alice.identity.id, scope);
  cleanup.push(() => { a.dispose(); b.dispose(); });
  return { alice, bob, session, a, b };
}
const request = (peer, method, path, body) => peer.store.request(method, path, body === undefined ? undefined : JSON.stringify(body));
it('requires login, keeps the existing sync probe compatible, and is opt-in', async () => {
  const ctx = await setup();
  const info = await boundedJson(new URL('v1/info', ctx.url)); expect(info.rendezvous).toBe(true);
  await expect(boundedJson(new URL('v1/rendezvous/devices', ctx.url))).rejects.toMatchObject({ status: 401 });
  const disabled = await setup({ enabled: false });
  expect((await boundedJson(new URL('v1/info', disabled.url))).rendezvous).toBe(false);
  const store = new AccountStore(disabled.info); cleanup.push(() => store.close()); await store.login('testuser', password);
  await expect(store.request('GET', '/v1/rendezvous/devices')).rejects.toMatchObject({ status: 404 });
});
it('requires target approval and a cryptographically verified consent frame before sending', async () => {
  const ctx = await setup(); const { alice, bob, session, a, b } = await pair(ctx, 'control');
  expect(await alice.devices()).toHaveLength(2); expect(await bob.sessions()).toEqual([session]);
  await expect(a.send('before consent')).rejects.toThrow();
  await expect(request(alice, 'POST', `/v1/rendezvous/sessions/${session.id}/accept`, {})).rejects.toMatchObject({ status: 403 });
  await expect(request(bob, 'POST', `/v1/rendezvous/sessions/${session.id}/accept`, 7)).rejects.toMatchObject({ status: 400 });
  await expect(request(bob, 'POST', `/v1/rendezvous/sessions/${session.id}/accept`, [])).rejects.toMatchObject({ status: 400 });
  await b.accept(); expect(b.ready).toBe(true); expect(a.ready).toBe(false);
  await a.receive(); expect(a.ready).toBe(true);
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
  expect(() => alice.channel(session, attacker.publicKey, bob.identity.id, 'view')).toThrow();
  expect(() => alice.channel(session, bob.identity.publicKey, bob.identity.id, 'control')).toThrow();
  await request(bob, 'POST', `/v1/rendezvous/sessions/${session.id}/accept`, {});
  await expect(a.send('server state is insufficient')).rejects.toThrow();
  await request(bob, 'POST', `/v1/rendezvous/sessions/${session.id}/messages`, { sequence: 1, nonce: randomBytes(12).toString('base64'), ciphertext: Buffer.from('forged approval').toString('base64'), tag: randomBytes(16).toString('base64') });
  await expect(a.receive()).rejects.toThrow(); expect(a.ready).toBe(false);
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
  const session = await alice.request(bob.identity.id);
  const channel = alice.channel(session, bob.identity.publicKey, bob.identity.id, 'view'); cleanup.push(() => channel.dispose());
  expect(() => alice.channel(session, bob.identity.publicKey, bob.identity.id, 'view')).toThrow();
});
it('handles a lost encrypted consent reply and data in the same receive batch as consent', async () => {
  const ctx = await setup(); const { bob, a, b } = await pair(ctx);
  const original = bob.store.request.bind(bob.store); let lose = true;
  bob.store.request = async (...args) => {
    const result = await original(...args);
    if (lose && args[1].endsWith('/messages')) { lose = false; throw Error('Lost consent reply'); } return result;
  };
  await expect(b.accept()).rejects.toThrow('Lost consent reply'); expect(b.ready).toBe(false);
  await b.retry(); await b.send('data after consent');
  expect(await a.receive()).toEqual(['data after consent']); expect(a.ready).toBe(true);
  await a.send('confirmed'); expect(await b.receive()).toEqual(['confirmed']);
});
it('isolates session participants even when they share the server account', async () => {
  const ctx = await setup(); const { alice, bob, session } = await pair(ctx); const outsider = await ctx.peer('Outsider');
  expect(await outsider.sessions()).toEqual([]);
  for (const suffix of ['', '/messages', '/accept', '/ack']) {
    await expect(request(outsider, suffix === '/accept' || suffix === '/ack' ? 'POST' : 'GET', `/v1/rendezvous/sessions/${session.id}${suffix}`, suffix === '/accept' ? {} : suffix === '/ack' ? { through: 0 } : undefined)).rejects.toMatchObject({ status: 404 });
  }
  await expect(request(outsider, 'PUT', '/v1/rendezvous/devices', { name: 'Bob', publicKey: bob.identity.publicKey })).rejects.toMatchObject({ status: 409 });
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
  const ctx = await setup(); const { alice, bob, a, b } = await pair(ctx); await b.accept(); await a.receive();
  for (let i = 0; i < 10; i++) { ctx.advance(30_000); await alice.register('Alice'); await bob.register('Bob'); }
  expect(await alice.sessions()).toEqual([]);
  await expect(a.send('expired')).rejects.toMatchObject({ status: 404 });
});
it('bounds pending requests, payloads, sequence order and unacknowledged messages', async () => {
  const ctx = await setup(); const { alice, bob, session, a, b } = await pair(ctx);
  for (let i = 0; i < 3; i++) await alice.request(bob.identity.id);
  await expect(alice.request(bob.identity.id)).rejects.toMatchObject({ status: 429 });
  await b.accept(); await a.receive();
  await expect(a.send('x'.repeat(8192))).rejects.toThrow();
  const path = `/v1/rendezvous/sessions/${session.id}/messages`;
  const frame = sequence => ({ sequence, nonce: randomBytes(12).toString('base64'), tag: randomBytes(16).toString('base64'), ciphertext: Buffer.from('opaque').toString('base64') });
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
  const ctx = await setup(); const { alice, bob, a, b } = await pair(ctx); await b.accept(); await a.receive();
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
  const store = new AccountStore(info); cleanup.push(() => store.close()); await store.login('testuser', password);
  expect(await store.request('GET', '/v1/rendezvous/devices')).toEqual({ devices: [] });
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
  await expect(store.login('testuser', password)).rejects.toMatchObject({ status: 401 });
  await store.login('replacement-user', 'ONLY_TEST_REPLACEMENT_PASSWORD'); expect(await store.list()).toEqual([]);
});
