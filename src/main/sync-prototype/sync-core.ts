/** Dependency-free sync helpers (no crypto beyond a hash); the vault session imports these, so they stay out of the lab-only code. */
import { createHash } from 'node:crypto';
export class SyncFailure extends Error {
  constructor(public readonly code: 'locked' | 'changed' | 'history' | 'conflict' | 'bindings' | 'wrongVault' | 'recovery' | 'limit' | 'syncKey' | 'recoveryCode' | 'migrate' | 'foreignKey' | 'otherServer' | 'platform' | 'rotated' | 'rotateBlocked' | 'rotateRaced' | 'inviteKey') { super(`Vault sync rejected: ${code}`); }
}
export function ensure(ok: unknown, code: SyncFailure['code'] = 'history'): asserts ok { if (!ok) throw new SyncFailure(code); }
export const hashWire = (wire: string) => createHash('sha256').update(wire).digest('hex');
export function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}';
  return JSON.stringify(value);
}
