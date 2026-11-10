// Enrollment, session and request proofs for enrolled devices. Ed25519 signs tagged JSON arrays (domain separation).
import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { deviceId } from './rendezvous.mjs';
import { isDeviceName } from './device-name.mjs';
import { normalizeSyncServerUrl } from '../../src/shared/sync-server-url.mjs';
export const DEVICE_ENROLLMENT = 'shellherd-device-enrollment-v2';
export const DEVICE_SESSION = 'shellherd-device-session-v2';
export const DEVICE_REQUEST = 'shellherd-device-request-v3';
const SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');
const check = ok => { if (!ok) throw Error('Device proof input rejected'); };
const hex64 = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
// Canonical origin: no slash, no path, lowercase, no default port (loopback and private http allowed; callers may restrict further).
export const originOk = value => typeof value === 'string' && normalizeSyncServerUrl(value + '/', { loopback: true, private: true }) === value + '/';
const namespaceOk = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
// Ed25519 points of small order (sign bit cleared), plus every non-canonical y >= p. A key on one of them lets
// signatures verify for many messages; OpenSSL's acceptance varies by version, so the bytes are checked directly.
const SMALL_ORDER_Y = ['0100000000000000000000000000000000000000000000000000000000000000', 'ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f',
  '0000000000000000000000000000000000000000000000000000000000000000', 'c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a',
  '26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05'];
const FIELD_P = (1n << 255n) - 19n;
export function weakEd25519(raw32) {
  const y = Buffer.from(raw32); y[31] &= 0x7f;
  if (BigInt('0x' + Buffer.from(y).reverse().toString('hex')) >= FIELD_P) return true;
  return SMALL_ORDER_Y.includes(y.toString('hex'));
}
export function ed25519Spki(raw32) {
  check(Buffer.isBuffer(raw32) && raw32.length === 32);
  return Buffer.concat([SPKI_PREFIX, raw32]);
}
export function signingKeyOf(base64Raw32) {
  check(typeof base64Raw32 === 'string' && base64Raw32.length === 44);
  const raw = Buffer.from(base64Raw32, 'base64');
  check(raw.length === 32 && raw.toString('base64') === base64Raw32);
  check(!weakEd25519(raw));
  return createPublicKey({ key: ed25519Spki(raw), format: 'der', type: 'spki' });
}
export function enrollmentBody(serverId, namespace, origin, deviceIdValue, signingKeyB64, noiseKeyB64, name) {
  check(hex64(serverId) && namespaceOk(namespace) && originOk(origin) && hex64(deviceIdValue) && typeof signingKeyB64 === 'string' && signingKeyB64.length === 44 && typeof noiseKeyB64 === 'string' && noiseKeyB64.length === 60 && isDeviceName(name));
  return JSON.stringify([DEVICE_ENROLLMENT, serverId, namespace, origin, deviceIdValue, signingKeyB64, noiseKeyB64, name]);
}
export function sessionProof(serverId, namespace, origin, nonce, deviceIdValue) {
  check(hex64(serverId) && namespaceOk(namespace) && originOk(origin) && hex64(nonce) && hex64(deviceIdValue));
  return JSON.stringify([DEVICE_SESSION, serverId, namespace, origin, nonce, deviceIdValue]);
}
export function requestProofV2(serverId, namespace, origin, method, path, nonce, deviceIdValue) {
  check(hex64(serverId) && namespaceOk(namespace) && originOk(origin) && ['GET', 'POST', 'PUT', 'DELETE'].includes(method) && typeof path === 'string' && path.startsWith('/v1/') && hex64(nonce) && hex64(deviceIdValue));
  return JSON.stringify([DEVICE_REQUEST, serverId, namespace, origin, method, path, nonce, deviceIdValue]);
}
/** Scripts/tests/smoke/scenes only (Node crypto). Same shape as the main-process RemoteIdentity. */
export function createDeviceIdentity() {
  const noise = generateKeyPairSync('x25519'); const signing = generateKeyPairSync('ed25519');
  const publicKey = noise.publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  return { privateKey: noise.privateKey, publicKey, id: deviceId(publicKey), signingKey: signing.privateKey, signingPublicKey: signing.publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64') };
}
