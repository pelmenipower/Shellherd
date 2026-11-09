// Enrollment, session and request proofs for enrolled devices. Ed25519 signs tagged JSON arrays (domain separation).
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { deviceId } from './rendezvous.mjs';
export const DEVICE_ENROLLMENT = 'shellherd-device-enrollment-v1';
export const DEVICE_SESSION = 'shellherd-device-session-v1';
export const DEVICE_REQUEST = 'shellherd-device-request-v1';
export const DEVICE_NAME = /^[^\x00-\x1f\x7f]{1,80}$/;
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const check = ok => { if (!ok) throw Error('Device proof input rejected'); };
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const namespaceOk = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const WEAK_PROBE = Buffer.from('shellherd-weak-key-probe');
const IDENTITY_SIGNATURE = Buffer.concat([Buffer.from([1]), Buffer.alloc(63)]);
export function ed25519Spki(raw32) {
  check(Buffer.isBuffer(raw32) && raw32.length === 32);
  return Buffer.concat([SPKI_PREFIX, raw32]);
}
export function signingKeyOf(base64Raw32) {
  check(typeof base64Raw32 === 'string' && base64Raw32.length === 44);
  const raw = Buffer.from(base64Raw32, 'base64');
  check(raw.length === 32 && raw.toString('base64') === base64Raw32);
  const key = createPublicKey({ key: ed25519Spki(raw), format: 'der', type: 'spki' });
  // The identity point makes OpenSSL accept one signature for every message.
  check(verify(null, WEAK_PROBE, key, IDENTITY_SIGNATURE) === false);
  return key;
}
export function enrollmentBody(serverId, namespace, deviceIdValue, signingKeyB64, noiseKeyB64, name) {
  check(hex64(serverId) && namespaceOk(namespace) && hex64(deviceIdValue) && typeof signingKeyB64 === 'string' && signingKeyB64.length === 44 && typeof noiseKeyB64 === 'string' && noiseKeyB64.length === 60 && typeof name === 'string' && DEVICE_NAME.test(name));
  return JSON.stringify([DEVICE_ENROLLMENT, serverId, namespace, deviceIdValue, signingKeyB64, noiseKeyB64, name]);
}
export function sessionProof(serverId, namespace, nonce, deviceIdValue) {
  check(hex64(serverId) && namespaceOk(namespace) && hex64(nonce) && hex64(deviceIdValue));
  return JSON.stringify([DEVICE_SESSION, serverId, namespace, nonce, deviceIdValue]);
}
export function requestProofV2(serverId, namespace, method, path, nonce, deviceIdValue) {
  check(hex64(serverId) && namespaceOk(namespace) && ['GET', 'POST', 'PUT', 'DELETE'].includes(method) && typeof path === 'string' && path.startsWith('/v1/') && hex64(nonce) && hex64(deviceIdValue));
  return JSON.stringify([DEVICE_REQUEST, serverId, namespace, method, path, nonce, deviceIdValue]);
}
/** Scripts/tests/smoke/scenes only (Node crypto). Same shape as the main-process RemoteIdentity. */
export function createDeviceIdentity() {
  const noise = generateKeyPairSync('x25519'); const signing = generateKeyPairSync('ed25519');
  const publicKey = noise.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return { privateKey: noise.privateKey, publicKey, id: deviceId(publicKey), signingKey: signing.privateKey, signingPublicKey: signing.publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64') };
}
