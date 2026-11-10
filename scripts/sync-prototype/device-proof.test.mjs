import { generateKeyPairSync, sign, verify } from 'node:crypto';
import { expect, it } from 'vitest';
import { DEVICE_ENROLLMENT, DEVICE_REQUEST, DEVICE_SESSION, createDeviceIdentity, ed25519Spki, enrollmentBody, requestProofV2, sessionProof, signingKeyOf } from './device-proof.mjs';
import { deviceId } from './rendezvous.mjs';

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
  expect([DEVICE_ENROLLMENT, DEVICE_SESSION, DEVICE_REQUEST]).toEqual(['shellherd-device-enrollment-v2', 'shellherd-device-session-v2', 'shellherd-device-request-v3']);
});
it('builds tagged JSON arrays for the three proofs', () => {
  const { publicKey, signingPublicKey } = createDeviceIdentity();
  expect(JSON.parse(enrollmentBody(server, 'ns', origin, device, signingPublicKey, publicKey, 'Laptop'))).toEqual([DEVICE_ENROLLMENT, server, 'ns', origin, device, signingPublicKey, publicKey, 'Laptop']);
  expect(JSON.parse(sessionProof(server, 'ns', origin, nonce, device))).toEqual([DEVICE_SESSION, server, 'ns', origin, nonce, device]);
  expect(JSON.parse(requestProofV2(server, 'ns', origin, 'DELETE', '/v1/devices/' + device, nonce, device))).toEqual([DEVICE_REQUEST, server, 'ns', origin, 'DELETE', '/v1/devices/' + device, nonce, device]);
});
it('validates every input of the proofs', () => {
  const { publicKey, signingPublicKey } = createDeviceIdentity();
  const enroll = (...patch) => { const a = [server, 'ns', origin, device, signingPublicKey, publicKey, 'Laptop']; patch.forEach(([i, v]) => { a[i] = v; }); return () => enrollmentBody(...a); };
  expect(enroll([0, 'x'])).toThrow(); expect(enroll([1, 'bad ns'])).toThrow(); expect(enroll([3, 'C'.repeat(64)])).toThrow();
  expect(enroll([5, publicKey.slice(1)])).toThrow(); expect(enroll([6, ''])).toThrow(); expect(enroll([6, 'a\nb'])).toThrow(); expect(enroll([6, 'x'.repeat(65)])).toThrow(); expect(enroll([6, '3f9a12c4'])).toThrow();
  for (const bad of ['https://sync.example.org/', 'https://Sync.example.org', 'https://sync.example.org:443', 'https://sync.example.org/x', 'ftp://x', '', 7]) expect(enroll([2, bad])).toThrow();
  expect(() => sessionProof(server, 'ns', origin, 'short', device)).toThrow(); expect(() => sessionProof(server, '', origin, nonce, device)).toThrow(); expect(() => sessionProof(server, 'ns', origin + '/', nonce, device)).toThrow();
  expect(() => requestProofV2(server, 'ns', origin, 'PATCH', '/v1/x', nonce, device)).toThrow();
  expect(() => requestProofV2(server, 'ns', origin, 'GET', '/other', nonce, device)).toThrow();
  expect(JSON.parse(sessionProof(server, 'ns', 'http://127.0.0.1:8787', nonce, device))[3]).toBe('http://127.0.0.1:8787');
});
it('creates an identity whose id matches the X25519 key and whose signatures verify', () => {
  const identity = createDeviceIdentity();
  expect(identity.id).toBe(deviceId(identity.publicKey)); expect(identity.publicKey).toHaveLength(60);
  const signature = sign(null, Buffer.from('x'), identity.signingKey);
  expect(signature).toHaveLength(64); expect(verify(null, Buffer.from('x'), signingKeyOf(identity.signingPublicKey), signature)).toBe(true);
});
