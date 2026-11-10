import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { SYNC_OBJECT_FORMAT, SyncFailure, generateRecoveryCode, inviteEnrollSecret, inviteWrapKey, keyboxWrapKey, openDocument, openSyncObject, parseSyncEnvelope, sealDocument, sealSyncObject, stable, versionKey } from './vault-sync-crypto';
import { normalizeRecoveryCode } from '../../shared/recovery-code';

const context = { serverId: 'b'.repeat(64), namespace: 'test' };
const wireModule = import(/* @vite-ignore */ pathToFileURL(resolve(__dirname, '../../../scripts/sync-prototype/sync-object-wire.mjs')).href) as Promise<{
  validateSyncObject(wire: string): { kind: string; epoch: number }; isLegacyVaultObject(wire: string): boolean;
}>;
const proofModule = import(/* @vite-ignore */ pathToFileURL(resolve(__dirname, '../../../scripts/sync-prototype/device-proof.mjs')).href) as Promise<{ inviteEnrollSecret(code: string, serverId: string, namespace: string, origin: string): string }>;
const code = '000102030405060708090a0b0c0d0e0f';

const vectorContext = { serverId: 'ab'.repeat(32), namespace: 'ns' };
it('uses the fixed HKDF vectors of the validation appendix', () => {
  expect(inviteEnrollSecret(code, vectorContext, 'https://sync.example.net')).toBe('5792f83741f1740cd38f0039dfb03e44ab40757e0dc67ae50719894dabf55b4e');
  expect(inviteWrapKey(code, vectorContext, 1).toString('hex')).toBe('1426e5ff6328e609ac4cdf281528c8ba64f4a43d16b926afe9f958dcb1455bc1');
  expect(keyboxWrapKey(code, vectorContext, 1).toString('hex')).toBe('a239835a67dd6e2c7dca3a2b438a3b236bfcf169cabec680a9c8609c3adbadb0');
  expect(keyboxWrapKey(code, vectorContext, 2).toString('hex')).toBe('e9987ee4f4301378bbdd5375d5cec7f5ff75144ce59144f1189b85cc386b1b18');
  expect(versionKey(Buffer.alloc(32, 0x11), vectorContext, 1).toString('hex')).toBe('ec0608780c1af701de0d23791dd93a1d7485acf6c1a1753f10b622f5d6fad6de');
  expect(keyboxWrapKey('0001-0203 0405-0607-0809-0A0B-0C0D-0E0F', context, 1).toString('hex')).toBe(keyboxWrapKey(code, context, 1).toString('hex'));
  expect(() => keyboxWrapKey('xyz', context, 1)).toThrowError(expect.objectContaining({ code: 'recoveryCode' }));
  expect(() => inviteWrapKey('xyz', context, 1)).toThrowError(expect.objectContaining({ code: 'inviteKey' }));
  expect(() => inviteEnrollSecret('xyz', context, 'https://sync.example.net')).toThrowError(expect.objectContaining({ code: 'inviteKey' }));
  expect(() => inviteEnrollSecret(code, context, 'https://sync.example.net/')).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
  expect(() => inviteEnrollSecret(code, context, 'http://sync.example.net')).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
  // Same origin rule as the server (device-proof.mjs originOk): loopback and private HTTP are allowed, public HTTP is not.
  expect(inviteEnrollSecret(code, context, 'http://127.0.0.1:8787')).toMatch(/^[0-9a-f]{64}$/);
  expect(inviteEnrollSecret(code, context, 'http://10.8.0.1:8787')).toMatch(/^[0-9a-f]{64}$/);
});
it('keeps inviteEnrollSecret in parity with device-proof.mjs', async () => {
  const { inviteEnrollSecret: script } = await proofModule;
  expect(script(code, vectorContext.serverId, vectorContext.namespace, 'https://sync.example.net')).toBe(inviteEnrollSecret(code, vectorContext, 'https://sync.example.net'));
});
it('derives keys per epoch from serverId and namespace only, never from other context fields', () => {
  const key = Buffer.alloc(32, 7);
  const withDevice = { ...context, device: { id: 'a'.repeat(64), sign: () => Buffer.alloc(64), keyOf: () => undefined, revokedAt: () => undefined }, extra: 1 };
  expect(versionKey(key, withDevice, 1).equals(versionKey(key, context, 1))).toBe(true);
  expect(keyboxWrapKey(code, withDevice, 1).equals(keyboxWrapKey(code, context, 1))).toBe(true);
  expect(versionKey(key, context, 1).equals(versionKey(key, context, 2))).toBe(false);
  expect(() => versionKey(key, context, 0)).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
});
it('generates a 32 digit lower-case hex recovery code', () => {
  const generated = generateRecoveryCode(); expect(generated).toMatch(/^[0-9a-f]{32}$/); expect(normalizeRecoveryCode(generated)).toBe(generated);
  expect(generateRecoveryCode()).not.toBe(generated);
});
it('seals canonical v2 envelopes that open only for the same kind, namespace, epoch and key', () => {
  const key = versionKey(randomBytes(32), context, 1); const wire = sealSyncObject('version', { hello: 'world' }, key, context, 1);
  expect(parseSyncEnvelope(wire)).toEqual({ kind: 'version', epoch: 1 });
  const parsed = JSON.parse(wire); expect(Object.keys(parsed)).toEqual(['format', 'version', 'kind', 'epoch', 'cipher', 'payload']); expect(Object.keys(parsed.cipher)).toEqual(['algorithm', 'nonce', 'authTag']);
  expect(parsed.format).toBe(SYNC_OBJECT_FORMAT); expect(parsed.version).toBe(2); expect(JSON.stringify(parsed)).toBe(wire);
  expect(openSyncObject(wire, 'version', key, context, 1)).toEqual({ hello: 'world' });
  expect(() => openSyncObject(wire, 'version', key, { ...context, namespace: 'other' }, 1)).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
  expect(() => openSyncObject(wire, 'version', randomBytes(32), context, 1)).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
  expect(() => openSyncObject(wire, 'keybox', key, context, 1)).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
  expect(() => openSyncObject(wire, 'version', key, context, 2)).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
});
it('binds kind and epoch into the AAD: a relabelled envelope does not open', () => {
  const key = versionKey(randomBytes(32), context, 1); const wire = JSON.parse(sealSyncObject('version', { a: 1 }, key, context, 1));
  const relabelled = JSON.stringify({ ...wire, kind: 'keybox' });
  expect(parseSyncEnvelope(relabelled)).toEqual({ kind: 'keybox', epoch: 1 });
  expect(() => openSyncObject(relabelled, 'keybox', key, context, 1)).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
  const bumped = JSON.stringify({ ...wire, epoch: 2 });
  expect(() => openSyncObject(bumped, 'version', key, context, 2)).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
});
it('enforces the plaintext limit of 768 KiB with limit', () => {
  const key = versionKey(randomBytes(32), context, 1);
  expect(() => sealSyncObject('version', { big: 'x'.repeat(768 * 1024) }, key, context, 1)).toThrowError(expect.objectContaining({ code: 'limit' }));
  expect(() => sealSyncObject('version', { big: 'x'.repeat(700 * 1024) }, key, context, 1)).not.toThrow();
});
it('decides like the server validator on the envelope fixtures (K15)', async () => {
  const { validateSyncObject, isLegacyVaultObject } = await wireModule;
  const valid = sealSyncObject('keybox', { a: 1 }, randomBytes(32), context, 1); const o = JSON.parse(valid);
  const fixtures: Record<string, string> = {
    valid, validVersion: JSON.stringify({ ...o, kind: 'version' }), extraField: JSON.stringify({ ...o, extra: 1 }), kindOther: JSON.stringify({ ...o, kind: 'other' }),
    shortNonce: JSON.stringify({ ...o, cipher: { ...o.cipher, nonce: randomBytes(11).toString('base64') } }),
    shortTag: JSON.stringify({ ...o, cipher: { ...o.cipher, authTag: randomBytes(15).toString('base64') } }),
    nonCanonical: JSON.stringify({ ...o, payload: 'AAB=' }),
    emptyPayload: JSON.stringify({ ...o, payload: '' }), wrongVersion: JSON.stringify({ ...o, version: 1 }), v1: JSON.stringify({ format: o.format, version: 1, kind: o.kind, cipher: o.cipher, payload: o.payload }),
    epochMissing: JSON.stringify({ format: o.format, version: 2, kind: o.kind, cipher: o.cipher, payload: o.payload }), epoch0: JSON.stringify({ ...o, epoch: 0 }), epochFraction: JSON.stringify({ ...o, epoch: 1.5 }), epochBig: JSON.stringify({ ...o, epoch: 1_000_001 }), epochString: JSON.stringify({ ...o, epoch: '1' }), epochLast: JSON.stringify({ ...o, epoch: 1_000_000 }), wrongFormat: JSON.stringify({ ...o, format: 'x' }),
    wrongAlgorithm: JSON.stringify({ ...o, cipher: { ...o.cipher, algorithm: 'aes-128-gcm' } }),
    reordered: JSON.stringify({ kind: o.kind, format: o.format, version: o.version, epoch: o.epoch, cipher: o.cipher, payload: o.payload }), epochMisplaced: JSON.stringify({ format: o.format, version: 2, kind: o.kind, cipher: o.cipher, epoch: 1, payload: o.payload }),
    whitespace: JSON.stringify(o, null, 1), notJson: 'x', array: '[]', oversize: JSON.stringify({ ...o, payload: Buffer.alloc(1048576).toString('base64') }),
    legacy: JSON.stringify(sealDocument({ a: 1 }, randomBytes(32), { algorithm: 'argon2id', salt: randomBytes(16).toString('base64'), memoryKiB: 65536, iterations: 3, parallelism: 1 }, context, 'state')),
  };
  for (const [name, wire] of Object.entries(fixtures)) {
    let server: { kind: string; epoch: number } | null = null; try { server = validateSyncObject(wire); } catch { server = null; }
    expect(parseSyncEnvelope(wire), name).toEqual(server);
  }
  expect(parseSyncEnvelope(fixtures.valid)).toEqual({ kind: 'keybox', epoch: 1 }); expect(parseSyncEnvelope(fixtures.legacy)).toBeNull(); expect(isLegacyVaultObject(fixtures.legacy)).toBe(true); expect(isLegacyVaultObject(fixtures.valid)).toBe(false);
});
it('binds the checkpoint AAD to serverId and namespace only (B7)', () => {
  const key = randomBytes(32); const kdf = { algorithm: 'argon2id' as const, salt: randomBytes(16).toString('base64'), memoryKiB: 65536, iterations: 3, parallelism: 1 };
  const file = sealDocument({ x: 1 }, key, kdf, context, 'state');
  const richer = { ...context, serverUrl: 'https://elsewhere.test', device: { id: 'a'.repeat(64), sign: () => Buffer.alloc(64), keyOf: () => undefined, revokedAt: () => undefined } };
  expect(openDocument(file, key, kdf, richer, 'state')).toEqual({ x: 1 });
  expect(sealDocument({ x: 1 }, key, kdf, richer, 'state').format).toBe('terminus-encrypted-vault');
  expect(() => openDocument(file, key, kdf, { ...context, namespace: 'other' }, 'state')).toThrow(SyncFailure);
  expect(stable(['a'])).toBe('["a"]');
});
