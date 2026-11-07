import { createHash } from 'node:crypto';
export function requestProof(serverId, serverUrl, method, path, nonce, deviceId, body = '') {
  return JSON.stringify(['shellherd-sync-http-v1', serverId, serverUrl, method, path, nonce, deviceId,
    createHash('sha256').update(body).digest('hex')]);
}
