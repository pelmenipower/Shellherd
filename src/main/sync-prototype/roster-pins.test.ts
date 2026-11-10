import { describe, expect, it } from 'vitest';
import { acknowledgePin, hintsOf, mergeRoster } from './roster-pins';
import type { RosterEntry } from './roster-pins';

const id = (n: number) => String(n).repeat(64);
const key = (n: number) => `${String(n).repeat(43)}=`;
const entry = (n: number, over: Partial<RosterEntry> = {}): RosterEntry => ({ id: id(n), name: `dev${n}`, signingKey: key(n), revokedAt: null, enrolledBy: null, ...over });
const pin = (n: number, over: Record<string, unknown> = {}) => ({ id: id(n), signingKey: key(n), revokedAt: null, enrolledBy: null, acknowledged: true, ...over });
const base = { selfId: id(1), invitesIssued: 0 };

describe('mergeRoster', () => {
  it('adopts everything silently without a snapshot or before the first pin time', () => {
    for (const snapshot of [undefined, { pins: [], at: null }]) {
      const r = mergeRoster({ ...base, snapshot, server: [entry(1), entry(2, { revokedAt: 5 })] });
      expect(r).toMatchObject({ ok: true, persist: true, newDevices: [], revived: [] });
      if (r.ok) { expect(r.pins.every(p => p.acknowledged)).toBe(true); expect(r.pins[1].revokedAt).toBe(5); }
    }
  });
  it('rejects a known id with another signing key and changes nothing', () => {
    expect(mergeRoster({ ...base, snapshot: { pins: [pin(1), pin(2)], at: 1 }, server: [entry(1), entry(2, { signingKey: key(9) })] })).toEqual({ ok: false });
  });
  it('flags a new device as unacknowledged and pins enrolledBy once', () => {
    const r = mergeRoster({ ...base, snapshot: { pins: [pin(1)], at: 1 }, server: [entry(1), entry(2, { enrolledBy: id(1) })] });
    expect(r.ok && r.newDevices).toEqual([{ id: id(2), name: 'dev2', enrolledVia: 'invite', invitedBy: 'dev1' }]);
    const again = mergeRoster({ ...base, snapshot: { pins: r.ok ? r.pins : [], at: 2 }, server: [entry(1), entry(2, { enrolledBy: id(3) })] });
    expect(again.ok && again.pins.find(p => p.id === id(2))?.enrolledBy).toBe(id(1));
  });
  it('omits invitedBy for an unknown issuer and calls password enrollment by its kind', () => {
    const r = mergeRoster({ ...base, snapshot: { pins: [pin(1)], at: 1 }, server: [entry(1), entry(2, { enrolledBy: id(7) }), entry(3)] });
    expect(r.ok && r.newDevices).toEqual([{ id: id(2), name: 'dev2', enrolledVia: 'invite' }, { id: id(3), name: 'dev3', enrolledVia: 'password' }]);
  });
  it('trusts an own invitation once per issued invite (E10)', () => {
    const r = mergeRoster({ selfId: id(1), invitesIssued: 1, snapshot: { pins: [pin(1)], at: 1 }, server: [entry(1), entry(2, { enrolledBy: id(1) }), entry(3, { enrolledBy: id(1) })] });
    expect(r.ok && r.invitesIssued).toBe(0);
    expect(r.ok && r.newDevices).toEqual([{ id: id(2), name: 'dev2', enrolledVia: 'invite', invitedBy: 'dev1', ownInvite: true }, { id: id(3), name: 'dev3', enrolledVia: 'invite', invitedBy: 'dev1' }]);
  });
  it('keeps vanished pins, but only revoked ones feed the author checks (B8, m1)', () => {
    const r = mergeRoster({ ...base, snapshot: { pins: [pin(1), pin(2, { revokedAt: 7 }), pin(3)], at: 1 }, server: [entry(1)] });
    expect(r.ok && r.pins.map(p => p.id)).toEqual([id(1), id(2), id(3)]);
    expect(r.ok && r.effective).toEqual([{ id: id(1), signingKey: key(1), revokedAt: null }, { id: id(2), signingKey: key(2), revokedAt: 7 }]);
    expect(r.ok && r.persist).toBe(false);
  });
  it('ends a key change after the device vanished and returned with the same id (m1)', () => {
    const gone = mergeRoster({ ...base, snapshot: { pins: [pin(1), pin(3)], at: 1 }, server: [entry(1)] });
    expect(mergeRoster({ ...base, snapshot: { pins: gone.ok ? gone.pins : [], at: 2 }, server: [entry(1), entry(3, { signingKey: key(9) })] })).toEqual({ ok: false });
    const same = mergeRoster({ ...base, snapshot: { pins: gone.ok ? gone.pins : [], at: 2 }, server: [entry(1), entry(3)] });
    expect(same.ok && same.newDevices).toEqual([]);
  });
  it('evicts vanished active pins before revoked ones at the 64 limit', () => {
    const many = Array.from({ length: 64 }, (_, i) => pin(i + 10, i < 2 ? { revokedAt: 5 } : {}));
    const r = mergeRoster({ ...base, snapshot: { pins: [pin(1), ...many.slice(0, 63)], at: 1 }, server: [entry(1), entry(2)] });
    expect(r.ok && r.pins).toHaveLength(64);
    expect(r.ok && r.pins.filter(p => p.revokedAt === 5)).toHaveLength(2);
    expect(r.ok && r.persist).toBe(true);
  });
  it('takes the earlier revokedAt of pin and server', () => {
    const early = mergeRoster({ ...base, snapshot: { pins: [pin(1), pin(2, { revokedAt: 5 })], at: 1 }, server: [entry(1), entry(2, { revokedAt: 9 })] });
    expect(early.ok && early.effective.find(e => e.id === id(2))?.revokedAt).toBe(5);
    const late = mergeRoster({ ...base, snapshot: { pins: [pin(1), pin(2, { revokedAt: 9 })], at: 1 }, server: [entry(1), entry(2, { revokedAt: 5 })] });
    expect(late.ok && late.effective.find(e => e.id === id(2))?.revokedAt).toBe(5);
    const fresh = mergeRoster({ ...base, snapshot: { pins: [pin(1), pin(2)], at: 1 }, server: [entry(1), entry(2, { revokedAt: 5 })] });
    expect(fresh.ok && fresh.effective.find(e => e.id === id(2))?.revokedAt).toBe(5);
    expect(fresh.ok && fresh.newDevices).toEqual([]);
  });
  it('reports a revival, keeps the pin value until acknowledged and then clears it', () => {
    const r = mergeRoster({ ...base, snapshot: { pins: [pin(1), pin(2, { revokedAt: 5 })], at: 1 }, server: [entry(1), entry(2)] });
    expect(r.ok && r.revived).toEqual([{ id: id(2), name: 'dev2' }]);
    expect(r.ok && r.effective.find(e => e.id === id(2))?.revokedAt).toBe(5);
    expect(r.ok && r.newDevices).toEqual([]);
    const ack = acknowledgePin(r.ok ? r.pins : [], id(2), true);
    expect(ack.find(p => p.id === id(2))).toMatchObject({ acknowledged: true, revokedAt: null });
    const after = mergeRoster({ ...base, snapshot: { pins: ack, at: 2 }, server: [entry(1), entry(2)] });
    expect(after.ok && after.revived).toEqual([]);
    expect(after.ok && after.persist).toBe(false);
  });
  it('does not lift a local revocation when acknowledging a non-revived pin (m2)', () => {
    const pins = acknowledgePin([pin(2, { revokedAt: 5, acknowledged: false })], id(2), false);
    expect(pins[0]).toMatchObject({ acknowledged: true, revokedAt: 5 });
  });
  it('gives no hint for devices the server reports as revoked', () => {
    const r = mergeRoster({ ...base, snapshot: { pins: [pin(1)], at: 1 }, server: [entry(1), entry(2, { revokedAt: 3 })] });
    expect(r.ok && r.newDevices).toEqual([]);
  });
  it('hintsOf recomputes from pins after an acknowledgement', () => {
    const pins = [pin(1), pin(2, { acknowledged: false })];
    expect(hintsOf(pins, [entry(1), entry(2)]).newDevices).toHaveLength(1);
    expect(hintsOf(acknowledgePin(pins, id(2), false), [entry(1), entry(2)]).newDevices).toEqual([]);
  });
});
