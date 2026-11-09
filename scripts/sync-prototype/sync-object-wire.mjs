// Strict server-side check of the sync object envelope (version/keybox). The server cannot verify the encryption.
import { validateVaultFile } from './vault-file-wire.mjs';
export const SYNC_OBJECT_FORMAT = 'shellherd-sync-object';
export const SYNC_OBJECT_KINDS = ['version', 'keybox'];
const MAX = 1048576;
const check = ok => { if (!ok) throw Error('Sync object rejected'); };
const keys = (value, expected) => check(value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).join(',') === expected);
function base64(value, size) {
  check(typeof value === 'string' && value.length <= MAX * 2); const bytes = Buffer.from(value, 'base64');
  check(bytes.toString('base64') === value && (size === undefined ? bytes.length >= 1 : bytes.length === size));
}
export function validateSyncObject(wire) {
  check(typeof wire === 'string' && Buffer.byteLength(wire) <= MAX);
  const parsed = JSON.parse(wire); check(JSON.stringify(parsed) === wire);
  keys(parsed, 'format,version,kind,cipher,payload');
  check(parsed.format === SYNC_OBJECT_FORMAT && parsed.version === 1 && SYNC_OBJECT_KINDS.includes(parsed.kind));
  keys(parsed.cipher, 'algorithm,nonce,authTag');
  check(parsed.cipher.algorithm === 'aes-256-gcm'); base64(parsed.cipher.nonce, 12); base64(parsed.cipher.authTag, 16); base64(parsed.payload);
  return { kind: parsed.kind };
}
export function isLegacyVaultObject(wire) {
  try { validateVaultFile(wire); return true; } catch { return false; }
}
