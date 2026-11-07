// Client-side approval tools. Private administration/device keys never leave this module's caller.
import sodium from 'libsodium-wrappers';
import { createHash } from 'node:crypto';
import { RemoteStore } from './http-transport.mjs';
await sodium.ready;
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const b64 = value => sodium.to_base64(value, sodium.base64_variants.ORIGINAL);
const check = ok => { if (!ok) throw Error('Server device authorization rejected'); };
function bytes(value, size) {
  check(typeof value === 'string' && value.length < 256);
  const data = sodium.from_base64(value, sodium.base64_variants.ORIGINAL); check(data.length === size && b64(data) === value); return data;
}
export function enrollmentRequest(info, identity) {
  const body = ['shellherd-server-enrollment-v1', info.serverId, info.namespace, [...identity.public]];
  return [body, b64(sodium.crypto_sign_detached(JSON.stringify(body), identity.signing.privateKey))];
}
export function verifyEnrollment(info, item) {
  check(item && /^[a-f0-9]{64}$/.test(item.requestId));
  const document = item.document; check(Array.isArray(document) && document.length === 2);
  const [body, signature] = document;
  check(Array.isArray(body) && body.length === 4 && body[0] === 'shellherd-server-enrollment-v1' && body[1] === info.serverId && body[2] === info.namespace);
  const member = body[3]; check(Array.isArray(member) && member.length === 3 && /^[a-zA-Z0-9_-]{1,100}$/.test(member[0]));
  bytes(member[1], 32); bytes(member[2], 32);
  check(sodium.crypto_sign_verify_detached(bytes(signature, 64), JSON.stringify(body), bytes(member[1], 32)));
  check(item.fingerprint === digest(body) && JSON.stringify(item.device) === JSON.stringify(member));
  return { ...structuredClone(item), fingerprint: digest(body) };
}
export class DeviceAccess extends RemoteStore {
  async enroll() {
    const document = enrollmentRequest(this.info, this.identity);
    const result = verifyEnrollment(this.info, await this.request('POST', '/v1/enrollments', JSON.stringify(document)));
    check(JSON.stringify(result.document) === JSON.stringify(document) && JSON.stringify(result.device) === JSON.stringify(this.identity.public)); return result;
  }
  async enrollmentStatus(requestId) { check(/^[a-f0-9]{64}$/.test(requestId)); return this.request('GET', `/v1/enrollments/${requestId}`); }
  async withdraw(requestId) { check(/^[a-f0-9]{64}$/.test(requestId)); return this.request('DELETE', `/v1/enrollments/${requestId}`); }
  async pending() {
    const { pending } = await this.request('GET', '/v1/enrollments/pending');
    check(Array.isArray(pending) && pending.length <= 16); return pending.map(item => verifyEnrollment(this.info, item));
  }
  async accessStatus() { return this.request('GET', '/v1/access'); }
  async apply(document) { return this.request('PUT', '/v1/access', JSON.stringify(document)); }
}
export class ServerAdmin {
  #pair;
  #destroyed = false;
  #pins = new Map();
  constructor() { this.#pair = sodium.crypto_sign_keypair(); }
  get publicKey() { check(!this.#destroyed); return b64(this.#pair.publicKey); }
  #context(info) { check(/^[a-f0-9]{64}$/.test(info.serverId) && /^[a-zA-Z0-9_-]{1,100}$/.test(info.namespace)); return JSON.stringify([info.serverId, info.namespace]); }
  bootstrap(info, trustedDevices) {
    check(!this.#destroyed); const context = this.#context(info); check(!this.#pins.has(context) && this.#pins.size < 16);
    check(Array.isArray(trustedDevices) && trustedDevices.length > 0 && trustedDevices.length <= 16 && new Set(trustedDevices.map(d => d?.[0])).size === trustedDevices.length);
    for (const entry of trustedDevices) check(Array.isArray(entry) && entry.length === 3 && entry[2] === null && /^[a-zA-Z0-9_-]{1,100}$/.test(entry[0]) && bytes(entry[1], 32));
    this.#pins.set(context, { serverId: info.serverId, namespace: info.namespace, revision: 0, digest: null, devices: structuredClone(trustedDevices), access: null });
  }
  #verifyStatus(info, status) {
    check(status && status.serverId === info.serverId && status.namespace === info.namespace && Number.isSafeInteger(status.revision) && status.revision >= 0);
    check(Array.isArray(status.devices) && status.devices.length > 0 && status.devices.length <= 16 && new Set(status.devices.map(d => d?.[0])).size === status.devices.length);
    for (const entry of status.devices) check(Array.isArray(entry) && entry.length === 3 && typeof entry[0] === 'string' && bytes(entry[1], 32));
    if (status.revision === 0) check(status.access === null && status.digest === null);
    else {
      const [body, signature] = status.access ?? [];
      check(Array.isArray(body) && body.length === 7 && body[0] === 'shellherd-server-access-v1' && body[1] === info.serverId && body[2] === info.namespace && body[3] === status.revision);
      check(sodium.crypto_sign_verify_detached(bytes(signature, 64), JSON.stringify(body), this.#pair.publicKey));
      check(status.digest === digest(status.access) && JSON.stringify(body[5]) === JSON.stringify(status.devices));
    }
  }
  acceptStatus(info, status) {
    check(!this.#destroyed); this.#verifyStatus(info, status);
    const context = this.#context(info); const pin = this.#pins.get(context); check(pin);
    if (status.revision === pin.revision) check(status.digest === pin.digest && JSON.stringify(status.devices) === JSON.stringify(pin.devices));
    else check(status.revision === pin.revision + 1 && status.access[0][4] === pin.digest);
    this.#pins.set(context, structuredClone(status));
  }
  #sign(info, status, devices, operation) {
    check(!this.#destroyed); this.#verifyStatus(info, status);
    const pin = this.#pins.get(this.#context(info));
    check(pin && status.revision === pin.revision && status.digest === pin.digest && JSON.stringify(status.devices) === JSON.stringify(pin.devices));
    const body = ['shellherd-server-access-v1', info.serverId, info.namespace, status.revision + 1, status.digest,
      [...devices].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0), operation];
    return [body, b64(sodium.crypto_sign_detached(JSON.stringify(body), this.#pair.privateKey))];
  }
  approve(info, status, item, independentlyComparedFingerprint) {
    check(!this.#destroyed); const request = verifyEnrollment(info, item);
    check(typeof independentlyComparedFingerprint === 'string' && independentlyComparedFingerprint === request.fingerprint);
    check(!status.devices.some(d => d[0] === request.device[0]));
    return this.#sign(info, status, [...status.devices, [request.device[0], request.device[1], request.requestId]], ['approve', request.device[0], [request.requestId, request.fingerprint]]);
  }
  revoke(info, status, deviceId) {
    check(typeof deviceId === 'string' && status.devices.some(d => d[0] === deviceId));
    return this.#sign(info, status, status.devices.filter(d => d[0] !== deviceId), ['revoke', deviceId, null]);
  }
  exportState() { check(!this.#destroyed); return ['shellherd-server-admin-v1', b64(this.#pair.privateKey), structuredClone([...this.#pins])]; }
  static restore(state) {
    check(Array.isArray(state) && state.length === 3 && state[0] === 'shellherd-server-admin-v1' && Array.isArray(state[2]) && state[2].length <= 16);
    const key = bytes(state[1], 64); const pair = sodium.crypto_sign_seed_keypair(key.subarray(0, 32));
    try {
      check(sodium.memcmp(key, pair.privateKey)); const admin = new ServerAdmin(); admin.destroy(); admin.#pair = pair; admin.#destroyed = false;
      for (const entry of state[2]) {
        check(Array.isArray(entry) && entry.length === 2); const [context, pin] = entry;
        check(admin.#context(pin) === context && !admin.#pins.has(context)); admin.#verifyStatus(pin, pin);
        admin.#pins.set(context, structuredClone(pin));
      }
      return admin;
    }
    catch (error) { sodium.memzero(pair.privateKey); throw error; } finally { sodium.memzero(key); }
  }
  destroy() { this.#destroyed = true; sodium.memzero(this.#pair.privateKey); }
}
