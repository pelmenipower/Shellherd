// Enrolled-device sessions transport encrypted sync objects; the server never sees the Vault password.
import { createHash, sign } from 'node:crypto';
import { boundedJson } from './http-common.mjs';
import { normalizeSyncServerUrl } from '../../src/shared/sync-server-url.mjs';
import { DEVICE_NAME, enrollmentBody, sessionProof, requestProofV2, signingKeyOf } from './device-proof.mjs';
import { validateSyncObject, isLegacyVaultObject } from './sync-object-wire.mjs';
const check = ok => { if (!ok) throw Error('Account sync rejected'); };
const HEX64 = /^[a-f0-9]{64}$/;
const sha = wire => createHash('sha256').update(wire).digest('hex');
export class AccountStore {
  #token; #closed = false;
  constructor(info, { signal } = {}) {
    check(normalizeSyncServerUrl(info.serverUrl, { loopback: true, private: true }) === info.serverUrl && info.authentication === 'enrolled-device' && info.deviceSessions === true && HEX64.test(info.serverId) && /^[a-zA-Z0-9_-]{1,100}$/.test(info.namespace));
    this.info = info; this.signal = signal;
  }
  async enroll(identity, { username, password, name, ephemeral }) {
    check(!this.#closed && !this.signal?.aborted);
    check(typeof username === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(username) && typeof password === 'string' && password.length > 0 && password.length <= 1024 && typeof ephemeral === 'boolean');
    const body = enrollmentBody(this.info.serverId, this.info.namespace, identity.id, identity.signingPublicKey, identity.publicKey, name);
    const enrollment = [JSON.parse(body), sign(null, Buffer.from(body), identity.signingKey).toString('base64')];
    const { device } = await boundedJson(new URL('v1/devices', this.info.serverUrl), { method: 'POST', signal: this.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password, enrollment, ephemeral }) }, 4096);
    check(!this.#closed && !this.signal?.aborted && device && typeof device === 'object' && device.id === identity.id && typeof device.name === 'string' && DEVICE_NAME.test(device.name) && Number.isSafeInteger(device.enrolledAt) && typeof device.ephemeral === 'boolean');
    return { id: device.id, name: device.name, enrolledAt: device.enrolledAt, ephemeral: device.ephemeral };
  }
  async #challenge() {
    const { nonce } = await boundedJson(new URL('v1/challenge', this.info.serverUrl), { signal: this.signal }, 4096);
    check(!this.#closed && !this.signal?.aborted && HEX64.test(nonce)); return nonce;
  }
  async openSession(identity) {
    check(!this.#closed && !this.signal?.aborted);
    const nonce = await this.#challenge();
    const signature = sign(null, Buffer.from(sessionProof(this.info.serverId, this.info.namespace, nonce, identity.id)), identity.signingKey).toString('base64');
    const result = await boundedJson(new URL('v1/session', this.info.serverUrl), { method: 'POST', signal: this.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ device: identity.id, nonce, signature }) }, 4096);
    check(!this.#closed && !this.signal?.aborted && typeof result.token === 'string' && HEX64.test(result.token) && Number.isSafeInteger(result.expiresAt) && result.device === identity.id);
    this.#token = result.token; return { signedIn: true, expiresAt: result.expiresAt, device: result.device };
  }
  async devices() {
    const { devices } = await this.request('GET', '/v1/devices');
    check(Array.isArray(devices) && devices.length <= 64);
    const ids = new Set();
    for (const item of devices) {
      check(item && typeof item === 'object' && !Array.isArray(item) && Object.keys(item).sort().join(',') === 'enrolledAt,ephemeral,id,name,revokedAt,self,signingKey');
      check(typeof item.id === 'string' && HEX64.test(item.id) && !ids.has(item.id)); ids.add(item.id);
      check(typeof item.name === 'string' && DEVICE_NAME.test(item.name) && typeof item.signingKey === 'string');
      try { signingKeyOf(item.signingKey); } catch { check(false); }
      check(Number.isSafeInteger(item.enrolledAt) && (item.revokedAt === null || Number.isSafeInteger(item.revokedAt)) && typeof item.ephemeral === 'boolean');
    }
    // The server-provided self flag is dropped; callers compute it from identity.id.
    return devices.map(({ id, name, signingKey, enrolledAt, revokedAt, ephemeral }) => ({ id, name, signingKey, enrolledAt, revokedAt, ephemeral }));
  }
  async revoke(identity, id) {
    check(!this.#closed && this.#token && !this.signal?.aborted && typeof id === 'string' && HEX64.test(id));
    const nonce = await this.#challenge(); const path = `/v1/devices/${id}`;
    const signature = sign(null, Buffer.from(requestProofV2(this.info.serverId, this.info.namespace, 'DELETE', path, nonce, identity.id)), identity.signingKey).toString('base64');
    const result = await boundedJson(new URL(path, this.info.serverUrl), { method: 'DELETE', signal: this.signal, headers: { authorization: `Bearer ${this.#token}`, 'x-shellherd-device': identity.id, 'x-shellherd-nonce': nonce, 'x-shellherd-signature': signature } }, 4096);
    check(result.revoked === true); return { revoked: true };
  }
  async request(method, path, body) {
    check(!this.#closed && this.#token && !this.signal?.aborted);
    check(typeof path === 'string' && path.startsWith('/v1/') && new URL(path, this.info.serverUrl).origin === new URL(this.info.serverUrl).origin);
    return boundedJson(new URL(path, this.info.serverUrl), { method, signal: this.signal, headers: { authorization: `Bearer ${this.#token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body }) });
  }
  async list() {
    const { objects } = await this.request('GET', `/v1/vaults/${this.info.namespace}/objects`);
    check(Array.isArray(objects) && objects.length <= 100 && new Set(objects).size === objects.length && objects.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id))); return objects;
  }
  async put(wire) {
    validateSyncObject(wire); const result = await this.request('PUT', `/v1/vaults/${this.info.namespace}/objects`, wire);
    check(result.id === sha(wire)); return result.id;
  }
  async get(id) {
    check(typeof id === 'string' && /^[a-f0-9]{64}$/.test(id));
    const result = await this.request('GET', `/v1/vaults/${this.info.namespace}/objects/${id}`);
    check(result.id === id && typeof result.wire === 'string' && sha(result.wire) === id); check(isLegacyVaultObject(result.wire) || (validateSyncObject(result.wire), true)); return result.wire;
  }
  async remove(id) {
    check(typeof id === 'string' && /^[a-f0-9]{64}$/.test(id));
    try {
      const result = await this.request('DELETE', `/v1/vaults/${this.info.namespace}/objects/${id}`);
      check(result.removed === true); return true;
    } catch (error) { if (error.status === 404) return false; throw error; }
  }
  async refresh() { const result = await this.request('POST', '/v1/refresh'); check(Number.isSafeInteger(result.expiresAt)); return { expiresAt: result.expiresAt }; }
  async logout() { try { if (this.#token && !this.#closed) await this.request('POST', '/v1/logout'); } finally { this.close(); } }
  close() { this.#closed = true; this.#token = undefined; }
}
