/** Client-only encryption. The server never imports this module. */
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import { argon2id } from 'hash-wasm';
import { EncryptedVaultFileSchema } from '../../shared/vault/schema';
import type { EncryptedVaultFile } from '../../shared/vault/file-format';
export interface SyncContext { serverId: string; namespace: string }
export class SyncFailure extends Error {
  constructor(public readonly code: 'locked' | 'changed' | 'history' | 'conflict' | 'bindings' | 'wrongVault' | 'recovery' | 'limit') { super(`Vault sync rejected: ${code}`); }
}
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
function keyFor(vaultKey: Buffer, context: SyncContext, purpose: 'version' | 'state'): Buffer {
  ensure(vaultKey.length === 32 && /^[a-f0-9]{64}$/.test(context.serverId) && /^[a-zA-Z0-9_-]{1,100}$/.test(context.namespace));
  return Buffer.from(hkdfSync('sha256', vaultKey, Buffer.from(JSON.stringify([context.serverId, context.namespace])), `shellherd-vault-sync-${purpose}-v1`, 32));
}
const aad = (context: SyncContext, purpose: string, kdf: EncryptedVaultFile['kdf']) => Buffer.from(stable(['shellherd-vault-sync', 1, purpose, context, kdf]));
export function sealDocument(document: unknown, vaultKey: Buffer, kdf: EncryptedVaultFile['kdf'], context: SyncContext, purpose: 'version' | 'state'): EncryptedVaultFile {
  validateKdf(kdf); const key = keyFor(vaultKey, context, purpose); const nonce = randomBytes(12); const plain = Buffer.from(JSON.stringify(document));
  try {
    ensure(plain.length <= (purpose === 'state' ? 16 * 1048576 : 768 * 1024), 'limit');
    const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(aad(context, purpose, kdf));
    const payload = Buffer.concat([cipher.update(plain), cipher.final()]);
    return { format: 'terminus-encrypted-vault', version: 1, kdf: { ...kdf }, cipher: { algorithm: 'aes-256-gcm', nonce: nonce.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }, payload: payload.toString('base64') };
  } finally { key.fill(0); plain.fill(0); }
}
export function openDocument(file: EncryptedVaultFile, vaultKey: Buffer, kdf: EncryptedVaultFile['kdf'], context: SyncContext, purpose: 'version' | 'state'): unknown {
  validateKdf(file.kdf); ensure(stable(file.kdf) === stable(kdf), 'wrongVault');
  const key = keyFor(vaultKey, context, purpose); let plain: Buffer | undefined;
  try {
    const nonce = Buffer.from(file.cipher.nonce, 'base64'); const tag = Buffer.from(file.cipher.authTag, 'base64'); ensure(nonce.length === 12 && tag.length === 16);
    const decipher = createDecipheriv('aes-256-gcm', key, nonce); decipher.setAAD(aad(context, purpose, kdf)); decipher.setAuthTag(tag);
    plain = Buffer.concat([decipher.update(Buffer.from(file.payload, 'base64')), decipher.final()]);
    ensure(plain.length <= (purpose === 'state' ? 16 * 1048576 : 768 * 1024), 'limit'); return JSON.parse(plain.toString('utf8'));
  } catch (error) { if (error instanceof SyncFailure) throw error; throw new SyncFailure('wrongVault'); }
  finally { key.fill(0); plain?.fill(0); }
}
export async function keyFromPassword(password: string, kdf: EncryptedVaultFile['kdf']): Promise<Buffer> {
  validateKdf(kdf); ensure(typeof password === 'string' && password.length > 0 && password.length <= 1024, 'wrongVault');
  const raw = await argon2id({ password: password.normalize('NFKC'), salt: Buffer.from(kdf.salt, 'base64'), memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32, outputType: 'binary' });
  const key = Buffer.from(raw); raw.fill(0); return key;
}
