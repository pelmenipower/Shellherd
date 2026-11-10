import { isDeviceName, normalizeDeviceName } from '../../shared/device-name';
import { normalizeRecoveryCode } from '../../shared/recovery-code';
import { VAULT_PASSWORD_MIN_LENGTH } from '../../shared/vault-password';

/** Pure decisions of the sync lab dialog, kept out of the component so they are unit-tested. */
export interface DeviceRow { id: string; revokedAt: number | null; self: boolean }

/** The recovery code field appears only after the host asked for the code. */
export function needsRecoveryCode(code: string | null): boolean { return code === 'syncKey' || code === 'syncRecoveryCode' || code === 'syncRotated' || code === 'syncInviteKey'; }
/** A reply with a new recovery code must not close the dialog: the code is shown only once. */
export function deferVaultChange(reply: { vaultChanged?: unknown; recoveryCode?: string }): boolean { return Boolean(reply.vaultChanged) && Boolean(reply.recoveryCode); }
/** Typed codes may contain spaces and dashes; submit only when exactly 32 hex digits remain. */
export function recoveryCodeValid(input: string): boolean { return normalizeRecoveryCode(input) !== null; }
/** Import needs a valid code (not when an enrollment code is held) and two equal local passwords of at least the vault minimum length. */
export function importReady(code: string, password: string, repeat: string, inviteKey = false): boolean {
  return (inviteKey || recoveryCodeValid(code)) && password.length >= VAULT_PASSWORD_MIN_LENGTH && password === repeat;
}
/** A non-empty local password below the vault minimum gets a hint instead of a silent disabled button. */
export function passwordTooShort(password: string): boolean { return password !== '' && password.length < VAULT_PASSWORD_MIN_LENGTH; }
/** The own device and already revoked devices have no remove button. */
export function canRevoke(device: DeviceRow): boolean { return !device.self && device.revokedAt === null; }
/** Enrollment needs a plausible user name, a password, a device name that passes the shared rule and, for another known address, the explicit confirmation. */
export function enrollReady(username: string, password: string, deviceName: string, elsewhereConfirmed = true): boolean {
  return /^[a-zA-Z0-9_.-]{1,64}$/.test(username) && password !== '' && isDeviceName(normalizeDeviceName(deviceName)) && elsewhereConfirmed;
}
/** Enrollment with a code needs the 32-character code, a valid device name and, for another known address, the explicit confirmation. */
export function inviteReady(code: string, deviceName: string, elsewhereConfirmed = true): boolean {
  return recoveryCodeValid(code) && isDeviceName(normalizeDeviceName(deviceName)) && elsewhereConfirmed;
}
