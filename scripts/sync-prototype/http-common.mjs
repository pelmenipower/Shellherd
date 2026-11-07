import { normalizeSyncServerUrl } from '../../src/shared/sync-server-url.mjs';
const check = ok => { if (!ok) throw Error('Sync transport rejected'); };
export async function boundedJson(url, options = {}, maxBytes = 2 * 1024 * 1024) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
  const response = await fetch(url, { ...options, redirect: 'error', signal, credentials: 'omit' });
  let reader;
  try {
    if (!response.ok) { const error = Error('Sync request rejected'); error.status = response.status; throw error; }
    check(/^application\/json(?:;|$)/i.test(response.headers.get('content-type') ?? '') && !response.headers.has('content-encoding'));
    check(!response.headers.get('content-length') || Number(response.headers.get('content-length')) <= maxBytes);
    reader = response.body.getReader(); const chunks = []; let bytes = 0;
    while (true) { const item = await reader.read(); if (item.done) break; bytes += item.value.length; check(bytes <= maxBytes); chunks.push(item.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await (reader ? reader.cancel() : response.body?.cancel())?.catch(() => {}); }
}
export async function probeSyncServer(serverUrl, { allowLoopbackHttp = false, signal } = {}) {
  const url = normalizeSyncServerUrl(serverUrl, allowLoopbackHttp); check(url);
  const info = await boundedJson(new URL('v1/info', url), { signal }, 4096);
  check(info.service === 'shellherd-sync-prototype' && info.protocol === 1 && /^[a-f0-9]{64}$/.test(info.serverId)
    && typeof info.namespace === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(info.namespace) && info.maxObjectBytes === 1048576);
  return { serverUrl: url, serverId: info.serverId, namespace: info.namespace, enrollmentAvailable: info.deviceEnrollment === true, authentication: info.authentication === 'password' ? 'password' : 'device', rendezvous: info.rendezvous === true };
}
