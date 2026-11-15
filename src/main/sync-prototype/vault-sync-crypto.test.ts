import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { SYNC_OBJECT_FORMAT, SyncFailure, generateRecoveryCode, keyboxWrapKey, openDocument, openSyncObject, parseSyncEnvelope, sealDocument, sealSyncObject, stable, versionKey } from './vault-sync-crypto';
import { normalizeRecoveryCode } from '../../shared/recovery-code';

const context = { serverId: 'b'.repeat(64), namespace: 'test' };
const wireModule = import(/* @vite-ignore */ pathToFileURL(resolve(__dirname, '../../../scripts/sync-prototype/sync-object-wire.mjs')).href) as Promise<{
  validateSyncObject(wire: string): { kind: string }; isLegacyVaultObject(wire: string): boolean;
}>;
const code = '000102030405060708090a0b0c0d0e0f';

it('uses fixed HKDF vectors for the version key and the keybox wrap key', () => {
  expect(versionKey(Buffer.alloc(32, 7), context).toString('hex')).toBe('252409fd9ccc357f71891715b26e7ac4fcde56de4bdcc1bb4d0e93ffdcca672a');
  expect(keyboxWrapKey(code, context).toString('hex')).toBe('7593ca0d4e9879a1cbf689d7ac3b2ea500b77bb8c26ecd7bc4343e7878b61985');
  expect(keyboxWrapKey('0001-0203 0405-0607-0809-0A0B-0C0D-0E0F', context).toString('hex')).toBe(keyboxWrapKey(code, context).toString('hex'));
  expect(() => keyboxWrapKey('xyz', context)).toThrowError(expect.objectContaining({ code: 'recoveryCode' }));
});
it('derives keys from serverId and namespace only, never from other context fields', () => {
  const key = Buffer.alloc(32, 7);
  const withDevice = { ...context, device: { id: 'a'.repeat(64), sign: () => Buffer.alloc(64), keyOf: () => undefined, revokedAt: () => undefined }, extra: 1 };
  expect(versionKey(key, withDevice).equals(versionKey(key, context))).toBe(true);
  expect(keyboxWrapKey(code, withDevice).equals(keyboxWrapKey(code, context))).toBe(true);
});
it('generates a 32 digit lower-case hex recovery code', () => {
  const generated = generateRecoveryCode(); expect(generated).toMatch(/^[0-9a-f]{32}$/); expect(normalizeRecoveryCode(generated)).toBe(generated);
  expect(generateRecoveryCode()).not.toBe(generated);
});
it('seals canonical envelopes that open only for the same kind, namespace and key', () => {
  const key = versionKey(randomBytes(32), context); const wire = sealSyncObject('version', { hello: 'world' }, key, context);
  expect(parseSyncEnvelope(wire)).toEqual({ kind: 'version' });
  const parsed = JSON.parse(wire); expect(Object.keys(parsed)).toEqual(['format', 'version', 'kind', 'cipher', 'payload']); expect(Object.keys(parsed.cipher)).toEqual(['algorithm', 'nonce', 'authTag']);
  expect(parsed.format).toBe(SYNC_OBJECT_FORMAT); expect(JSON.stringify(parsed)).toBe(wire);
  expect(openSyncObject(wire, 'version', key, context)).toEqual({ hello: 'world' });
  expect(() => openSyncObject(wire, 'version', key, { ...context, namespace: 'other' })).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
  expect(() => openSyncObject(wire, 'version', randomBytes(32), context)).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
  expect(() => openSyncObject(wire, 'keybox', key, context)).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
});
it('binds the kind into the AAD: a version relabelled as keybox does not open', () => {
  const key = versionKey(randomBytes(32), context); const wire = JSON.parse(sealSyncObject('version', { a: 1 }, key, context));
  const relabelled = JSON.stringify({ ...wire, kind: 'keybox' });
  expect(parseSyncEnvelope(relabelled)).toEqual({ kind: 'keybox' });
  expect(() => openSyncObject(relabelled, 'keybox', key, context)).toThrowError(expect.objectContaining({ code: 'wrongVault' }));
});
it('enforces the plaintext limit of 768 KiB with limit', () => {
  const key = versionKey(randomBytes(32), context);
  expect(() => sealSyncObject('version', { big: 'x'.repeat(768 * 1024) }, key, context)).toThrowError(expect.objectContaining({ code: 'limit' }));
  expect(() => sealSyncObject('version', { big: 'x'.repeat(700 * 1024) }, key, context)).not.toThrow();
});
it('decides like the server validator on the envelope fixtures (K15)', async () => {
  const { validateSyncObject, isLegacyVaultObject } = await wireModule;
  const valid = sealSyncObject('keybox', { a: 1 }, randomBytes(32), context); const o = JSON.parse(valid);
  const fixtures: Record<string, string> = {
    valid, validVersion: JSON.stringify({ ...o, kind: 'version' }), extraField: JSON.stringify({ ...o, extra: 1 }), kindOther: JSON.stringify({ ...o, kind: 'other' }),
    shortNonce: JSON.stringify({ ...o, cipher: { ...o.cipher, nonce: randomBytes(11).toString('base64') } }),
    shortTag: JSON.stringify({ ...o, cipher: { ...o.cipher, authTag: randomBytes(15).toString('base64') } }),
    nonCanonical: JSON.stringify({ ...o, payload: 'AAB=' }),
    emptyPayload: JSON.stringify({ ...o, payload: '' }), wrongVersion: JSON.stringify({ ...o, version: 2 }), wrongFormat: JSON.stringify({ ...o, format: 'x' }),
    wrongAlgorithm: JSON.stringify({ ...o, cipher: { ...o.cipher, algorithm: 'aes-128-gcm' } }),
    reordered: JSON.stringify({ kind: o.kind, format: o.format, version: o.version, cipher: o.cipher, payload: o.payload }),
    whitespace: JSON.stringify(o, null, 1), notJson: 'x', array: '[]', oversize: JSON.stringify({ ...o, payload: Buffer.alloc(1048576).toString('base64') }),
    legacy: JSON.stringify(sealDocument({ a: 1 }, randomBytes(32), { algorithm: 'argon2id', salt: randomBytes(16).toString('base64'), memoryKiB: 65536, iterations: 3, parallelism: 1 }, context, 'state')),
  };
  for (const [name, wire] of Object.entries(fixtures)) {
    let server: { kind: string } | null = null; try { server = validateSyncObject(wire); } catch { server = null; }
    expect(parseSyncEnvelope(wire), name).toEqual(server);
  }
  expect(parseSyncEnvelope(fixtures.valid)).toEqual({ kind: 'keybox' }); expect(parseSyncEnvelope(fixtures.legacy)).toBeNull(); expect(isLegacyVaultObject(fixtures.legacy)).toBe(true); expect(isLegacyVaultObject(fixtures.valid)).toBe(false);
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
