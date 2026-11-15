import { normalizeSyncServerUrl } from '../../src/shared/sync-server-url.mjs';
const check = ok => { if (!ok) throw Error('Sync transport rejected'); };
export async function boundedJson(url, options = {}, maxBytes = 2 * 1024 * 1024, timeoutMs = 5000) {
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
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
export async function probeSyncServer(serverUrl, { allowLoopbackHttp = false, allowPrivateHttp = false, signal } = {}) {
  const url = normalizeSyncServerUrl(serverUrl, { loopback: allowLoopbackHttp, private: allowPrivateHttp }); check(url);
  const info = await boundedJson(new URL('v1/info', url), { signal }, 4096);
  check(info.service === 'shellherd-sync-prototype' && info.protocol === 1 && /^[a-f0-9]{64}$/.test(info.serverId)
    && typeof info.namespace === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(info.namespace) && info.maxObjectBytes === 1048576);
  // A server that reports another origin than the one we reached is misconfigured (or someone else): its proofs would never verify.
  check(info.origin === new URL(url).origin);
  // Missing H4 fields never throw here (E2); the sync host decides whether the server is usable.
  return { serverUrl: url, serverId: info.serverId, namespace: info.namespace, enrollmentAvailable: info.deviceEnrollment === true, authentication: ['password', 'device', 'enrolled-device'].includes(info.authentication) ? info.authentication : 'device', deviceSessions: info.deviceSessions === true, rendezvous: info.rendezvous === true, rendezvousProof: info.rendezvousProof === true, rendezvousNoise: info.rendezvousNoise === true, invites: info.invites === true, objectEpochs: info.objectEpochs === true, enrollment: info.enrollment === 'invite-only' ? 'invite-only' : 'password' };
}
