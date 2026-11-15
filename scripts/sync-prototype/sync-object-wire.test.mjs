import { expect, it } from 'vitest';
import { SYNC_OBJECT_FORMAT, SYNC_OBJECT_KINDS, isLegacyVaultObject, validateSyncObject } from './sync-object-wire.mjs';

const b64 = n => Buffer.alloc(n, 7).toString('base64');
const object = (patch = {}, kind = 'version') => ({ format: SYNC_OBJECT_FORMAT, version: 2, kind, epoch: 1, cipher: { algorithm: 'aes-256-gcm', nonce: b64(12), authTag: b64(16) }, payload: b64(5), ...patch });
const v1 = (patch = {}) => { const { epoch, ...rest } = object(); return { ...rest, version: 1, ...patch }; };
const wire = o => JSON.stringify(o);
const legacy = JSON.stringify({ format: 'terminus-encrypted-vault', version: 1, kdf: { algorithm: 'argon2id', salt: b64(16), memoryKiB: 65536, iterations: 3, parallelism: 1 }, cipher: { algorithm: 'aes-256-gcm', nonce: b64(12), authTag: b64(16) }, payload: b64(5) });
it('accepts version and keybox envelopes', () => {
  expect(SYNC_OBJECT_KINDS).toEqual(['version', 'keybox']);
  expect(validateSyncObject(wire(object()))).toEqual({ kind: 'version', epoch: 1 });
  expect(validateSyncObject(wire(object({}, 'keybox')))).toEqual({ kind: 'keybox', epoch: 1 });
});
it('rejects everything that is not exactly the envelope', () => {
  const bad = [
    object({ extra: 1 }), object({ kind: 'other' }), object({ version: 1 }), object({ epoch: 0 }), object({ epoch: -1 }), object({ epoch: 1.5 }), object({ epoch: '1' }), object({ epoch: 1_000_001 }), object({ epoch: 2 ** 53 }),
    { format: SYNC_OBJECT_FORMAT, version: 2, kind: 'version', cipher: object().cipher, epoch: 1, payload: b64(5) }, // key order
    (() => { const { epoch, ...rest } = object(); return rest; })(), object({ format: 'x' }),
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
it('treats a strict envelope v1 as a legacy object (listed, never stored)', () => {
  expect(isLegacyVaultObject(wire(v1()))).toBe(true); expect(isLegacyVaultObject(wire(v1({}, 'keybox')))).toBe(true);
  expect(() => validateSyncObject(wire(v1()))).toThrow();
  for (const bad of [v1({ extra: 1 }), v1({ version: 3 }), v1({ kind: 'x' }), v1({ payload: '' })]) expect(isLegacyVaultObject(wire(bad))).toBe(false);
  expect(isLegacyVaultObject(JSON.stringify(v1(), null, 1))).toBe(false);
});
