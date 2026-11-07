// Client side only: private device signatures stay here, never on the server.
import sodium from 'libsodium-wrappers';
import { createHash } from 'node:crypto';
import { normalizeSyncServerUrl } from '../../src/shared/sync-server-url.mjs';
import { requestProof } from './http-proof.mjs';
await sodium.ready;
const sha = value => createHash('sha256').update(value).digest('hex');
const check = ok => { if (!ok) throw Error('Sync transport rejected'); };
import { boundedJson } from './http-common.mjs';
export { boundedJson, probeSyncServer } from './http-common.mjs';
export class RemoteStore {
  constructor(info, identity, { signal } = {}) {
    check(normalizeSyncServerUrl(info.serverUrl, true) === info.serverUrl && /^[a-f0-9]{64}$/.test(info.serverId) && /^[a-zA-Z0-9_-]{1,100}$/.test(info.namespace));
    this.info = info; this.identity = identity; this.signal = signal;
  }
  async request(method, path, body = '') {
    const { nonce } = await boundedJson(new URL('v1/challenge', this.info.serverUrl), { signal: this.signal }, 4096);
    check(!this.signal?.aborted);
    check(typeof nonce === 'string' && /^[a-f0-9]{64}$/.test(nonce));
    const proof = requestProof(this.info.serverId, this.info.serverUrl, method, path, nonce, this.identity.id, body);
    const signature = sodium.to_base64(sodium.crypto_sign_detached(proof, this.identity.signing.privateKey), sodium.base64_variants.ORIGINAL);
    return boundedJson(new URL(path, this.info.serverUrl), { method, signal: this.signal, headers: {
      'x-shellherd-device': this.identity.id, 'x-shellherd-nonce': nonce, 'x-shellherd-signature': signature,
      ...(['PUT', 'POST'].includes(method) ? { 'content-type': 'application/json' } : {}),
    }, ...(['PUT', 'POST'].includes(method) ? { body } : {}) });
  }
  async put(wire) {
    const result = await this.request('PUT', `/v1/vaults/${this.info.namespace}/objects`, wire);
    check(result.id === sha(wire)); return result.id;
  }
  async list() {
    const result = await this.request('GET', `/v1/vaults/${this.info.namespace}/objects`);
    check(Array.isArray(result.objects) && result.objects.length <= 100 && result.objects.every(id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id)));
    return result.objects;
  }
  async get(id) {
    check(typeof id === 'string' && /^[a-f0-9]{64}$/.test(id));
    const result = await this.request('GET', `/v1/vaults/${this.info.namespace}/objects/${id}`);
    check(result.id === id && typeof result.wire === 'string' && Buffer.byteLength(result.wire) <= 1048576 && sha(result.wire) === id); return result.wire;
  }
  async pull(client) {
    let pending = [];
    for (const id of await this.list()) pending.push(await this.get(id));
    while (pending.length) {
      const deferred = []; let progress = false;
      for (const wire of pending) {
        try { client.receive(wire); progress = true; }
        catch (error) { if (error.message === 'Missing ancestry') deferred.push(wire); else throw error; }
      }
      check(progress); pending = deferred;
    }
    // Local branches are never replaced by the server's list. Global freshness is separate.
    return client.heads;
  }
}
