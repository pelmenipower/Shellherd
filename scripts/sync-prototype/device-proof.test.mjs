import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { expect, it } from 'vitest';
import { DEVICE_ENROLLMENT, DEVICE_REQUEST, DEVICE_SESSION, createDeviceIdentity, ed25519Spki, enrollmentBody, inviteEnrollSecret, requestProofV3, sessionProof, signingKeyOf } from './device-proof.mjs';
import { deviceId } from './rendezvous.mjs';

const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const origin = 'https://sync.example.org'; const server = 'a'.repeat(64); const nonce = 'b'.repeat(64); const device = 'c'.repeat(64);
it('wraps a raw Ed25519 key in SPKI and rejects other lengths', () => {
  const pair = generateKeyPairSync('ed25519'); const spki = pair.publicKey.export({ format: 'der', type: 'spki' });
  expect(ed25519Spki(spki.subarray(12))).toEqual(spki);
  expect(() => ed25519Spki(Buffer.alloc(31))).toThrow(); expect(() => ed25519Spki(Buffer.alloc(33))).toThrow();
});
it('accepts canonical keys and rejects bad base64, wrong lengths and the identity point (K5)', () => {
  const identity = createDeviceIdentity();
  expect(signingKeyOf(identity.signingPublicKey).asymmetricKeyType).toBe('ed25519');
  expect(() => signingKeyOf(identity.signingPublicKey.slice(0, -2))).toThrow();
  expect(() => signingKeyOf(Buffer.alloc(31).toString('base64'))).toThrow();
  expect(() => signingKeyOf(identity.signingPublicKey.replace(/=$/, 'A'))).toThrow();
  const point = Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]).toString('base64');
  expect(() => signingKeyOf(point)).toThrow();
});
it('uses the v2/v3 domain tags', () => {
  expect([DEVICE_ENROLLMENT, DEVICE_SESSION, DEVICE_REQUEST]).toEqual(['shellherd-device-enrollment-v2', 'shellherd-device-session-v2', 'shellherd-device-request-v4']);
});
it('builds tagged JSON arrays for the three proofs', () => {
  const { publicKey, signingPublicKey } = createDeviceIdentity();
  expect(JSON.parse(enrollmentBody(server, 'ns', origin, device, signingPublicKey, publicKey, 'Laptop'))).toEqual([DEVICE_ENROLLMENT, server, 'ns', origin, device, signingPublicKey, publicKey, 'Laptop']);
  expect(JSON.parse(sessionProof(server, 'ns', origin, nonce, device))).toEqual([DEVICE_SESSION, server, 'ns', origin, nonce, device]);
  expect(JSON.parse(requestProofV3(server, 'ns', origin, 'DELETE', '/v1/devices/' + device, nonce, device, EMPTY))).toEqual([DEVICE_REQUEST, server, 'ns', origin, 'DELETE', '/v1/devices/' + device, nonce, device, EMPTY]);
});
it('validates every input of the proofs', () => {
  const { publicKey, signingPublicKey } = createDeviceIdentity();
  const enroll = (...patch) => { const a = [server, 'ns', origin, device, signingPublicKey, publicKey, 'Laptop']; patch.forEach(([i, v]) => { a[i] = v; }); return () => enrollmentBody(...a); };
  expect(enroll([0, 'x'])).toThrow(); expect(enroll([1, 'bad ns'])).toThrow(); expect(enroll([3, 'C'.repeat(64)])).toThrow();
  expect(enroll([5, publicKey.slice(1)])).toThrow(); expect(enroll([6, ''])).toThrow(); expect(enroll([6, 'a\nb'])).toThrow(); expect(enroll([6, 'x'.repeat(65)])).toThrow(); expect(enroll([6, '3f9a12c4'])).toThrow();
  for (const bad of ['https://sync.example.org/', 'https://Sync.example.org', 'https://sync.example.org:443', 'https://sync.example.org/x', 'ftp://x', '', 7]) expect(enroll([2, bad])).toThrow();
  expect(() => sessionProof(server, 'ns', origin, 'short', device)).toThrow(); expect(() => sessionProof(server, '', origin, nonce, device)).toThrow(); expect(() => sessionProof(server, 'ns', origin + '/', nonce, device)).toThrow();
  expect(() => requestProofV3(server, 'ns', origin, 'PATCH', '/v1/x', nonce, device, EMPTY)).toThrow();
  expect(() => requestProofV3(server, 'ns', origin, 'GET', '/other', nonce, device, EMPTY)).toThrow();
  expect(JSON.parse(sessionProof(server, 'ns', 'http://127.0.0.1:8787', nonce, device))[3]).toBe('http://127.0.0.1:8787');
});
it('requires a hex64 body digest in the request proof', () => {
  for (const bad of ['', 'E'.repeat(64), 'a'.repeat(63), undefined, 5]) expect(() => requestProofV3(server, 'ns', origin, 'POST', '/v1/invites', nonce, device, bad)).toThrow();
});
it('derives the enrollment secret from the code, bound to server, namespace and origin (vector)', () => {
  const code = '000102030405060708090a0b0c0d0e0f'; const id = 'ab'.repeat(32);
  expect(inviteEnrollSecret(code, id, 'ns', 'https://sync.example.net')).toBe('5792f83741f1740cd38f0039dfb03e44ab40757e0dc67ae50719894dabf55b4e');
  expect(inviteEnrollSecret(code, id, 'ns', 'https://other.example.net')).not.toBe(inviteEnrollSecret(code, id, 'ns', 'https://sync.example.net'));
  for (const bad of ['', code.toUpperCase(), code.slice(2), code + '00', 5]) expect(() => inviteEnrollSecret(bad, id, 'ns', 'https://sync.example.net')).toThrow();
  expect(() => inviteEnrollSecret(code, id, 'ns', 'https://sync.example.net/')).toThrow();
});
it('creates an identity whose id matches the X25519 key and whose signatures verify', () => {
  const identity = createDeviceIdentity();
  expect(identity.id).toBe(deviceId(identity.publicKey)); expect(identity.publicKey).toHaveLength(60);
  const signature = sign(null, Buffer.from('x'), identity.signingKey);
  expect(signature).toHaveLength(64); expect(verify(null, Buffer.from('x'), signingKeyOf(identity.signingPublicKey), signature)).toBe(true);
});
it('keeps the SPKI prefix in lab-host.ts identical to device-proof.mjs', async () => {
  const { readFile } = await import('node:fs/promises');
  const pick = async path => (await readFile(new URL(path, import.meta.url), 'utf8')).match(/SPKI_PREFIX = Buffer\.from\('([0-9a-f]+)', 'hex'\)/)?.[1];
  const expected = '302a300506032b6570032100';
  expect(await pick('./device-proof.mjs')).toBe(expected);
  expect(await pick('../../src/main/sync-prototype/lab-host.ts')).toBe(expected);
});
