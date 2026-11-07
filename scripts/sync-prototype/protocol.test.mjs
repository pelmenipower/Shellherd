import { describe, expect, it } from 'vitest';
import { Authority, Client, OpaqueStore, consolidate, device } from './protocol.mjs';

function setup() {
  const authority = new Authority('test-vault');
  const alice = device('alice'); const bob = device('bob');
  const membership = authority.setMembers([alice, bob]);
  let now = 0;
  const a = new Client(alice, authority.publicKey, 'test-vault', () => now);
  const b = new Client(bob, authority.publicKey, 'test-vault', () => now);
  a.useMembership(membership); b.useMembership(membership);
  const store = new OpaqueStore();
  const publish = (client, wire) => {
    const challenge = client.beginPublication(wire);
    return store.put(client.finishPublication(wire, authority.authorize(wire, challenge)));
  };
  return { authority, alice, bob, membership, a, b, store, publish, advance: n => { now += n; } };
}

describe('isolated E2EE snapshot prototype', () => {
  it('consolidates independent offline changes and encrypts the merge for both devices', () => {
    const { a, b, store, publish } = setup();
    const base = { api: { host: 'api.internal', password: 'SECRET_BASE' }, db: { host: 'db.internal', password: 'SECRET_DB' } };
    const rootWire = a.snapshot(base); const root = publish(a, rootWire);
    b.receive(store.get(root));
    const left = structuredClone(base); left.api.password = 'SECRET_ALICE';
    const right = structuredClone(base); right.db.password = 'SECRET_BOB';
    const lWire = a.snapshot(left); const rWire = b.snapshot(right);
    const l = publish(a, lWire); const r = publish(b, rWire);
    a.receive(store.get(r)); b.receive(store.get(l));
    expect(a.heads).toEqual(b.heads);
    expect(a.heads).toHaveLength(2);
    const merge = consolidate(a.value(root), a.value(l), a.value(r));
    expect(merge.conflicts).toEqual([]);
    expect(merge.records.api.password).toBe('SECRET_ALICE');
    expect(merge.records.db.password).toBe('SECRET_BOB');
    const finalWire = a.snapshot(merge.records); const final = publish(a, finalWire);
    b.receive(store.get(final));
    expect(b.value(final)).toEqual(merge.records);
    expect(b.heads).toEqual([final]);
    for (const marker of ['SECRET_', 'api.internal', 'db.internal']) expect(store.dump()).not.toContain(marker);
  });

  it('keeps both credential alternatives and delete-versus-edit conflicts', () => {
    const base = { api: { password: 'old' } };
    const result = consolidate(base, { api: { password: 'one' } }, { api: { password: 'two' } });
    expect(Object.keys(result.records)).toEqual([]);
    expect(result.conflicts).toEqual([{ id: 'api', base: base.api, left: { password: 'one' }, right: { password: 'two' } }]);
    expect(consolidate(base, {}, { api: { password: 'new' } }).conflicts).toHaveLength(1);
    expect(consolidate(base, {}, base)).toEqual({ records: {}, conflicts: [] });
  });

  it('rejects tampering with ciphertext, header, recipient packets, signature or encoding', () => {
    const { a, b } = setup(); const wire = a.snapshot({ api: { password: 'secret' } });
    const mutate = fn => { const v = JSON.parse(wire); fn(v); return JSON.stringify(v); };
    for (const bad of [
      mutate(v => { v[0][1] = 'other-vault'; }),
      mutate(v => { v[0][3] = 'bob'; }),
      mutate(v => { v[1][0][2] = v[1][1][2]; }),
      mutate(v => { v[3] = (v[3][0] === 'A' ? 'B' : 'A') + v[3].slice(1); }),
      mutate(v => { v[4] = (v[4][0] === 'A' ? 'B' : 'A') + v[4].slice(1); }),
      ' ' + wire, 'x'.repeat(1024 * 1024 + 1),
    ]) expect(() => b.receive(bad)).toThrow();
    expect(b.heads).toEqual([]);
  });

  it('rejects impostor devices, altered membership and authority substitution', () => {
    const { a, authority, membership } = setup();
    const changed = structuredClone(membership); changed[0][3][0][1] = device('impostor').public[1];
    expect(() => a.useMembership(changed)).toThrow();
    const stranger = new Client(device('stranger'), authority.publicKey, 'test-vault');
    expect(() => stranger.useMembership(membership)).toThrow();
    const other = new Authority('test-vault');
    expect(() => a.useMembership(other.setMembers([device('alice')]))).toThrow();
  });

  it('requires ancestry, preserves concurrent branches and detects known rollback', () => {
    const { a, b } = setup();
    const root = a.snapshot({ api: { password: 'old' } });
    const child = a.snapshot({ api: { password: 'new' } });
    expect(() => b.receive(child)).toThrow('Missing ancestry');
    const rootId = b.receive(root); const childId = b.receive(child);
    expect(b.receive(root)).toBe(rootId);
    expect(b.heads).toEqual([childId]);
    expect(() => b.assertServerHeads([rootId])).toThrow('omitted');
    expect(() => b.assertServerHeads([])).toThrow('omitted');
    b.assertServerHeads([childId]);
    expect(() => b.snapshot({}, ['missing'])).toThrow();
  });

  it('binds publication to exact object and challenge, consumes permits and expires them', () => {
    const { a, authority, advance } = setup();
    const wire = a.snapshot({ api: { password: 'secret' } });
    const c = a.beginPublication(wire); const permit = authority.authorize(wire, c);
    expect(a.finishPublication(wire, permit)).toBe(wire);
    expect(() => a.finishPublication(wire, permit)).toThrow('consumed');
    const c2 = a.beginPublication(wire); const p2 = authority.authorize(wire, c2);
    advance(300_000);
    expect(() => a.finishPublication(wire, p2)).toThrow('Expired');
    const other = a.snapshot({ api: { password: 'other' } });
    const c3 = a.beginPublication(wire); const p3 = authority.authorize(wire, c3);
    expect(() => a.finishPublication(other, p3)).toThrow('binding');
  });

  it('revokes old publications and reencrypts new versions without the removed device', () => {
    const { a, b, alice, authority, membership } = setup();
    const oldWire = a.snapshot({ api: { password: 'old' } }); b.receive(oldWire);
    const challenge = a.beginPublication(oldWire); const pending = authority.authorize(oldWire, challenge);
    const next = authority.setMembers([alice]); a.useMembership(next);
    expect(() => a.finishPublication(oldWire, pending)).toThrow();
    expect(() => a.useMembership(membership)).toThrow('rollback');
    expect(() => b.useMembership(next)).toThrow('removed');
    expect(() => authority.authorize(oldWire, challenge)).toThrow();
    const fresh = a.snapshot({ api: { password: 'rotated' } });
    expect(JSON.parse(fresh)[1].map(r => r[0])).toEqual(['alice']);
    expect(() => b.receive(fresh)).toThrow();
  });

  it('does not reuse encryption keys/nonces and a fresh process cannot reuse publication permits', () => {
    const { a, alice, authority, membership } = setup();
    const one = a.snapshot({ api: { password: 'same' } }, []);
    const two = a.snapshot({ api: { password: 'same' } }, []);
    expect(JSON.parse(one)[2]).not.toBe(JSON.parse(two)[2]);
    expect(JSON.parse(one)[3]).not.toBe(JSON.parse(two)[3]);
    const nonce = a.beginPublication(one); const permit = authority.authorize(one, nonce);
    const restarted = new Client(alice, authority.publicKey, 'test-vault'); restarted.useMembership(membership);
    expect(() => restarted.finishPublication(one, permit)).toThrow();
  });

  it('rejects forged publication signatures and rewritten membership epochs', () => {
    const { a, alice, authority } = setup();
    const wire = a.snapshot({ api: { password: 'secret' } });
    const challenge = a.beginPublication(wire);
    const permit = authority.authorize(wire, challenge);
    permit[1] = (permit[1][0] === 'A' ? 'B' : 'A') + permit[1].slice(1);
    expect(() => a.finishPublication(wire, permit)).toThrow();
    // Rewriting the epoch of a legitimately issued document invalidates its signature.
    const root2 = new Authority('fork-test');
    const c = new Client(alice, root2.publicKey, 'fork-test');
    c.useMembership(root2.setMembers([alice]));
    const forked = root2.setMembers([alice, device('extra')]);
    forked[0][2] = 1;
    expect(() => c.useMembership(forked)).toThrow();
  });

  it('bounds pending requests, concurrent branches and stored objects', () => {
    const { a, b } = setup();
    const wire = a.snapshot({ api: { password: 'secret' } });
    for (let i = 0; i < 16; i++) a.beginPublication(wire);
    expect(() => a.beginPublication(wire)).toThrow('limit');
    for (let i = 0; i < 15; i++) a.snapshot({}, []);
    expect(() => a.snapshot({}, [])).toThrow('head limit');
    // A linear history remains bounded too, even with no concurrent heads.
    b.receive(wire);
    for (let i = 0; i < 99; i++) b.snapshot({ item: { value: i } });
    expect(() => b.snapshot({})).toThrow('quota');
  });
});
