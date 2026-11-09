// Reference signaling client. OS capture/input and unattended access are not enabled.
import { createCipheriv, createDecipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import { deviceId, registrationProof } from './rendezvous.mjs';
import { performance } from 'node:perf_hooks';
const check = ok => { if (!ok) throw Error('Rendezvous peer verification failed'); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
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
  channel(session, peerPublicKey, expectedFingerprint, scope) {
    if (session.from === this.identity.id) {
      const expected = this.#requests.get(session.id);
      check(expected && expected.target === session.to && expected.scope === scope && expected.nonce === session.nonce);
      // Every request can construct only one local channel; it cannot be replayed
      // by returning an old server session after reconnecting or restarting.
    }
    const channel = new RendezvousChannel(this, session, peerPublicKey, expectedFingerprint, scope);
    this.#requests.delete(session.id); return channel;
  }
  async unregister() { return this.store.request('DELETE', '/v1/rendezvous/devices'); }
}
class RendezvousChannel {
  #send = 0; #received = 0; #ready = false; #closed = false; #pending = null; #sending = false; #receiving = false; #key; #delivery = null; #accepting = null;
  constructor(peer, session, peerPublicKey, fingerprint, scope) {
    check(hex(session.id) && hex(session.nonce) && hex(peer.store.info.serverId) && hex(session.from) && hex(session.to) && session.from !== session.to);
    check(['view', 'control'].includes(scope) && session.scope === scope && ['pending', 'active'].includes(session.state));
    check(deviceId(peerPublicKey) === fingerprint && fingerprint !== peer.identity.id);
    check([session.from, session.to].includes(peer.identity.id) && (session.from === peer.identity.id ? fingerprint === session.to : fingerprint === session.from));
    this.peer = peer; this.session = Object.freeze({ id: session.id, from: session.from, to: session.to, nonce: session.nonce, scope }); this.other = fingerprint;
    this.deadline = performance.now() + 300_000;
    const secret = diffieHellman({ privateKey: peer.identity.privateKey, publicKey: createPublicKey({ key: Buffer.from(peerPublicKey, 'base64'), type: 'spki', format: 'der' }) });
    try { this.#key = Buffer.from(hkdfSync('sha256', secret, Buffer.from(peer.store.info.serverId, 'hex'), Buffer.from(JSON.stringify(['shellherd-rendezvous-e2ee-v1', this.session])), 32)); }
    finally { secret.fill(0); }
  }
  #assert() { check(!this.#closed && performance.now() < this.deadline); }
  #trafficKey(key, nonce) { check(hex(nonce)); return Buffer.from(hkdfSync('sha256', key, Buffer.from(nonce, 'hex'), Buffer.from('shellherd-rendezvous-traffic-v1'), 32)); }
  #context(from, to, sequence) { return Buffer.from(JSON.stringify(['shellherd-rendezvous-frame-v1', this.peer.store.info.serverId, this.session, from, to, sequence])); }
  async #frame(payload) {
    this.#assert(); check(!this.#sending && !this.#pending && this.#send < 0xffffffff);
    const plain = Buffer.from(JSON.stringify(payload)); check(plain.length <= 8192);
    const sequence = this.#send + 1; const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.#key, nonce);
    cipher.setAAD(this.#context(this.peer.identity.id, this.other, sequence));
    try {
      this.#pending = { sequence, nonce: nonce.toString('base64'), ciphertext: Buffer.concat([cipher.update(plain), cipher.final()]).toString('base64'), tag: cipher.getAuthTag().toString('base64') };
    } finally { plain.fill(0); }
    return this.retry();
  }
  async retry() {
    this.#assert(); check(this.#pending && !this.#sending); this.#sending = true;
    try {
      const result = await this.peer.store.request('POST', `/v1/rendezvous/sessions/${this.session.id}/messages`, JSON.stringify(this.#pending));
      this.#assert();
      check(result.sequence === this.#pending.sequence); this.#send = result.sequence; this.#pending = null;
      if (this.#accepting) { const key = this.#trafficKey(this.#key, this.#accepting); this.#key.fill(0); this.#key = key; this.#ready = true; this.#accepting = null; }
    } finally { this.#sending = false; }
  }
  // Caller invokes this ONLY after local approval of peer fingerprint and scope.
  async accept() {
    this.#assert(); check(this.peer.identity.id === this.session.to && !this.#ready && !this.#pending && !this.#accepting);
    this.#accepting = randomBytes(32).toString('hex');
    try {
      await this.peer.store.request('POST', `/v1/rendezvous/sessions/${this.session.id}/accept`, '{}');
      await this.#frame({ kind: 'accepted', scope: this.session.scope, nonce: this.#accepting });
    } catch (error) { if (!this.#pending) this.#accepting = null; throw error; }
  }
  async send(value) { this.#assert(); check(this.#ready); return this.#frame({ kind: 'data', value }); }
  async receive() {
    this.#assert(); check(!this.#receiving); this.#receiving = true;
    try {
      if (this.#delivery) return await this.#acknowledge();
      const result = await this.peer.store.request('GET', `/v1/rendezvous/sessions/${this.session.id}/messages?after=${this.#received}`);
      check(Array.isArray(result.messages) && result.messages.length <= 32);
      const values = []; let sequence = this.#received; let ready = this.#ready; let trafficKey = null;
      for (const message of result.messages) {
        check(message.sequence === sequence + 1);
        const decipher = createDecipheriv('aes-256-gcm', trafficKey ?? this.#key, Buffer.from(message.nonce, 'base64'));
        decipher.setAAD(this.#context(this.other, this.peer.identity.id, message.sequence)); decipher.setAuthTag(Buffer.from(message.tag, 'base64'));
        const plain = Buffer.concat([decipher.update(Buffer.from(message.ciphertext, 'base64')), decipher.final()]);
        let payload; try { check(plain.length <= 8192); payload = JSON.parse(plain.toString('utf8')); } finally { plain.fill(0); }
        if (!ready) {
          check(this.peer.identity.id === this.session.from && payload.kind === 'accepted' && payload.scope === this.session.scope);
          trafficKey = this.#trafficKey(this.#key, payload.nonce); ready = true;
        } else { check(payload.kind === 'data'); values.push(payload.value); }
        sequence = message.sequence;
      }
      // Retain a decrypted batch locally until an idempotent ACK succeeds,
      // including when the first ACK reached the server but its reply was lost.
      if (sequence > this.#received) {
        this.#delivery = { values, sequence, ready, trafficKey }; return await this.#acknowledge();
      }
      return values;
    } finally { this.#receiving = false; }
  }
  async #acknowledge() {
    const { values, sequence, ready, trafficKey } = this.#delivery;
    const ack = await this.peer.store.request('POST', `/v1/rendezvous/sessions/${this.session.id}/ack`, JSON.stringify({ through: sequence }));
    this.#assert(); check(ack.through === sequence); this.#received = sequence; this.#ready = ready;
    if (trafficKey) { this.#key.fill(0); this.#key = trafficKey; }
    this.#delivery = null; return values;
  }
  async close() {
    try { if (!this.#closed) await this.peer.store.request('DELETE', `/v1/rendezvous/sessions/${this.session.id}`); }
    finally { this.dispose(); }
  }
  dispose() { this.#closed = true; this.#ready = false; this.#pending = null; this.#delivery?.trafficKey?.fill(0); this.#delivery = null; this.#key.fill(0); }
  get ready() { return this.#ready && !this.#closed && performance.now() < this.deadline; }
}
