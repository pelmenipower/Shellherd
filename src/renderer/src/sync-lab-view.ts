import { normalizeRecoveryCode } from '../../shared/recovery-code';

/** Pure decisions of the sync lab dialog, kept out of the component so they are unit-tested. */
export interface DeviceRow { id: string; revokedAt: number | null; self: boolean }

/** The recovery code field appears only after the host asked for the code. */
export function needsRecoveryCode(code: string | null): boolean { return code === 'syncKey' || code === 'syncRecoveryCode'; }
/** Typed codes may contain spaces and dashes; submit only when exactly 32 hex digits remain. */
export function recoveryCodeValid(input: string): boolean { return normalizeRecoveryCode(input) !== null; }
/** Import needs a valid code and two equal, non-empty passwords. */
export function importReady(code: string, password: string, repeat: string): boolean {
  return recoveryCodeValid(code) && password !== '' && password === repeat;
}
/** The own device and already revoked devices have no remove button. */
export function canRevoke(device: DeviceRow): boolean { return !device.self && device.revokedAt === null; }
/** Enrollment needs a plausible user name, a password and a printable device name of 1-80 characters. */
export function enrollReady(username: string, password: string, deviceName: string): boolean {
  return /^[a-zA-Z0-9_.-]{1,64}$/.test(username) && password !== '' && /^[^\x00-\x1f\x7f]{1,80}$/.test(deviceName.trim());
}
