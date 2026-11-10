import type { RemoteEndReason, RemoteErrorCode } from '../../shared/remote-lab';

// Full literals so the i18n catalog test can find every key.
export const REMOTE_ERROR_KEYS = {
  unavailable: 'remoteLab:errors.unavailable',
  invalid: 'remoteLab:errors.invalid',
  stale: 'remoteLab:errors.stale',
  identity: 'remoteLab:errors.identity',
  locked: 'remoteLab:errors.locked',
  connection: 'remoteLab:errors.connection',
  authentication: 'remoteLab:errors.authentication',
  expired: 'remoteLab:errors.expired',
  declined: 'remoteLab:errors.declined',
  mismatch: 'remoteLab:errors.mismatch',
  signal: 'remoteLab:errors.signal',
  media: 'remoteLab:errors.media',
  peer: 'remoteLab:errors.peer',
  scope: 'remoteLab:errors.scope',
  limit: 'remoteLab:errors.limit',
  samePassword: 'remoteLab:errors.samePassword',
  enrolledElsewhere: 'remoteLab:errors.enrolledElsewhere'
} as const satisfies Record<RemoteErrorCode, string>;

export const REMOTE_END_KEYS = {
  stopped: 'remoteLab:ended.stopped',
  remote: 'remoteLab:ended.remote',
  expired: 'remoteLab:ended.expired',
  locked: 'remoteLab:ended.locked',
  declined: 'remoteLab:ended.declined',
  failed: 'remoteLab:ended.failed',
  scope: 'remoteLab:ended.scope',
  mismatch: 'remoteLab:ended.mismatch'
} as const satisfies Record<RemoteEndReason, string>;

export function errorKey<C extends RemoteErrorCode>(code: C): (typeof REMOTE_ERROR_KEYS)[C] {
  return REMOTE_ERROR_KEYS[code];
}

export function endKey<R extends RemoteEndReason>(reason: R): (typeof REMOTE_END_KEYS)[R] {
  return REMOTE_END_KEYS[reason];
}

export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000));
}

export { formatFingerprint as groupFingerprint } from '../../shared/remote-signal';
