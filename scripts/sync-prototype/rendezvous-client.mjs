// Reference signaling client. OS capture/input and unattended access are not enabled.
import { createPublicKey, generateKeyPairSync, randomBytes } from 'node:crypto';
import Noise from 'noise-handshake';
import Cipher from 'noise-handshake/cipher.js';
import { deviceId, registrationProof } from './rendezvous.mjs';
import { performance } from 'node:perf_hooks';
const check = ok => { if (!ok) throw Error('Rendezvous peer verification failed'); };
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const RENDEZVOUS_NOISE_PROFILE = 'Noise_XX_25519_ChaChaPoly_BLAKE2b';
export const RENDEZVOUS_PROLOGUE = 'shellherd-rendezvous-noise-v1';
const PKCS8_X25519_PREFIX = '302e020100300506032b656e04220420';
/** Raw X25519 key pair from a Node KeyObject via PKCS8 DER (fixed 16-byte prefix); public key equals the SPKI tail. Caller zeroes secretKey. */
export function noiseKeyPair(privateKey) {
  const der = privateKey.export({ format: 'der', type: 'pkcs8' });
  try {
    check(der.length === 48 && der.subarray(0, 16).toString('hex') === PKCS8_X25519_PREFIX);
    const secretKey = Buffer.from(der.subarray(16));
    const publicKey = Buffer.from(createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).subarray(12));
    return { publicKey, secretKey };
  } finally { der.fill(0); }
}
/** SPKI DER base64 (60 chars) of a raw 32-byte X25519 public key. */
export function spkiOf(raw) {
  check(Buffer.isBuffer(raw) && raw.length === 32);
  return Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw]).toString('base64');
}
export function createRendezvousIdentity() {
  const { privateKey, publicKey } = generateKeyPairSync('x25519');
  const wire = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return { privateKey, publicKey: wire, id: deviceId(wire) };
}
export class RendezvousPeer {
  #requests = new Map();
  constructor(store, identity = createRendezvousIdentity()) {
    check(identity.id === deviceId(identity.publicKey));
    check(createPublicKey(identity.privateKey).export({ format: 'der', type: 'spki' }).toString('base64') === identity.publicKey);
    this.store = store; this.identity = identity;
  }
  async register(name) {
    // A fresh challenge per call: the ownership proof is required on every lease renewal.
    const { challenge, serverKey } = await this.store.request('GET', '/v1/rendezvous/challenge');
    check(hex(challenge) && typeof serverKey === 'string' && serverKey.length === 60);
    const proof = registrationProof({ privateKey: this.identity.privateKey, peerKey: serverKey, serverId: this.store.info.serverId, challenge, publicKey: this.identity.publicKey, name });
    const result = await this.store.request('PUT', '/v1/rendezvous/devices', JSON.stringify({ challenge, name, proof, publicKey: this.identity.publicKey }));
    check(result.id === this.identity.id); return result;
  }
  async devices() { return (await this.store.request('GET', '/v1/rendezvous/devices')).devices; }
  async sessions() { return (await this.store.request('GET', '/v1/rendezvous/sessions')).sessions; }
  async request(target, scope = 'view') {
    check(hex(target) && ['view', 'control'].includes(scope));
    const now = Date.now();
    for (const [id, value] of this.#requests) if (now < value.created || now - value.created >= 300_000) this.#requests.delete(id);
    check(this.#requests.size < 16);
    const nonce = randomBytes(32).toString('hex');
    const session = await this.store.request('POST', '/v1/rendezvous/sessions', JSON.stringify({ target, scope, nonce }));
    check(hex(session.id) && session.from === this.identity.id && session.to === target && session.scope === scope && session.nonce === nonce && session.state === 'pending' && !this.#requests.has(session.id));
    this.#requests.set(session.id, { created: now, target, scope, nonce }); return session;
  }
  // expectedFingerprint MUST come from an independent trusted comparison, never
  // automatically from devices(). Creating this object does not approve access.
  channel(session, expectedFingerprint, scope) {
    if (session.from === this.identity.id) {
      const expected = this.#requests.get(session.id);
      check(expected && expected.target === session.to && expected.scope === scope && expected.nonce === session.nonce);
      // Every request can construct only one local channel; it cannot be replayed
      // by returning an old server session after reconnecting or restarting.
    }
    const channel = new RendezvousChannel(this, session, expectedFingerprint, scope);
    this.#requests.delete(session.id); return channel;
  }
  async unregister() { return this.store.request('DELETE', '/v1/rendezvous/devices'); }
}
const MAX_FRAMES = 4096; const MAX_FRAME_BYTES = 8208; const MAX_PLAIN = 8192;
class RendezvousChannel {
  #outbox = []; #queued = 0; #sent = 0; #received = 0; #delivery = null; #failed = false; #closed = false;
  #acceptPosted = false; #msg1Queued = false; #acceptedSeq = null; #acceptedSeen = false; #acceptedAcked = false;
  #tx = null; #rx = null; #flushing = false; #receiving = false; #stage; #keys; #noise; #initiator;
  constructor(peer, session, fingerprint, scope) {
    check(hex(session.id) && hex(session.nonce) && hex(peer.store.info.serverId) && hex(session.from) && hex(session.to) && session.from !== session.to);
    check(['view', 'control'].includes(scope) && session.scope === scope && ['pending', 'active'].includes(session.state));
    check(hex(fingerprint) && fingerprint !== peer.identity.id);
    check([session.from, session.to].includes(peer.identity.id) && fingerprint === (session.from === peer.identity.id ? session.to : session.from));
    this.peer = peer; this.session = Object.freeze({ id: session.id, from: session.from, to: session.to, nonce: session.nonce, scope }); this.other = fingerprint;
    this.deadline = performance.now() + 300_000;
    this.#initiator = peer.identity.id === session.to; this.#stage = this.#initiator ? 'm2' : 'm1';
    this.#keys = noiseKeyPair(peer.identity.privateKey);
    try {
      this.#noise = new Noise('XX', this.#initiator, this.#keys);
      check(this.#noise.protocol.toString() === RENDEZVOUS_NOISE_PROFILE);
      this.#noise.initialise(Buffer.from(JSON.stringify([RENDEZVOUS_PROLOGUE, RENDEZVOUS_NOISE_PROFILE, peer.store.info.serverId, this.session.id, this.session.nonce, scope, this.session.from, this.session.to])));
    } catch (error) { this.#keys.secretKey.fill(0); throw error; }
  }
  #assert() { check(!this.#closed && performance.now() < this.deadline); }
  #path(suffix) { return `/v1/rendezvous/sessions/${this.session.id}/${suffix}`; }
  #enqueue(bytes) {
    const sequence = this.#queued + 1; check(sequence <= MAX_FRAMES);
    this.#queued = sequence; this.#outbox.push({ sequence, frame: Buffer.from(bytes).toString('base64') }); return sequence;
  }
  // Every outgoing frame is encrypted exactly once; retries resend the same string.
  async #flush() {
    this.#assert(); check(!this.#flushing); this.#flushing = true;
    try {
      while (this.#outbox.length) {
        const { sequence, frame } = this.#outbox[0];
        const result = await this.peer.store.request('POST', this.#path('messages'), JSON.stringify({ sequence, frame }));
        this.#assert(); check(result.sequence === sequence);
        this.#outbox.shift(); this.#sent = sequence;
      }
    } finally { this.#flushing = false; }
  }
  #verifyPeer() {
    let ok = false;
    try { ok = deviceId(spkiOf(this.#noise.rs)) === this.other; } catch { ok = false; }
    if (!ok) throw Object.assign(new Error('Rendezvous peer fingerprint mismatch'), { code: 'mismatch' });
  }
  #ciphers() { this.#tx = new Cipher(this.#noise.tx); this.#rx = new Cipher(this.#noise.rx); }
  #process(message, sequence, state) {
    check(exact(message, 'frame,sequence') && message.sequence === sequence + 1 && typeof message.frame === 'string' && message.sequence <= MAX_FRAMES);
    // Fresh buffer per frame: the library zeroes the received ephemeral key inside it.
    const bytes = Buffer.from(message.frame, 'base64');
    check(bytes.toString('base64') === message.frame && bytes.length >= 1 && bytes.length <= MAX_FRAME_BYTES);
    const noise = this.#noise;
    if (this.#stage === 'm1') {
      check(bytes.length === 32); check(noise.recv(bytes).length === 0);
      this.#enqueue(noise.send()); this.#stage = 'm3';
    } else if (this.#stage === 'm2') {
      check(this.#msg1Queued && bytes.length === 96); check(noise.recv(bytes).length === 0);
      this.#verifyPeer();
      const msg3 = noise.send(); check(noise.complete); this.#ciphers();
      this.#enqueue(msg3);
      const plain = Buffer.from(JSON.stringify({ kind: 'accepted', scope: this.session.scope }));
      try { this.#acceptedSeq = this.#enqueue(this.#tx.encrypt(plain)); } finally { plain.fill(0); }
      this.#stage = 'transport';
    } else if (this.#stage === 'm3') {
      check(bytes.length === 64); check(noise.recv(bytes).length === 0 && noise.complete);
      this.#verifyPeer(); this.#ciphers(); this.#stage = 'transport';
    } else {
      const plain = this.#rx.decrypt(bytes); let payload;
      try { payload = JSON.parse(plain.toString('utf8')); } finally { plain.fill(0); }
      if (!this.#initiator && !this.#acceptedSeen) {
        check(exact(payload, 'kind,scope') && payload.kind === 'accepted' && payload.scope === this.session.scope);
        this.#acceptedSeen = true; state.accepted = true;
      } else {
        check(exact(payload, 'kind,value') && payload.kind === 'data'); state.values.push(payload.value);
      }
    }
  }
  // Caller invokes this ONLY after local approval of peer fingerprint and scope.
  async accept() {
    this.#assert(); check(this.#initiator && !this.#failed);
    await this.peer.store.request('POST', this.#path('accept'), '{}'); this.#acceptPosted = true;
    if (!this.#msg1Queued) { this.#enqueue(this.#noise.send()); this.#msg1Queued = true; }
    await this.#flush();
  }
  async send(value) {
    this.#assert(); check(this.ready && this.#outbox.length === 0 && !this.#flushing);
    const plain = Buffer.from(JSON.stringify({ kind: 'data', value })); 
    try { check(plain.length <= MAX_PLAIN); this.#enqueue(this.#tx.encrypt(plain)); } finally { plain.fill(0); }
    await this.#flush();
  }
  async retry() { return this.#flush(); }
  async receive() {
    this.#assert(); check(!this.#receiving && !this.#failed); this.#receiving = true;
    try {
      if (this.#delivery) { const values = await this.#acknowledge(); await this.#flush(); return values; }
      await this.#flush();
      const result = await this.peer.store.request('GET', `${this.#path('messages')}?after=${this.#received}`);
      check(Array.isArray(result.messages) && result.messages.length <= 32);
      if (!result.messages.length) return [];
      const state = { values: [], accepted: false }; let sequence = this.#received;
      try {
        for (const message of result.messages) { this.#process(message, sequence, state); sequence = message.sequence; }
      } catch (error) { this.#failed = true; throw error; }
      // Retain the decrypted batch until an idempotent ACK succeeds, including when
      // the first ACK reached the server but its reply was lost.
      this.#delivery = { values: state.values, sequence, accepted: state.accepted };
      const values = await this.#acknowledge(); await this.#flush(); return values;
    } finally { this.#receiving = false; }
  }
  async #acknowledge() {
    const { values, sequence, accepted } = this.#delivery;
    const ack = await this.peer.store.request('POST', this.#path('ack'), JSON.stringify({ through: sequence }));
    this.#assert(); check(ack.through === sequence); this.#received = sequence;
    if (accepted) this.#acceptedAcked = true;
    this.#delivery = null; return values;
  }
  async close() {
    try { if (!this.#closed) await this.peer.store.request('DELETE', `/v1/rendezvous/sessions/${this.session.id}`); }
    finally { this.dispose(); }
  }
  dispose() {
    this.#closed = true;
    const wipe = fn => { try { fn(); } catch { /* best effort */ } };
    wipe(() => this.#tx?._clear()); wipe(() => this.#rx?._clear()); this.#tx = null; this.#rx = null;
    wipe(() => this.#keys.secretKey.fill(0));
    if (!this.#noise.complete) {
      wipe(() => this.#noise.e?.secretKey?.fill(0)); wipe(() => this.#noise.key?.fill(0));
      wipe(() => this.#noise.chainingKey?.fill(0)); wipe(() => this.#noise.digest?.fill(0));
    }
    this.#outbox = []; this.#delivery = null;
  }
  get ready() {
    return !this.#closed && !this.#failed && performance.now() < this.deadline && this.#noise.complete && this.#outbox.length === 0
      && (this.#initiator ? this.#acceptedSeq !== null && this.#sent >= this.#acceptedSeq : this.#acceptedAcked);
  }
}
