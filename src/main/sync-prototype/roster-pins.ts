import type { RosterPin, RosterSnapshot } from '../remote/identity';

/** Server roster entry as far as pinning needs it. */
export interface RosterEntry { id: string; name: string; signingKey: string; revokedAt: number | null; enrolledBy: string | null }
/** `ownInvite`: enrolled in this connection with an enrollment code this device issued (m3); shown as an info notice. */
export interface NewDeviceHint { id: string; name: string; enrolledVia: 'password' | 'invite'; invitedBy?: string; ownInvite?: true }
export interface RevivedHint { id: string; name: string }
export interface Hints { newDevices: NewDeviceHint[]; revived: RevivedHint[] }
/** Keys and revocation the sync author checks run against: server list plus kept revoked pins. */
export interface EffectiveDevice { id: string; signingKey: string; revokedAt: number | null }
export type MergeResult = ({ ok: true; pins: RosterPin[]; effective: EffectiveDevice[]; invitesIssued: number; persist: boolean; ownInvited: ReadonlySet<string> } & Hints) | { ok: false };

/** Hints from the pins: unacknowledged active newcomers and servers-side revivals of removed devices (B8, E11). */
export function hintsOf(pins: RosterPin[], server: RosterEntry[], ownInvited: ReadonlySet<string> = new Set()): Hints {
  const byId = new Map(pins.map(p => [p.id, p])); const newDevices: NewDeviceHint[] = []; const revived: RevivedHint[] = [];
  for (const entry of server) {
    const p = byId.get(entry.id);
    if (!p || p.acknowledged || entry.revokedAt !== null) continue;
    if (p.revokedAt !== null) { revived.push({ id: entry.id, name: entry.name }); continue; }
    const issuer = p.enrolledBy === null ? undefined : server.find(item => item.id === p.enrolledBy)?.name;
    newDevices.push({ id: entry.id, name: entry.name, enrolledVia: p.enrolledBy === null ? 'password' : 'invite', ...(issuer !== undefined ? { invitedBy: issuer } : {}), ...(ownInvited.has(entry.id) ? { ownInvite: true as const } : {}) });
  }
  return { newDevices, revived };
}

/** Confirms one pin; the local revocation is lifted only for a revived device (E11, §2.6), never otherwise. */
export function acknowledgePin(pins: RosterPin[], id: string, revived: boolean): RosterPin[] {
  return pins.map(p => p.id === id ? { ...p, acknowledged: true, ...(revived ? { revokedAt: null } : {}) } : p);
}

/** Same bound as the identity store's roster limit. */
const MAX_PINS = 64;
const min = (a: number | null, b: number | null): number | null => a !== null && b !== null ? Math.min(a, b) : a ?? b;

/** Compares the fresh server roster with the pinned one (§2.6); pure, the caller persists and throws. */
export function mergeRoster(input: { snapshot: RosterSnapshot | undefined; server: RosterEntry[]; selfId: string; invitesIssued: number; ownInvited?: ReadonlySet<string> }): MergeResult {
  const { snapshot, server, selfId } = input; let invitesIssued = input.invitesIssued; const ownInvited = new Set(input.ownInvited);
  if (!snapshot || snapshot.at === null) {
    const pins = server.map(e => ({ id: e.id, signingKey: e.signingKey, revokedAt: e.revokedAt, enrolledBy: e.enrolledBy, acknowledged: true }));
    return { ok: true, pins, effective: server.map(e => ({ id: e.id, signingKey: e.signingKey, revokedAt: e.revokedAt })), invitesIssued, persist: true, ownInvited, newDevices: [], revived: [] };
  }
  const old = new Map(snapshot.pins.map(p => [p.id, p])); const seen = new Set<string>(); const pins: RosterPin[] = []; let persist = false;
  for (const e of server) {
    seen.add(e.id); const prev = old.get(e.id);
    if (!prev) {
      // An own invitation redeemed in this connection still needs a (quiet) confirmation (m3).
      if (e.enrolledBy === selfId && invitesIssued > 0 && e.revokedAt === null) { invitesIssued -= 1; ownInvited.add(e.id); }
      pins.push({ id: e.id, signingKey: e.signingKey, revokedAt: e.revokedAt, enrolledBy: e.enrolledBy, acknowledged: false }); persist = true; continue;
    }
    if (prev.signingKey !== e.signingKey) return { ok: false };
    const revokedAt = min(prev.revokedAt, e.revokedAt);
    // Server says active but the pin holds a revocation: revived, needs a confirmation.
    const revived = prev.revokedAt !== null && e.revokedAt === null;
    const acknowledged = revived ? false : prev.acknowledged;
    if (revokedAt !== prev.revokedAt || acknowledged !== prev.acknowledged) persist = true;
    pins.push({ ...prev, revokedAt, acknowledged });
  }
  // Vanished pins stay (m1: a returning id with another key must end in syncRoster); over the limit, active ones go first.
  const gone = snapshot.pins.filter(p => !seen.has(p.id)); const room = Math.max(0, MAX_PINS - pins.length);
  const kept = [...gone.filter(p => p.revokedAt !== null), ...gone.filter(p => p.revokedAt === null)].slice(0, room);
  if (kept.length < gone.length) persist = true;
  pins.push(...kept);
  // Only revoked vanished pins feed the author checks (B8); an active vanished one is merely remembered.
  const keptRevoked = kept.filter(p => p.revokedAt !== null).map(p => ({ id: p.id, signingKey: p.signingKey, revokedAt: p.revokedAt }));
  const effective = [...server.map(e => ({ id: e.id, signingKey: e.signingKey, revokedAt: pins.find(p => p.id === e.id)!.revokedAt })), ...keptRevoked];
  return { ok: true, pins, effective, invitesIssued, persist, ownInvited, ...hintsOf(pins, server, ownInvited) };
}
