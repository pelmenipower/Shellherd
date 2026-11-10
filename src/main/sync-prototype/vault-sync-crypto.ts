/** Client-only encryption. The server never imports this module. */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { argon2id } from 'hash-wasm';
import { EncryptedVaultFileSchema } from '../../shared/vault/schema';
import type { EncryptedVaultFile } from '../../shared/vault/file-format';
import { normalizeRecoveryCode } from '../../shared/recovery-code';
/** Signing side of this device plus the roster view used to check author stamps; lives in main only. */
export interface SyncDevice { id: string; sign(data: Buffer): Buffer; keyOf(id: string): KeyObject | undefined; revokedAt(id: string): number | null | undefined }
export interface SyncContext { serverId: string; namespace: string; device?: SyncDevice }
export class SyncFailure extends Error {
  constructor(public readonly code: 'locked' | 'changed' | 'history' | 'conflict' | 'bindings' | 'wrongVault' | 'recovery' | 'limit' | 'syncKey' | 'recoveryCode' | 'migrate' | 'foreignKey' | 'otherServer' | 'platform') { super(`Vault sync rejected: ${code}`); }
}
export const SYNC_OBJECT_FORMAT = 'shellherd-sync-object';
const OBJECT_MAX = 1048576; const OBJECT_PLAIN_MAX = 768 * 1024;
type ObjectKind = 'version' | 'keybox';
export function ensure(ok: unknown, code: SyncFailure['code'] = 'history'): asserts ok { if (!ok) throw new SyncFailure(code); }
export const hashWire = (wire: string) => createHash('sha256').update(wire).digest('hex');
export function stable(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => JSON.stringify(k) + ':' + stable(v)).join(',') + '}';
  return JSON.stringify(value);
}
export function samePortable(a: unknown, b: unknown): boolean {
  const strip = (value: unknown) => { const copy = structuredClone(value) as { document?: { updatedAt?: string }; updatedAt?: string }; if (copy.document) delete copy.document.updatedAt; else delete copy.updatedAt; return copy; };
  return stable(strip(a)) === stable(strip(b));
}
export function validateKdf(kdf: EncryptedVaultFile['kdf']): void {
  ensure(kdf.algorithm === 'argon2id' && kdf.memoryKiB === 65536 && kdf.iterations === 3 && kdf.parallelism === 1, 'limit');
  ensure(Buffer.from(kdf.salt, 'base64').length === 16 && Buffer.from(kdf.salt, 'base64').toString('base64') === kdf.salt);
}
export function encryptedFile(wire: string): EncryptedVaultFile {
  ensure(Buffer.byteLength(wire) <= 1048576, 'limit');
  const file = EncryptedVaultFileSchema.parse(JSON.parse(wire)); validateKdf(file.kdf);
  ensure(JSON.stringify(file) === wire); return file;
}
/** Only serverId and namespace ever enter a key or AAD, never the passed object (B7). */
export function bound(context: SyncContext): { serverId: string; namespace: string } {
  ensure(/^[a-f0-9]{64}$/.test(context.serverId) && /^[a-zA-Z0-9_-]{1,100}$/.test(context.namespace));
  return { serverId: context.serverId, namespace: context.namespace };
}
const salt = (context: SyncContext): Buffer => { const { serverId, namespace } = bound(context); return Buffer.from(JSON.stringify([serverId, namespace])); };
function keyFor(vaultKey: Buffer, context: SyncContext): Buffer {
  ensure(vaultKey.length === 32);
  return Buffer.from(hkdfSync('sha256', vaultKey, salt(context), 'shellherd-vault-sync-state-v1', 32));
}
const aad = (context: SyncContext, kdf: EncryptedVaultFile['kdf']) => Buffer.from(stable(['shellherd-vault-sync', 1, 'state', bound(context), kdf]));
const STATE_MAX = 40 * 1048576;
/** Checkpoint only; server objects use sealSyncObject. */
export function sealDocument(document: unknown, vaultKey: Buffer, kdf: EncryptedVaultFile['kdf'], context: SyncContext, _purpose: 'state' = 'state'): EncryptedVaultFile {
  validateKdf(kdf); const key = keyFor(vaultKey, context); const nonce = randomBytes(12); const plain = Buffer.from(JSON.stringify(document));
  try {
    ensure(plain.length <= STATE_MAX, 'limit');
    const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad(context, kdf));
    const payload = Buffer.concat([cipher.update(plain), cipher.final()]);
    return { format: 'terminus-encrypted-vault', version: 1, kdf: { ...kdf }, cipher: { algorithm: 'aes-256-gcm', nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }, payload: payload.toString('base64') };
  } finally { key.fill(0); plain.fill(0); }
}
export function openDocument(file: EncryptedVaultFile, vaultKey: Buffer, kdf: EncryptedVaultFile['kdf'], context: SyncContext, _purpose: 'state' = 'state'): unknown {
  validateKdf(file.kdf); ensure(stable(file.kdf) === stable(kdf), 'wrongVault');
  const key = keyFor(vaultKey, context); let plain: Buffer | undefined;
  try {
    const nonce = Buffer.from(file.cipher.nonce, 'base64'); const tag = Buffer.from(file.cipher.authTag, 'base64'); ensure(nonce.length === 12 && tag.length === 16);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce); decipher.setAAD(aad(context, kdf)); decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(Buffer.from(file.payload, 'base64')), decipher.final()]);
    ensure(plain.length <= STATE_MAX, 'limit'); return JSON.parse(plain.toString('utf8'));
  } catch (error) { if (error instanceof SyncFailure) throw error; throw new SyncFailure('wrongVault'); }
  finally { key.fill(0); plain?.fill(0); }
}

export function generateRecoveryCode(): string { return randomBytes(16).toString('hex'); }
const canonical = (value: unknown, size?: number): boolean => {
  if (typeof value !== 'string') return false; const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value && (size === undefined ? bytes.length >= 1 : bytes.length === size);
};
const orderedKeys = (value: unknown, expected: string): boolean => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).join(',') === expected;
/** TS mirror of the server's validateSyncObject; null for anything else, including the legacy vault format. */
export function parseSyncEnvelope(wire: string): { kind: ObjectKind } | null {
  if (typeof wire !== 'string' || Buffer.byteLength(wire) > OBJECT_MAX) return null;
  let parsed: { format?: unknown; version?: unknown; kind?: unknown; cipher?: { algorithm?: unknown; nonce?: unknown; authTag?: unknown }; payload?: unknown };
  try { parsed = JSON.parse(wire); } catch { return null; }
  if (JSON.stringify(parsed) !== wire || !orderedKeys(parsed, 'format,version,kind,cipher,payload')) return null;
  if (parsed.format !== SYNC_OBJECT_FORMAT || parsed.version !== 1 || (parsed.kind !== 'version' && parsed.kind !== 'keybox')) return null;
  if (!orderedKeys(parsed.cipher, 'algorithm,nonce,authTag') || parsed.cipher!.algorithm !== 'aes-256-gcm') return null;
  if (!canonical(parsed.cipher!.nonce, 12) || !canonical(parsed.cipher!.authTag, 16) || !canonical(parsed.payload)) return null;
  return { kind: parsed.kind };
}
/** HKDF over the 32 byte sync key; the caller owns (and zeroes) both keys. */
export function versionKey(syncKey: Buffer, context: SyncContext): Buffer {
  ensure(syncKey.length === 32);
  return Buffer.from(hkdfSync('sha256', syncKey, salt(context), 'shellherd-sync-version-v2', 32));
}
export function keyboxWrapKey(code: string, context: SyncContext): Buffer {
  const normalized = normalizeRecoveryCode(code); ensure(normalized !== null, 'recoveryCode');
  const bytes = Buffer.from(normalized, 'hex');
  try { return Buffer.from(hkdfSync('sha256', bytes, salt(context), 'shellherd-sync-keybox-recovery-v1', 32)); } finally { bytes.fill(0); }
}
const objectAad = (kind: ObjectKind, context: SyncContext) => { const { serverId, namespace } = bound(context); return Buffer.from(stable([SYNC_OBJECT_FORMAT, 1, kind, serverId, namespace])); };
export function sealSyncObject(kind: ObjectKind, document: unknown, key: Buffer, context: SyncContext): string {
  ensure(key.length === 32); const nonce = randomBytes(12); const plain = Buffer.from(JSON.stringify(document));
  try {
    ensure(plain.length <= OBJECT_PLAIN_MAX, 'limit');
    const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(objectAad(kind, context));
    const payload = Buffer.concat([cipher.update(plain), cipher.final()]);
    const wire = JSON.stringify({ format: SYNC_OBJECT_FORMAT, version: 1, kind, cipher: { algorithm: 'aes-256-gcm', nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }, payload: payload.toString('base64') });
    ensure(Buffer.byteLength(wire) <= OBJECT_MAX, 'limit'); return wire;
  } finally { plain.fill(0); }
}
export function openSyncObject(wire: string, kind: ObjectKind, key: Buffer, context: SyncContext): unknown {
  ensure(typeof wire !== 'string' || Buffer.byteLength(wire) <= OBJECT_MAX, 'limit');
  const envelope = parseSyncEnvelope(wire); ensure(envelope?.kind === kind, 'wrongVault'); ensure(key.length === 32, 'wrongVault');
  let plain: Buffer | undefined;
  try {
    const parsed = JSON.parse(wire) as { cipher: { nonce: string; authTag: string }; payload: string };
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.cipher.nonce, 'base64')); decipher.setAAD(objectAad(kind, context)); decipher.setAuthTag(Buffer.from(parsed.cipher.authTag, 'base64'));
    plain = Buffer.concat([decipher.update(Buffer.from(parsed.payload, 'base64')), decipher.final()]);
    ensure(plain.length <= OBJECT_PLAIN_MAX, 'limit'); return JSON.parse(plain.toString('utf8'));
  } catch (error) { if (error instanceof SyncFailure) throw error; throw new SyncFailure('wrongVault'); }
  finally { plain?.fill(0); }
}
export async function keyFromPassword(password: string, kdf: EncryptedVaultFile['kdf']): Promise<Buffer> {
  validateKdf(kdf); ensure(typeof password === 'string' && password.length > 0 && password.length <= 1024, 'wrongVault');
  const raw = await argon2id({ password: password.normalize('NFKC'), salt: Buffer.from(kdf.salt, 'base64'), memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32, outputType: 'binary' });
  const key = Buffer.from(raw); raw.fill(0); return key;
}
