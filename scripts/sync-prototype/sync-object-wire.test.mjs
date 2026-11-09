import { expect, it } from 'vitest';
import { SYNC_OBJECT_FORMAT, SYNC_OBJECT_KINDS, isLegacyVaultObject, validateSyncObject } from './sync-object-wire.mjs';

const b64 = n => Buffer.alloc(n, 7).toString('base64');
const object = (patch = {}, kind = 'version') => ({ format: SYNC_OBJECT_FORMAT, version: 1, kind, cipher: { algorithm: 'aes-256-gcm', nonce: b64(12), authTag: b64(16) }, payload: b64(5), ...patch });
const wire = o => JSON.stringify(o);
const legacy = JSON.stringify({ format: 'terminus-encrypted-vault', version: 1, kdf: { algorithm: 'argon2id', salt: b64(16), memoryKiB: 65536, iterations: 3, parallelism: 1 }, cipher: { algorithm: 'aes-256-gcm', nonce: b64(12), authTag: b64(16) }, payload: b64(5) });
it('accepts version and keybox envelopes', () => {
  expect(SYNC_OBJECT_KINDS).toEqual(['version', 'keybox']);
  expect(validateSyncObject(wire(object()))).toEqual({ kind: 'version' });
  expect(validateSyncObject(wire(object({}, 'keybox')))).toEqual({ kind: 'keybox' });
});
it('rejects everything that is not exactly the envelope', () => {
  const bad = [
    object({ extra: 1 }), object({ kind: 'other' }), object({ version: 2 }), object({ format: 'x' }),
    object({ cipher: { algorithm: 'aes-256-gcm', nonce: b64(11), authTag: b64(16) } }),
    object({ cipher: { algorithm: 'aes-256-gcm', nonce: b64(12), authTag: b64(15) } }),
    object({ cipher: { algorithm: 'aes-128-gcm', nonce: b64(12), authTag: b64(16) } }),
    object({ cipher: { nonce: b64(12), algorithm: 'aes-256-gcm', authTag: b64(16) } }),
    object({ payload: '' }), object({ payload: 'AA' }), object({ payload: 5 }),
  ];
  for (const item of bad) expect(() => validateSyncObject(wire(item))).toThrow();
  const { payload, ...missing } = object(); expect(() => validateSyncObject(wire(missing))).toThrow();
  expect(() => validateSyncObject(JSON.stringify(object(), null, 1))).toThrow(); // not canonical
  expect(() => validateSyncObject(legacy)).toThrow(); expect(() => validateSyncObject(5)).toThrow(); expect(() => validateSyncObject('[')).toThrow();
  expect(() => validateSyncObject(wire(object({ payload: Buffer.alloc(1048576).toString('base64') })))).toThrow();
});
it('recognises the legacy vault file without ever throwing', () => {
  expect(isLegacyVaultObject(legacy)).toBe(true);
  for (const value of [wire(object()), '{', '', 5, null, undefined]) expect(isLegacyVaultObject(value)).toBe(false);
});
