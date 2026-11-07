// Test-data-only application binding around an existing Noise implementation.
import Noise from 'noise-handshake';
import Cipher from 'noise-handshake/cipher.js';
import sodium from 'libsodium-wrappers';
import { performance } from 'node:perf_hooks';
await sodium.ready;

export const PAIRING_PROFILE = 'Noise_XX_25519_ChaChaPoly_BLAKE2b';
const LIMIT = 16_384;
const encode = value => JSON.stringify(value);
const b64 = value => sodium.to_base64(value, sodium.base64_variants.ORIGINAL);
const check = (ok, message) => { if (!ok) throw Error(message); };
function un64(value, length) {
  check(typeof value === 'string' && value.length < 256, 'Invalid key encoding');
  const result = sodium.from_base64(value, sodium.base64_variants.ORIGINAL);
  check(result.length === length && b64(result) === value, 'Invalid key length');
  return result;
}
function parse(buffer) {
  check(Buffer.isBuffer(buffer) && buffer.length <= LIMIT, 'Pairing frame size');
  const text = buffer.toString('utf8'); const value = JSON.parse(text);
  check(encode(value) === text, 'Noncanonical pairing frame'); return value;
}

export function invitationId() { return sodium.to_hex(sodium.randombytes_buf(32)); }

export class Pairing {
  #noise;
  #identity;
  #clock;
  #start;
  #turn;
  #steps = 0;
  #send;
  #recv;
  #localClaim;
  #remoteClaim;
  #claimSent = false;
  #confirmed = false;
  #remoteConfirmed = false;
  #closed = false;
  #sent = 0;
  #received = 0;
  #context;
  #invite;
  #role;
  #root;
  constructor({ identity, initiator, context, invitation, authorityKey = null, clock = () => performance.now() }) {
    check(typeof initiator === 'boolean', 'Pairing role');
    check(typeof context === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(context), 'Pairing context');
    check(typeof invitation === 'string' && /^[a-f0-9]{64}$/.test(invitation), 'Invitation ID');
    check(Array.isArray(identity.public) && identity.public.length === 3, 'Device identity');
    if (initiator) un64(authorityKey, 32);
    else check(authorityKey === null, 'Joiner cannot supply authority');
    this.#identity = identity;
    this.#role = initiator ? 'admin' : 'joiner';
    this.#root = authorityKey; this.#context = context; this.#invite = invitation;
    this.#clock = clock; this.#start = clock();
    this.#noise = new Noise('XX', initiator);
    check(this.#noise.protocol.toString() === PAIRING_PROFILE, 'Noise profile mismatch');
    this.#noise.initialise(Buffer.from(encode(['shellherd-lab-pair-v1', PAIRING_PROFILE, context, invitation])));
    this.#turn = initiator ? 'send' : 'receive';
  }
  #run(action) {
    check(!this.#closed, 'Pairing closed');
    try {
      const elapsed = this.#clock() - this.#start;
      check(elapsed >= 0 && elapsed < 300_000, 'Pairing expired');
      return action();
    } catch (error) { this.close(); throw error; }
  }
  #complete() {
    if (!this.#noise.complete) return;
    // Library source and independent vector tests establish these directions.
    this.#send = new Cipher(this.#noise.tx);
    this.#recv = new Cipher(this.#noise.rx);
    const body = ['shellherd-lab-identity-v1', PAIRING_PROFILE, this.#context, this.#invite,
      b64(this.#noise.hash), this.#role, [...this.#identity.public], b64(this.#noise.s.publicKey), this.#root];
    this.#localClaim = [body, b64(sodium.crypto_sign_detached(encode(body), this.#identity.signing.privateKey))];
  }
  sendHandshake() {
    return this.#run(() => {
      check(this.#turn === 'send' && this.#steps < 3, 'Handshake order');
      // No application data, even encrypted, is allowed in the handshake.
      const frame = Buffer.from(this.#noise.send());
      this.#steps++; this.#turn = 'receive'; this.#complete(); return frame;
    });
  }
  receiveHandshake(frame) {
    return this.#run(() => {
      check(this.#turn === 'receive' && this.#steps < 3, 'Handshake order');
      check(Buffer.isBuffer(frame) && frame.length <= 512, 'Handshake frame size');
      const payload = this.#noise.recv(Buffer.from(frame));
      check(payload.length === 0, 'Handshake payload forbidden');
      this.#steps++; this.#turn = 'send'; this.#complete();
    });
  }
  #encrypt(value) {
    const plain = Buffer.from(encode(value));
    try {
      check(this.#sent < 1000 && plain.length <= LIMIT - 16, 'Pairing send limit');
      const frame = Buffer.from(this.#send.encrypt(plain)); this.#sent++; return frame;
    } finally { plain.fill(0); }
  }
  #decrypt(frame) {
    check(Buffer.isBuffer(frame) && frame.length >= 16 && frame.length <= LIMIT && this.#received < 1000, 'Pairing receive limit');
    const plain = this.#recv.decrypt(frame);
    try { this.#received++; return parse(plain); } finally { plain.fill(0); }
  }
  sendIdentity() {
    return this.#run(() => {
      check(this.#noise.complete && !this.#claimSent, 'Identity order');
      this.#claimSent = true; return this.#encrypt(this.#localClaim);
    });
  }
  receiveIdentity(frame) {
    return this.#run(() => {
      check(this.#noise.complete && !this.#remoteClaim, 'Identity order');
      const claim = this.#decrypt(frame);
      check(Array.isArray(claim) && claim.length === 2, 'Identity schema');
      const [body, signature] = claim;
      check(Array.isArray(body) && body.length === 9, 'Identity body');
      check(body[0] === 'shellherd-lab-identity-v1' && body[1] === PAIRING_PROFILE && body[2] === this.#context && body[3] === this.#invite && body[4] === b64(this.#noise.hash), 'Identity channel binding');
      check(body[5] === (this.#role === 'admin' ? 'joiner' : 'admin'), 'Identity role');
      const member = body[6];
      check(Array.isArray(member) && member.length === 3 && typeof member[0] === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(member[0]) && member[0] !== this.#identity.id, 'Identity device');
      un64(member[1], 32); un64(member[2], 32);
      check(body[7] === b64(this.#noise.rs), 'Identity Noise key');
      if (body[5] === 'admin') un64(body[8], 32);
      else check(body[8] === null, 'Identity authority');
      check(sodium.crypto_sign_verify_detached(un64(signature, 64), encode(body), un64(member[1], 32)), 'Identity signature');
      this.#remoteClaim = claim;
    });
  }
  #fingerprint() {
    check(this.#claimSent && this.#remoteClaim, 'Identities not exchanged');
    const ordered = this.#role === 'admin' ? [this.#localClaim, this.#remoteClaim] : [this.#remoteClaim, this.#localClaim];
    return sodium.to_hex(sodium.crypto_generichash(32, encode(['shellherd-lab-compare-v1', ...ordered])));
  }
  fingerprint() { return this.#run(() => this.#fingerprint()); }
  confirm(independentlyComparedFingerprint) {
    return this.#run(() => {
      check(!this.#confirmed, 'Already confirmed');
      const fingerprint = this.#fingerprint();
      check(typeof independentlyComparedFingerprint === 'string' && independentlyComparedFingerprint === fingerprint, 'Fingerprint mismatch');
      this.#confirmed = true;
      return this.#encrypt(['shellherd-lab-confirm-v1', fingerprint]);
    });
  }
  receiveConfirmation(frame) {
    return this.#run(() => {
      check(!this.#remoteConfirmed, 'Already confirmed by remote');
      const value = this.#decrypt(frame);
      check(Array.isArray(value) && value.length === 2 && value[0] === 'shellherd-lab-confirm-v1' && value[1] === this.#fingerprint(), 'Confirmation binding');
      this.#remoteConfirmed = true;
    });
  }
  get ready() { return !this.#closed && this.#confirmed && this.#remoteConfirmed && this.#clock() - this.#start >= 0 && this.#clock() - this.#start < 300_000; }
  peer() {
    return this.#run(() => {
      check(this.ready, 'Both confirmations required');
      return { device: [...this.#remoteClaim[0][6]], authorityKey: this.#role === 'admin' ? this.#root : this.#remoteClaim[0][8] };
    });
  }
  enrollment() {
    return this.#run(() => {
      check(this.#role === 'admin' && this.ready, 'Verified admin enrollment required');
      return { invitation: this.#invite, context: this.#context, ...this.peer() };
    });
  }
  send(value) {
    return this.#run(() => { check(this.ready, 'Both confirmations required'); return this.#encrypt(['shellherd-lab-data-v1', value]); });
  }
  receive(frame) {
    return this.#run(() => {
      check(this.ready, 'Both confirmations required');
      const value = this.#decrypt(frame);
      check(Array.isArray(value) && value.length === 2 && value[0] === 'shellherd-lab-data-v1', 'Data frame type'); return value[1];
    });
  }
  close() {
    this.#closed = true;
    for (const state of [this.#noise, this.#send, this.#recv]) {
      if (!state) continue;
      for (const key of ['key', 'tx', 'rx', 'chainingKey']) state[key]?.fill(0);
    }
    this.#noise?.s?.secretKey.fill(0); this.#noise?.e?.secretKey.fill(0);
  }
}

// Owned by the existing device. Never trust a server-side "already used" flag.
// The registry is intentionally in memory; restart invalidates all invitations.
export class PairingInvitations {
  #active = new Map();
  #clock;
  #context;
  #authorityKey;
  constructor(context, authorityKey, clock = () => performance.now()) {
    un64(authorityKey, 32);
    this.#context = context; this.#authorityKey = authorityKey; this.#clock = clock;
  }
  create() {
    const now = this.#clock();
    for (const [id, start] of this.#active) if (now - start < 0 || now - start >= 300_000) this.#active.delete(id);
    check(this.#active.size < 16, 'Invitation limit');
    const id = invitationId(); this.#active.set(id, now); return id;
  }
  consume(pairing) {
    const result = pairing.enrollment();
    check(result.context === this.#context && result.authorityKey === this.#authorityKey, 'Invitation authority binding');
    const start = this.#active.get(result.invitation);
    check(start !== undefined, 'Unknown or used invitation');
    this.#active.delete(result.invitation);
    const elapsed = this.#clock() - start;
    check(elapsed >= 0 && elapsed < 300_000, 'Invitation expired');
    return result.device;
  }
}
