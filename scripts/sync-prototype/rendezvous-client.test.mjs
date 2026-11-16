import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import { afterEach, beforeAll, expect, it as platformIt, vi } from 'vitest';
import Noise from 'noise-handshake';
import Cipher from 'noise-handshake/cipher.js';
import { createAccount } from './account-auth.mjs';
import { createSyncServer } from './server.mjs';
import { AccountStore } from './account-transport.mjs';
import { createDeviceIdentity } from './device-proof.mjs';
import { probeSyncServer } from './http-common.mjs';
import { createRendezvousIdentity, noiseKeyPair, RENDEZVOUS_NOISE_PROFILE, RENDEZVOUS_PROLOGUE, RendezvousPeer, spkiOf } from './rendezvous-client.mjs';
vi.setConfig({ testTimeout: 20_000 }); // network tests are load-sensitive
const it = platformIt.runIf(process.platform === 'linux');
const password = 'ONLY_TEST_RENDEZVOUS_CLIENT_PASSWORD';
const cleanup = []; let account;
beforeAll(async () => { account = await createAccount('testuser', password); });
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-rendezvous-client-'));
  cleanup.push(() => rm(directory, { force: true, recursive: true }));
  const server = await createSyncServer({ directory, serverId: randomBytes(32).toString('hex'), namespace: 'test', account, rendezvous: true, limits: { login: 100, session: 100, challenge: 100 } });
  cleanup.push(() => server.close());
  const info = await probeSyncServer(await server.listen(), { allowLoopbackHttp: true });
  const peer = async name => {
    const store = new AccountStore(info); cleanup.push(() => store.close()); const identity = createDeviceIdentity();
    await store.enroll(identity, { username: 'testuser', password, name, ephemeral: false }); await store.openSession(identity);
    const client = new RendezvousPeer(store, identity); await client.register(name); return client;
  };
  return { info, peer };
}
// alice = viewer (Noise responder), bob = agent (Noise initiator, accepts).
async function pair(scope = 'view') {
  const ctx = await setup(); const alice = await ctx.peer('Alice'); const bob = await ctx.peer('Bob');
  const session = await alice.request(bob.identity.id, scope);
  const a = alice.channel(session, bob.identity.id, scope); const b = bob.channel(session, alice.identity.id, scope);
  cleanup.push(() => { a.dispose(); b.dispose(); });
  return { ctx, alice, bob, session, a, b };
}
async function handshake(a, b) {
  await b.accept();
  for (let round = 0; round < 6 && !(a.ready && b.ready); round++) { await a.receive(); await b.receive(); }
  expect(a.ready && b.ready).toBe(true);
}
const post = (peer, session, body) => peer.store.request('POST', `/v1/rendezvous/sessions/${session.id}/messages`, JSON.stringify(body));
const activate = (bob, session) => bob.store.request('POST', `/v1/rendezvous/sessions/${session.id}/accept`, '{}');
const incoming = async (peer, session, after = 0) => (await peer.store.request('GET', `/v1/rendezvous/sessions/${session.id}/messages?after=${after}`)).messages;
const prologue = (ctx, session, scope = session.scope, overrides = {}) => Buffer.from(JSON.stringify([RENDEZVOUS_PROLOGUE, RENDEZVOUS_NOISE_PROFILE, overrides.serverId ?? ctx.info.serverId, session.id, overrides.nonce ?? session.nonce, scope, session.from, session.to]));
function record(peer) {
  const posted = []; const original = peer.store.request.bind(peer.store);
  peer.store.request = async (...args) => {
    if (args[0] === 'POST' && args[1].endsWith('/messages')) posted.push(JSON.parse(args[2]));
    return original(...args);
  };
  return posted;
}
// Manual Noise responder standing in for the viewer (alice) with an arbitrary static key and prologue.
async function forgeResponder(ctx, alice, session, { keys = noiseKeyPair(alice.identity.privateKey), overrides = {} } = {}) {
  const noise = new Noise('XX', false, keys); noise.initialise(prologue(ctx, session, session.scope, overrides));
  const [m1] = await incoming(alice, session); expect(noise.recv(Buffer.from(m1.frame, 'base64')).length).toBe(0);
  await post(alice, session, { sequence: 1, frame: noise.send().toString('base64') });
}
// Manual Noise initiator standing in for the agent (bob): sends message 1, returns a finisher for 3 and the transport.
function forgeInitiator(ctx, bob, session, keys = noiseKeyPair(bob.identity.privateKey)) {
  const noise = new Noise('XX', true, keys); noise.initialise(prologue(ctx, session));
  return {
    noise,
    async start() { await activate(bob, session); await post(bob, session, { sequence: 1, frame: noise.send().toString('base64') }); },
    async finish() {
      const messages = await incoming(bob, session);
      noise.recv(Buffer.from(messages[0].frame, 'base64'));
      const m3 = noise.send(); return { m3, tx: new Cipher(noise.tx) };
    },
  };
}
it('derives the Noise key pair from PKCS8 and rejects other key types', () => {
  const { privateKey } = generateKeyPairSync('x25519');
  const keys = noiseKeyPair(privateKey);
  expect(keys.publicKey).toHaveLength(32); expect(keys.secretKey).toHaveLength(32);
  expect(keys.publicKey.equals(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(12))).toBe(true);
  expect(spkiOf(keys.publicKey)).toBe(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64'));
  expect(() => noiseKeyPair(generateKeyPairSync('ed25519').privateKey)).toThrow();
  expect(() => spkiOf(Buffer.alloc(31))).toThrow();
});
it('completes the XX handshake with the specified sequences and an encrypted accepted frame', async () => {
  const { alice, bob, a, b } = await pair(); const fromAlice = record(alice); const fromBob = record(bob);
  expect(a.ready).toBe(false); expect(b.ready).toBe(false);
  await handshake(a, b);
  expect(fromBob.map(m => m.sequence)).toEqual([1, 2, 3]); expect(fromAlice.map(m => m.sequence)).toEqual([1]);
  expect(Buffer.from(fromBob[0].frame, 'base64')).toHaveLength(32); expect(Buffer.from(fromAlice[0].frame, 'base64')).toHaveLength(96);
  expect(Buffer.from(fromBob[1].frame, 'base64')).toHaveLength(64); expect(Buffer.from(fromBob[2].frame, 'base64')).toHaveLength(50);
  await a.send('v'); expect(await b.receive()).toEqual(['v']);
  await b.send({ n: 1 }); expect(await a.receive()).toEqual([{ n: 1 }]);
  await expect(a.send('x'.repeat(8192))).rejects.toThrow();
});
it('refuses to send before the handshake is complete', async () => {
  const { a, b } = await pair();
  await expect(a.send('early')).rejects.toThrow(); await expect(b.send('early')).rejects.toThrow();
  await b.accept(); await expect(b.send('still early')).rejects.toThrow();
});
it('fails with code mismatch before sending message 3 when the responder key is not the expected device', async () => {
  const { ctx, alice, bob, session, b } = await pair(); const fromBob = record(bob);
  await b.accept(); await forgeResponder(ctx, alice, session, { keys: noiseKeyPair(createRendezvousIdentity().privateKey) });
  await expect(b.receive()).rejects.toMatchObject({ code: 'mismatch' });
  expect(b.ready).toBe(false); expect(fromBob.map(m => m.sequence)).toEqual([1]);
  await expect(b.receive()).rejects.toThrow();
});
it('fails with code mismatch on the responder when the initiator key is not the expected device', async () => {
  const { ctx, bob, session, a } = await pair();
  const forged = forgeInitiator(ctx, bob, session, noiseKeyPair(createRendezvousIdentity().privateKey));
  await forged.start(); await a.receive();
  const { m3, tx } = await forged.finish();
  await post(bob, session, { sequence: 2, frame: m3.toString('base64') });
  await post(bob, session, { sequence: 3, frame: tx.encrypt(Buffer.from(JSON.stringify({ kind: 'accepted', scope: 'view' }))).toString('base64') });
  await expect(a.receive()).rejects.toMatchObject({ code: 'mismatch' }); expect(a.ready).toBe(false);
});
for (const field of ['serverId', 'nonce', 'scope']) {
  it(`makes the initiator fail at message 2 when the prologue differs in ${field}`, async () => {
    const { ctx, alice, session, b } = await pair();
    await b.accept();
    const overrides = field === 'scope' ? {} : { [field]: randomBytes(32).toString('hex') };
    const noise = new Noise('XX', false, noiseKeyPair(alice.identity.privateKey));
    noise.initialise(prologue(ctx, session, field === 'scope' ? 'control' : session.scope, overrides));
    const [m1] = await incoming(alice, session); noise.recv(Buffer.from(m1.frame, 'base64'));
    await post(alice, session, { sequence: 1, frame: noise.send().toString('base64') });
    const error = await b.receive().then(() => null, e => e);
    expect(error).toBeTruthy(); expect(error.code).not.toBe('mismatch'); expect(b.ready).toBe(false);
  });
}
it('rejects a 33 byte message 1 and poisons the channel', async () => {
  const { bob, session, a } = await pair(); await activate(bob, session);
  await post(bob, session, { sequence: 1, frame: randomBytes(33).toString('base64') });
  await expect(a.receive()).rejects.toThrow(); await expect(a.receive()).rejects.toThrow();
});
it('rejects an accepted frame for another scope and data before accepted', async () => {
  for (const mode of ['scope', 'data']) {
    const { ctx, bob, session, a } = await pair();
    const forged = forgeInitiator(ctx, bob, session); await forged.start(); await a.receive();
    const { m3, tx } = await forged.finish();
    const payload = mode === 'scope' ? { kind: 'accepted', scope: 'control' } : { kind: 'data', value: 'early' };
    await post(bob, session, { sequence: 2, frame: m3.toString('base64') });
    await post(bob, session, { sequence: 3, frame: tx.encrypt(Buffer.from(JSON.stringify(payload))).toString('base64') });
    await expect(a.receive()).rejects.toThrow(); expect(a.ready).toBe(false);
  }
});
it('fails and poisons the channel when the server drops a data frame and renumbers', async () => {
  const { ctx, bob, session, a } = await pair();
  const forged = forgeInitiator(ctx, bob, session); await forged.start(); await a.receive();
  const { m3, tx } = await forged.finish();
  const send = (sequence, value) => post(bob, session, { sequence, frame: tx.encrypt(Buffer.from(JSON.stringify(value))).toString('base64') });
  await post(bob, session, { sequence: 2, frame: m3.toString('base64') });
  await send(3, { kind: 'accepted', scope: 'view' });
  expect(await a.receive()).toEqual([]); expect(a.ready).toBe(true);
  tx.encrypt(Buffer.from(JSON.stringify({ kind: 'data', value: 'dropped' })));
  await send(4, { kind: 'data', value: 'second' });
  await expect(a.receive()).rejects.toThrow(); expect(a.ready).toBe(false);
  await expect(a.receive()).rejects.toThrow();
});
it('enforces frame bounds and format on the server', async () => {
  const { bob, session } = await pair(); await activate(bob, session);
  await expect(post(bob, session, { sequence: 1, frame: randomBytes(8209).toString('base64') })).rejects.toMatchObject({ status: 400 });
  await expect(post(bob, session, { sequence: 1, frame: '' })).rejects.toMatchObject({ status: 400 });
  await expect(post(bob, session, { sequence: 1, nonce: randomBytes(12).toString('base64'), ciphertext: 'AAAA', tag: randomBytes(16).toString('base64') })).rejects.toMatchObject({ status: 400 });
  await expect(post(bob, session, { sequence: 1, frame: 'AAAA', extra: 1 })).rejects.toMatchObject({ status: 400 });
  await expect(post(bob, session, { sequence: 1, frame: 'AAAA=' })).rejects.toMatchObject({ status: 400 });
  expect(await post(bob, session, { sequence: 1, frame: randomBytes(8208).toString('base64') })).toEqual({ sequence: 1 });
});
it('answers an identical retry with 200 and different content for the same sequence with 409', async () => {
  const { bob, session } = await pair(); await activate(bob, session); const frame = randomBytes(40).toString('base64');
  expect(await post(bob, session, { sequence: 1, frame })).toEqual({ sequence: 1 });
  expect(await post(bob, session, { sequence: 1, frame })).toEqual({ sequence: 1 });
  await expect(post(bob, session, { sequence: 1, frame: randomBytes(40).toString('base64') })).rejects.toMatchObject({ status: 409 });
});
it('resends the identical frame after a lost reply for message 3 and finishes the handshake', async () => {
  const { alice, bob, a, b } = await pair(); const posted = record(bob); void alice;
  const original = bob.store.request; let lose = true;
  bob.store.request = async (...args) => {
    const result = await original(...args);
    if (lose && args[0] === 'POST' && args[1].endsWith('/messages') && JSON.parse(args[2]).sequence === 2) { lose = false; throw Error('Lost reply'); }
    return result;
  };
  await b.accept(); await a.receive();
  await expect(b.receive()).rejects.toThrow('Lost reply');
  await b.receive(); expect(b.ready).toBe(true);
  const sequenceTwo = posted.filter(m => m.sequence === 2); expect(sequenceTwo).toHaveLength(2); expect(sequenceTwo[0].frame).toBe(sequenceTwo[1].frame);
  await a.receive(); expect(a.ready).toBe(true);
}, 20_000);
it('does not deliver twice when the reply to an acknowledgment is lost', async () => {
  const { alice, a, b } = await pair(); await handshake(a, b);
  await b.send('once');
  const original = alice.store.request.bind(alice.store); let lose = true;
  alice.store.request = async (...args) => {
    const result = await original(...args);
    if (lose && args[1].endsWith('/ack')) { lose = false; throw Error('Lost ack reply'); } return result;
  };
  await expect(a.receive()).rejects.toThrow('Lost ack reply');
  expect(await a.receive()).toEqual(['once']); expect(await a.receive()).toEqual([]);
}, 20_000);
it('delivers data that arrives in the same batch as message 3 and accepted', async () => {
  const { a, b } = await pair();
  await b.accept(); await a.receive(); await b.receive(); expect(b.ready).toBe(true);
  await b.send('with the batch');
  expect(await a.receive()).toEqual(['with the batch']); expect(a.ready).toBe(true);
}, 20_000);
it('disposes safely after message 1 and wipes both ciphers after the handshake', async () => {
  const early = await pair(); await early.b.accept(); expect(() => early.b.dispose()).not.toThrow(); expect(() => early.b.dispose()).not.toThrow();
  const { a, b } = await pair(); await handshake(a, b);
  const spy = vi.spyOn(Cipher.prototype, '_clear'); b.dispose(); expect(spy).toHaveBeenCalledTimes(2);
  expect(() => b.dispose()).not.toThrow(); expect(b.ready).toBe(false);
}, 20_000);
const delayPosts = (peer, ms) => {
  const original = peer.store.request.bind(peer.store);
  vi.spyOn(peer.store, 'request').mockImplementation(async (...args) => {
    if (args[0] === 'POST' && args[1].endsWith('/messages')) await new Promise(resolve => setTimeout(resolve, ms));
    return original(...args);
  });
};
it('lets receive() run while a send() POST is in flight without losing or duplicating values', async () => {
  const { bob, a, b } = await pair(); await handshake(a, b);
  await a.send('to-bob'); delayPosts(bob, 100);
  const sending = b.send({ part: 'offer-1' });
  expect(await b.receive()).toEqual(['to-bob']); await sending;
  expect(await a.receive()).toEqual([{ part: 'offer-1' }]); expect(await a.receive()).toEqual([]);
  expect(await b.receive()).toEqual([]); expect(b.ready).toBe(true);
  await b.send('after'); expect(await a.receive()).toEqual(['after']);
});
it('keeps the order of parallel send() calls', async () => {
  const { bob, a, b } = await pair(); await handshake(a, b); delayPosts(bob, 30);
  await Promise.all([b.send(1), b.send(2), b.send(3)]);
  const got = []; for (let i = 0; i < 3 && got.length < 3; i++) got.push(...await a.receive());
  expect(got).toEqual([1, 2, 3]);
});
it('returns acknowledged values even when the follow-up flush fails, and a poisoned channel sends nothing', async () => {
  const { bob, a, b } = await pair(); await handshake(a, b);
  await a.send('to-bob');
  const original = bob.store.request.bind(bob.store); let fail = true;
  vi.spyOn(bob.store, 'request').mockImplementation(async (...args) => {
    if (fail && args[0] === 'POST' && args[1].endsWith('/messages')) { fail = false; throw Error('offline'); }
    return original(...args);
  });
  await expect(b.send('x')).rejects.toThrow('offline');
  expect(await b.receive()).toEqual(['to-bob']); // the pending flush is retried, no loss
  expect(await a.receive()).toEqual(['x']);
});
it('refuses to flush or retry once the channel is poisoned', async () => {
  const { ctx, alice, bob, session, b } = await pair();
  await b.accept(); await forgeResponder(ctx, alice, session, { keys: noiseKeyPair(createRendezvousIdentity().privateKey) });
  await expect(b.receive()).rejects.toMatchObject({ code: 'mismatch' });
  const posts = vi.spyOn(bob.store, 'request');
  await expect(b.retry()).rejects.toThrow();
  expect(posts.mock.calls.filter(call => call[0] === 'POST')).toHaveLength(0);
});

it('forget frees a request slot, ignores unknown ids, and the 17th open request is a 429 limit', async () => {
  const identity = createRendezvousIdentity(); const ids = [];
  const store = { info: { serverId: 'a'.repeat(64) }, async request(_method, _path, body) {
    const { target, scope, nonce } = JSON.parse(body); const id = randomBytes(32).toString('hex'); ids.push(id);
    return { id, from: identity.id, to: target, scope, nonce, state: 'pending', expiresAt: 0 };
  } };
  const peer = new RendezvousPeer(store, identity); const target = 'b'.repeat(64);
  for (let i = 0; i < 16; i++) await peer.request(target);
  await expect(peer.request(target)).rejects.toMatchObject({ status: 429 });
  peer.forget('f'.repeat(64)); await expect(peer.request(target)).rejects.toMatchObject({ status: 429 }); // unknown id: no-op
  peer.forget(ids[3]); await expect(peer.request(target)).resolves.toMatchObject({ state: 'pending' });
  await expect(peer.request(target)).rejects.toMatchObject({ status: 429 });
});
