// Strict server-side check of the sync object envelope (version/keybox). The server cannot verify the encryption.
import { validateVaultFile } from './vault-file-wire.mjs';
export const SYNC_OBJECT_FORMAT = 'shellherd-sync-object';
export const SYNC_OBJECT_KINDS = ['version', 'keybox'];
const MAX = 1048576;
export const SYNC_EPOCH_MAX = 1_000_000;
const check = ok => { if (!ok) throw Error('Sync object rejected'); };
const keys = (value, expected) => check(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).join(',') === expected);
function base64(value, size) {
  check(typeof value === 'string' && value.length <= MAX * 2); const bytes = Buffer.from(value, 'base64');
  check(bytes.toString('base64') === value && (size === undefined ? bytes.length >= 1 : bytes.length === size));
}
function envelope(wire, version) {
  check(typeof wire === 'string' && Buffer.byteLength(wire) <= MAX);
  const parsed = JSON.parse(wire); check(JSON.stringify(parsed) === wire);
  keys(parsed, version === 2 ? 'format,version,kind,epoch,cipher,payload' : 'format,version,kind,cipher,payload');
  check(parsed.format === SYNC_OBJECT_FORMAT && parsed.version === version && SYNC_OBJECT_KINDS.includes(parsed.kind));
  if (version === 2) check(Number.isSafeInteger(parsed.epoch) && parsed.epoch >= 1 && parsed.epoch <= SYNC_EPOCH_MAX);
  keys(parsed.cipher, 'algorithm,nonce,authTag');
  check(parsed.cipher.algorithm === 'aes-256-gcm'); base64(parsed.cipher.nonce, 12); base64(parsed.cipher.authTag, 16); base64(parsed.payload);
  return parsed;
}
/** Envelope v2 (kind and key epoch in the clear). */
export function validateSyncObject(wire) {
  const parsed = envelope(wire, 2);
  return { kind: parsed.kind, epoch: parsed.epoch };
}
/** Older objects that stay listed on disk: the vault file format or a strict envelope v1. PUT accepts v2 only. */
export function isLegacyVaultObject(wire) {
  try { validateVaultFile(wire); return true; } catch { /* try envelope v1 */ }
  try { envelope(wire, 1); return true; } catch { return false; }
}
