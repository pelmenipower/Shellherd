import type { RosterPin, RosterSnapshot } from '../remote/identity';

/** Server roster entry as far as pinning needs it. */
export interface RosterEntry { id: string; name: string; signingKey: string; revokedAt: number | null; enrolledBy: string | null }
export interface NewDeviceHint { id: string; name: string; enrolledVia: 'password' | 'invite'; invitedBy?: string }
export interface RevivedHint { id: string; name: string }
export interface Hints { newDevices: NewDeviceHint[]; revived: RevivedHint[] }
/** Keys and revocation the sync author checks run against: server list plus kept revoked pins. */
export interface EffectiveDevice { id: string; signingKey: string; revokedAt: number | null }
export type MergeResult = ({ ok: true; pins: RosterPin[]; effective: EffectiveDevice[]; invitesIssued: number; persist: boolean } & Hints) | { ok: false };

/** Hints from the pins: unacknowledged active newcomers and servers-side revivals of removed devices (B8, E11). */
export function hintsOf(pins: RosterPin[], server: RosterEntry[]): Hints {
  const byId = new Map(pins.map(p => [p.id, p])); const newDevices: NewDeviceHint[] = []; const revived: RevivedHint[] = [];
  for (const entry of server) {
    const p = byId.get(entry.id);
    if (!p || p.acknowledged || entry.revokedAt !== null) continue;
    if (p.revokedAt !== null) { revived.push({ id: entry.id, name: entry.name }); continue; }
    const issuer = p.enrolledBy === null ? undefined : server.find(item => item.id === p.enrolledBy)?.name;
    newDevices.push({ id: entry.id, name: entry.name, enrolledVia: p.enrolledBy === null ? 'password' : 'invite', ...(issuer !== undefined ? { invitedBy: issuer } : {}) });
  }
  return { newDevices, revived };
}

/** Confirms one pin; a revived pin (removed locally, active on the server) becomes active again (E11). */
export function acknowledgePin(pins: RosterPin[], id: string): RosterPin[] {
  return pins.map(p => p.id === id ? { ...p, acknowledged: true, revokedAt: null } : p);
}

const min = (a: number | null, b: number | null): number | null => a !== null && b !== null ? Math.min(a, b) : a ?? b;

/** Compares the fresh server roster with the pinned one (§2.6); pure, the caller persists and throws. */
export function mergeRoster(input: { snapshot: RosterSnapshot | undefined; server: RosterEntry[]; selfId: string; invitesIssued: number }): MergeResult {
  const { snapshot, server, selfId } = input; let invitesIssued = input.invitesIssued;
  if (!snapshot || snapshot.at === null) {
    const pins = server.map(e => ({ id: e.id, signingKey: e.signingKey, revokedAt: e.revokedAt, enrolledBy: e.enrolledBy, acknowledged: true }));
    return { ok: true, pins, effective: server.map(e => ({ id: e.id, signingKey: e.signingKey, revokedAt: e.revokedAt })), invitesIssued, persist: true, newDevices: [], revived: [] };
  }
  const old = new Map(snapshot.pins.map(p => [p.id, p])); const seen = new Set<string>(); const pins: RosterPin[] = []; let persist = false;
  for (const e of server) {
    seen.add(e.id); const prev = old.get(e.id);
    if (!prev) {
      const own = e.enrolledBy === selfId && invitesIssued > 0; if (own) invitesIssued -= 1;
      pins.push({ id: e.id, signingKey: e.signingKey, revokedAt: e.revokedAt, enrolledBy: e.enrolledBy, acknowledged: own }); persist = true; continue;
    }
    if (prev.signingKey !== e.signingKey) return { ok: false };
    const revokedAt = min(prev.revokedAt, e.revokedAt);
    // Server says active but the pin holds a revocation: revived, needs a confirmation.
    const revived = prev.revokedAt !== null && e.revokedAt === null;
    const acknowledged = revived ? false : prev.acknowledged;
    if (revokedAt !== prev.revokedAt || acknowledged !== prev.acknowledged) persist = true;
    pins.push({ ...prev, revokedAt, acknowledged });
  }
  for (const p of snapshot.pins) if (!seen.has(p.id)) { if (p.revokedAt !== null) pins.push(p); else persist = true; }
  const keptRevoked = pins.filter(p => !seen.has(p.id)).map(p => ({ id: p.id, signingKey: p.signingKey, revokedAt: p.revokedAt }));
  const effective = [...server.map(e => ({ id: e.id, signingKey: e.signingKey, revokedAt: pins.find(p => p.id === e.id)!.revokedAt })), ...keptRevoked];
  return { ok: true, pins, effective, invitesIssued, persist, ...hintsOf(pins, server) };
}
