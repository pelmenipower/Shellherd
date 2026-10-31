import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Noise from 'noise-handshake';
import Cipher from 'noise-handshake/cipher.js';
import curve from 'noise-handshake/dh.js';
import sodium from 'libsodium-wrappers';
import { Authority, Client, device } from './protocol.mjs';
import { Pairing, PairingInvitations, invitationId, PAIRING_PROFILE } from './pairing.mjs';

function handshake(a, b) {
  b.receiveHandshake(a.sendHandshake());
  a.receiveHandshake(b.sendHandshake());
  b.receiveHandshake(a.sendHandshake());
}
function claims(a, b) {
  const ac = a.sendIdentity(); const bc = b.sendIdentity();
  a.receiveIdentity(bc); b.receiveIdentity(ac);
}
function confirm(a, b) {
  const af = a.fingerprint(); const bf = b.fingerprint();
  const ac = a.confirm(bf); const bc = b.confirm(af);
  a.receiveConfirmation(bc); b.receiveConfirmation(ac);
}
function pair(clock) {
  const authority = new Authority('pair-vault');
  const alice = device('alice'); const bob = device('bob');
  const invitation = invitationId();
  const a = new Pairing({ identity: alice, initiator: true, authorityKey: authority.publicKey, context: 'pair-vault', invitation, clock });
  const b = new Pairing({ identity: bob, initiator: false, context: 'pair-vault', invitation, clock });
  return { a, b, alice, bob, authority, invitation };
}

describe('verified Noise pairing experiment', () => {
  it('matches independent Noise-C handshake, hash and bidirectional transport vectors', () => {
    const vector = JSON.parse(readFileSync(new URL('./fixtures/noise-c-xx.json', import.meta.url), 'utf8'));
    expect(vector.name).toBe(PAIRING_PROFILE);
    const hex = value => Buffer.from(value, 'hex');
    const a = new Noise('XX', true, curve.generateKeyPair(hex(vector.init_static)));
    const b = new Noise('XX', false, curve.generateKeyPair(hex(vector.resp_static)));
    a.e = curve.generateKeyPair(hex(vector.init_ephemeral)); b.e = curve.generateKeyPair(hex(vector.resp_ephemeral));
    a.initialise(hex(vector.init_prologue)); b.initialise(hex(vector.resp_prologue));
    vector.messages.slice(0, 3).forEach((v, index) => {
      const [sender, receiver] = index % 2 ? [b, a] : [a, b];
      const frame = sender.send(hex(v.payload));
      expect(frame.toString('hex')).toBe(v.ciphertext);
      expect(receiver.recv(frame).toString('hex')).toBe(v.payload);
    });
    expect(a.hash.toString('hex')).toBe(vector.handshake_hash);
    expect(b.hash.toString('hex')).toBe(vector.handshake_hash);
    const at = new Cipher(a.tx); const ar = new Cipher(a.rx);
    const bt = new Cipher(b.tx); const br = new Cipher(b.rx);
    vector.messages.slice(3).forEach((v, index) => {
      const [send, recv] = index % 2 ? [at, br] : [bt, ar];
      const frame = send.encrypt(hex(v.payload));
      expect(frame.toString('hex')).toBe(v.ciphertext);
      expect(recv.decrypt(frame).toString('hex')).toBe(v.payload);
    });
  });

  it('binds both device identities and root, confirms both sides, then transfers membership and encrypted snapshots', () => {
    const { a, b, alice, bob, authority } = pair();
    try {
      handshake(a, b); claims(a, b);
      expect(a.fingerprint()).toBe(b.fingerprint());
      expect(a.ready).toBe(false); expect(b.ready).toBe(false);
      confirm(a, b);
      expect(a.peer().device).toEqual(bob.public);
      expect(b.peer().device).toEqual(alice.public);
      expect(b.peer().authorityKey).toBe(authority.publicKey);
      const membership = authority.setMembers([alice, { public: a.peer().device }]);
      const enrolled = b.receive(a.send(membership));
      const first = new Client(alice, authority.publicKey, 'pair-vault'); first.useMembership(membership);
      const second = new Client(bob, b.peer().authorityKey, 'pair-vault'); second.useMembership(enrolled);
      const wire = first.snapshot({ api: { password: 'PAIRING_SECRET_MARKER' } });
      const frame = a.send(wire);
      expect(frame.includes(Buffer.from('PAIRING_SECRET_MARKER'))).toBe(false);
      const id = second.receive(b.receive(frame));
      expect(second.value(id).api.password).toBe('PAIRING_SECRET_MARKER');
      expect(a.receive(b.send({ received: true }))).toEqual({ received: true });
    } finally { a.close(); b.close(); alice.destroy(); bob.destroy(); authority.destroy(); }
  });

  it('never releases application data or peer trust before BOTH confirmations', () => {
    for (const stage of ['before-handshake', 'after-handshake', 'after-claims', 'local-only', 'remote-only']) {
      const { a, b } = pair();
      if (stage !== 'before-handshake') handshake(a, b);
      if (['after-claims', 'local-only', 'remote-only'].includes(stage)) claims(a, b);
      if (stage === 'local-only') a.confirm(b.fingerprint());
      if (stage === 'remote-only') a.receiveConfirmation(b.confirm(a.fingerprint()));
      expect(a.ready).toBe(false);
      expect(() => a.send('DO_NOT_RELEASE')).toThrow('confirmations');
      expect(() => a.peer()).toThrow('closed'); b.close();
    }
  });

  it('detects a relay terminating and reestablishing two different Noise channels', () => {
    const { a, b, invitation, authority } = pair();
    const mallory = device('mallory');
    const ma = new Pairing({ identity: mallory, initiator: false, context: 'pair-vault', invitation });
    const mb = new Pairing({ identity: mallory, initiator: true, authorityKey: authority.publicKey, context: 'pair-vault', invitation });
    handshake(a, ma); handshake(mb, b); claims(a, ma); claims(mb, b);
    expect(a.fingerprint()).not.toBe(b.fingerprint());
    const af = a.fingerprint(); const bf = b.fingerprint();
    expect(() => a.confirm(bf)).toThrow('Fingerprint mismatch');
    expect(() => b.confirm(af)).toThrow('Fingerprint mismatch');
    expect(a.ready).toBe(false); expect(b.ready).toBe(false);
    ma.close(); mb.close(); mallory.destroy();
  });

  it('rejects mismatched contexts, invitations and handshake order', () => {
    const { a, b, bob } = pair();
    expect(() => b.sendHandshake()).toThrow('order');
    const other = new Pairing({ identity: bob, initiator: false, context: 'wrong-vault', invitation: invitationId() });
    other.receiveHandshake(a.sendHandshake());
    expect(() => a.receiveHandshake(other.sendHandshake())).toThrow();
    expect(a.ready).toBe(false); other.close();
  });

  it('rejects replayed or altered frames and permanently closes the affected attempt', () => {
    for (const mode of ['replay', 'tamper']) {
      const { a, b } = pair(); handshake(a, b); claims(a, b); confirm(a, b);
      const frame = a.send({ secret: 'fixture' });
      if (mode === 'replay') b.receive(frame);
      else frame[frame.length - 1] ^= 1;
      expect(() => b.receive(frame)).toThrow();
      expect(b.ready).toBe(false); expect(() => b.receive(a.send('next'))).toThrow('closed'); a.close();
    }
  });

  it('rejects identity replay from another attempt and duplicate confirmations', () => {
    const one = pair(); const two = pair(); handshake(one.a, one.b); handshake(two.a, two.b);
    const first = one.a.sendIdentity();
    expect(() => two.b.receiveIdentity(first)).toThrow();
    one.b.receiveIdentity(first); one.a.receiveIdentity(one.b.sendIdentity());
    const confirmation = one.a.confirm(one.b.fingerprint());
    one.b.receiveConfirmation(confirmation);
    one.a.receiveConfirmation(one.b.confirm(one.a.fingerprint()));
    expect(one.b.ready).toBe(true);
    expect(() => one.b.receiveConfirmation(confirmation)).toThrow('Already confirmed');
    one.a.close(); two.a.close();
  });

  it('expires invitations and limits handshake and application frame sizes', () => {
    let now = 0; const { a } = pair(() => now);
    now = 300_000;
    expect(() => a.sendHandshake()).toThrow('expired');
    const oversized = pair();
    expect(() => oversized.b.receiveHandshake(Buffer.alloc(513))).toThrow('size'); oversized.a.close();
    const data = pair(); handshake(data.a, data.b); claims(data.a, data.b); confirm(data.a, data.b);
    expect(() => data.a.send('x'.repeat(16_384))).toThrow('limit'); data.b.close();
  });

  it('consumes invitations locally once, rejects parallel reuse and invalidates them on restart', () => {
    const authority = new Authority('invite-vault'); const alice = device('alice'); const bob = device('bob');
    const registry = new PairingInvitations('invite-vault', authority.publicKey);
    const invitation = registry.create();
    const attempt = () => {
      const a = new Pairing({ identity: alice, initiator: true, context: 'invite-vault', invitation, authorityKey: authority.publicKey });
      const b = new Pairing({ identity: bob, initiator: false, context: 'invite-vault', invitation });
      handshake(a, b); claims(a, b); confirm(a, b); return { a, b };
    };
    const first = attempt(); const parallel = attempt();
    const restarted = new PairingInvitations('invite-vault', authority.publicKey);
    expect(() => restarted.consume(first.a)).toThrow('Unknown');
    expect(registry.consume(first.a)).toEqual(bob.public);
    expect(() => registry.consume(parallel.a)).toThrow('used');
    for (const p of [first, parallel]) { p.a.close(); p.b.close(); }
    authority.destroy(); alice.destroy(); bob.destroy();
  });

  it('rejects signed identity proofs with foreign transcript, static key, role or invalid signature', () => {
    const b64 = value => sodium.to_base64(value, sodium.base64_variants.ORIGINAL);
    for (const attack of ['transcript', 'static', 'role', 'signature']) {
      const { a, b, bob, invitation } = pair(); b.close();
      const raw = new Noise('XX', false);
      raw.initialise(Buffer.from(JSON.stringify(['shellherd-lab-pair-v1', PAIRING_PROFILE, 'pair-vault', invitation])));
      raw.recv(a.sendHandshake()); a.receiveHandshake(Buffer.from(raw.send())); raw.recv(a.sendHandshake());
      a.sendIdentity();
      const body = ['shellherd-lab-identity-v1', PAIRING_PROFILE, 'pair-vault', invitation,
        b64(raw.hash), 'joiner', bob.public, b64(raw.s.publicKey), null];
      if (attack === 'transcript') body[4] = b64(sodium.randombytes_buf(64));
      if (attack === 'static') body[7] = b64(sodium.randombytes_buf(32));
      if (attack === 'role') body[5] = 'admin';
      const signature = sodium.crypto_sign_detached(JSON.stringify(body), bob.signing.privateKey);
      if (attack === 'signature') signature[0] ^= 1;
      const transport = new Cipher(raw.tx);
      const frame = Buffer.from(transport.encrypt(Buffer.from(JSON.stringify([body, b64(signature)]))));
      expect(() => a.receiveIdentity(frame)).toThrow();
      expect(a.ready).toBe(false);
      raw.s.secretKey.fill(0); raw.tx.fill(0); raw.rx.fill(0);
    }
  });

  it('closes before the library transport counter can approach nonce reuse', () => {
    const { a, b } = pair(); handshake(a, b); claims(a, b); confirm(a, b);
    // Identity and confirmation already consumed two frames in each direction.
    for (let i = 0; i < 998; i++) expect(b.receive(a.send(i))).toBe(i);
    expect(() => a.send('over budget')).toThrow('limit');
    expect(a.ready).toBe(false); b.close();
  });

  it('limits outstanding invitations and rejects an expired invitation even in a newer valid handshake', () => {
    let now = 0;
    const authority = new Authority('ttl-vault'); const alice = device('alice'); const bob = device('bob');
    const registry = new PairingInvitations('ttl-vault', authority.publicKey, () => now);
    const invitation = registry.create();
    for (let i = 1; i < 16; i++) registry.create();
    expect(() => registry.create()).toThrow('limit');
    now = 299_999;
    const a = new Pairing({ identity: alice, initiator: true, context: 'ttl-vault', invitation, authorityKey: authority.publicKey, clock: () => now });
    const b = new Pairing({ identity: bob, initiator: false, context: 'ttl-vault', invitation, clock: () => now });
    handshake(a, b); claims(a, b); confirm(a, b);
    now = 300_000;
    expect(a.ready).toBe(true);
    expect(() => registry.consume(a)).toThrow('expired');
    expect(() => registry.create()).not.toThrow();
    a.close(); b.close(); alice.destroy(); bob.destroy(); authority.destroy();
  });
});
