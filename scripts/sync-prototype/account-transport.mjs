// Password login transports encrypted Vault files; no device pairing or Vault password.
import { createHash } from 'node:crypto';
import { boundedJson } from './http-common.mjs';
import { normalizeSyncServerUrl } from '../../src/shared/sync-server-url.mjs';
import { validateVaultFile } from './vault-file-wire.mjs';
const check = ok => { if (!ok) throw Error('Account sync rejected'); };
const sha = wire => createHash('sha256').update(wire).digest('hex');
export class AccountStore {
  #token; #closed = false;
  constructor(info, { signal } = {}) {
    check(normalizeSyncServerUrl(info.serverUrl, true) === info.serverUrl && info.authentication === 'password' && /^[a-zA-Z0-9_-]{1,100}$/.test(info.namespace));
    this.info = info; this.signal = signal;
  }
  async login(username, password) {
    check(!this.#closed && !this.#token);
    check(typeof username === 'string' && /^[a-zA-Z0-9_.-]{1,64}$/.test(username) && typeof password === 'string' && password.length > 0 && password.length <= 1024);
    const result = await boundedJson(new URL('v1/login', this.info.serverUrl), { method: 'POST', signal: this.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) }, 4096);
    check(!this.#closed && !this.signal?.aborted && typeof result.token === 'string' && /^[a-f0-9]{64}$/.test(result.token) && Number.isSafeInteger(result.expiresAt));
    this.#token = result.token; return { signedIn: true, expiresAt: result.expiresAt };
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
    validateVaultFile(wire); const result = await this.request('PUT', `/v1/vaults/${this.info.namespace}/objects`, wire);
    check(result.id === sha(wire)); return result.id;
  }
  async get(id) {
    check(typeof id === 'string' && /^[a-f0-9]{64}$/.test(id));
    const result = await this.request('GET', `/v1/vaults/${this.info.namespace}/objects/${id}`);
    check(result.id === id && typeof result.wire === 'string' && sha(result.wire) === id); validateVaultFile(result.wire); return result.wire;
  }
  async refresh() { const result = await this.request('POST', '/v1/refresh'); check(Number.isSafeInteger(result.expiresAt)); return { expiresAt: result.expiresAt }; }
  async logout() { try { if (this.#token && !this.#closed) await this.request('POST', '/v1/logout'); } finally { this.close(); } }
  close() { this.#closed = true; this.#token = undefined; }
}
