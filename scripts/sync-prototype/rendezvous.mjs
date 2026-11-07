// Ephemeral, account-authenticated signaling. No endpoint grants OS access.
import { createHash, createPublicKey, randomBytes } from 'node:crypto';
const fail = (ok, status = 400) => { if (!ok) { const error = Error('Rendezvous request rejected'); error.status = status; throw error; } };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.split(',').sort().join(',');
export function deviceId(publicKey) {
  fail(typeof publicKey === 'string' && publicKey.length === 60);
  const der = Buffer.from(publicKey, 'base64');
  fail(der.toString('base64') === publicKey && der.length === 44 && der.subarray(0, 12).toString('hex') === '302a300506032b656e032100');
  fail(createPublicKey({ key: der, type: 'spki', format: 'der' }).asymmetricKeyType === 'x25519');
  return createHash('sha256').update(der).digest('hex');
}
export function createRendezvous({ authorize, isActive, clock = Date.now }) {
  const devices = new Map(); const sessions = new Map();
  function expire() {
    const now = clock();
    for (const [id, device] of devices) {
      const valid = now >= device.created && now < device.expiresAt && isActive(device.owner);
      if (!valid) devices.delete(id);
    }
    for (const [id, session] of sessions) if (now < session.created || now >= session.expiresAt || !devices.has(session.from) || !devices.has(session.to)) sessions.delete(id);
  }
  const ownDevice = owner => {
    const found = [...devices.values()].find(device => device.owner === owner); fail(found, 409); return found;
  };
  const description = session => ({ id: session.id, from: session.from, to: session.to, nonce: session.nonce, scope: session.scope, state: session.state, expiresAt: session.expiresAt });
  return {
    async handle(request, path, send) {
      expire(); const owner = authorize(request.headers.authorization);
      fail(['GET', 'POST', 'PUT', 'DELETE'].includes(request.method), 405);
      const url = new URL(path, 'http://localhost');
      const route = /^\/v1\/rendezvous\/(devices|sessions)(?:\/([a-f0-9]{64})(?:\/(accept|messages|ack))?)?$/.exec(url.pathname);
      fail(route, 404); const [, resource, id, action] = route;
      fail(url.search === '' || (resource === 'sessions' && action === 'messages' && request.method === 'GET' && /^\?after=(0|[1-9][0-9]{0,9})$/.test(url.search)));
      const length = Number(request.headers['content-length'] ?? 0);
      fail(Number.isSafeInteger(length) && length >= 0 && length <= 32768, 413);
      const writes = ['POST', 'PUT'].includes(request.method);
      fail(writes ? length > 0 && request.headers['content-type'] === 'application/json' : length === 0);
      const chunks = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; fail(bytes <= 32768, 413); chunks.push(chunk); }
      fail(bytes === length);
      const body = writes ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
      // Body reads can outlive either authentication or a presence lease.
      expire(); fail(authorize(request.headers.authorization) === owner, 401);
      if (resource === 'devices') {
        fail(!id && !action, 404);
        if (request.method === 'GET') { send(200, { devices: [...devices.values()].map(({ id, name, publicKey, expiresAt }) => ({ id, name, publicKey, expiresAt })) }); return; }
        if (request.method === 'DELETE') {
          devices.delete(ownDevice(owner).id); expire(); send(200, { removed: true }); return;
        }
        fail(request.method === 'PUT', 405);
        fail(exact(body, 'name,publicKey') && typeof body.name === 'string' && /^[^\x00-\x1f\x7f]{1,80}$/.test(body.name));
        const key = deviceId(body.publicKey); const previous = devices.get(key);
        fail(!previous || previous.owner === owner, 409);
        fail(![...devices.values()].some(device => device.owner === owner && device.id !== key), 409);
        fail(previous || devices.size < 32, 429);
        devices.set(key, { id: key, name: body.name, publicKey: body.publicKey, owner, created: previous?.created ?? clock(), expiresAt: clock() + 60_000 });
        send(200, { id: key, expiresAt: devices.get(key).expiresAt }); return;
      }
      const own = ownDevice(owner);
      if (!id) {
        if (request.method === 'GET') { send(200, { sessions: [...sessions.values()].filter(session => session.from === own.id || session.to === own.id).map(description) }); return; }
        fail(request.method === 'POST', 405);
        fail(exact(body, 'nonce,scope,target') && hex(body.target) && hex(body.nonce) && ['view', 'control'].includes(body.scope));
        fail(body.target !== own.id && devices.has(body.target), 404);
        fail(sessions.size < 64 && [...sessions.values()].filter(session => session.from === own.id || session.to === own.id).length < 4, 429);
        const session = { id: randomBytes(32).toString('hex'), from: own.id, to: body.target, nonce: body.nonce, scope: body.scope, state: 'pending', created: clock(), expiresAt: clock() + 60_000, directions: new Map() };
        for (const peer of [session.from, session.to]) session.directions.set(peer, { sequence: 0, ack: 0, queue: [], receipts: new Map() });
        sessions.set(session.id, session); send(201, description(session)); return;
      }
      const session = sessions.get(id); fail(session && [session.from, session.to].includes(own.id), 404);
      if (!action) {
        if (request.method === 'GET') { send(200, description(session)); return; }
        fail(request.method === 'DELETE', 405); sessions.delete(id); send(200, { closed: true }); return;
      }
      if (action === 'accept') {
        fail(request.method === 'POST', 405); fail(exact(body, ''), 400); fail(own.id === session.to, 403);
        if (session.state === 'pending') { session.state = 'active'; session.expiresAt = clock() + 300_000; }
        send(200, description(session)); return;
      }
      fail(session.state === 'active', 409);
      const outgoing = session.directions.get(own.id);
      const incoming = session.directions.get(own.id === session.from ? session.to : session.from);
      if (action === 'ack') {
        fail(request.method === 'POST', 405);
        fail(exact(body, 'through') && Number.isSafeInteger(body.through) && body.through >= incoming.ack && body.through <= incoming.sequence);
        incoming.ack = body.through; incoming.queue = incoming.queue.filter(message => message.sequence > body.through);
        send(200, { through: incoming.ack }); return;
      }
      if (request.method === 'GET') {
        const after = Number(url.searchParams.get('after') ?? 0);
        fail(after >= incoming.ack && after <= incoming.sequence, 409);
        send(200, { messages: incoming.queue.filter(message => message.sequence > after) }); return;
      }
      fail(request.method === 'POST', 405);
      fail(exact(body, 'ciphertext,nonce,sequence,tag') && Number.isSafeInteger(body.sequence) && body.sequence > 0 && body.sequence <= 0xffffffff);
      for (const [field, size] of [['nonce', 12], ['tag', 16], ['ciphertext', null]]) {
        fail(typeof body[field] === 'string'); const decoded = Buffer.from(body[field], 'base64');
        fail(decoded.toString('base64') === body[field] && (size === null ? decoded.length > 0 && decoded.length <= 8192 : decoded.length === size));
      }
      // A lost HTTP acknowledgment can be retried with the exact same frame.
      const digest = createHash('sha256').update(JSON.stringify([body.sequence, body.nonce, body.ciphertext, body.tag])).digest('hex');
      if (body.sequence <= outgoing.sequence) {
        fail(outgoing.receipts.get(body.sequence) === digest, 409);
        send(200, { sequence: body.sequence }); return;
      }
      fail(body.sequence === outgoing.sequence + 1, 409); fail(outgoing.queue.length < 32, 429);
      outgoing.sequence = body.sequence; outgoing.queue.push(body); outgoing.receipts.set(body.sequence, digest);
      if (outgoing.receipts.size > 32) outgoing.receipts.delete(outgoing.receipts.keys().next().value);
      send(201, { sequence: body.sequence });
    },
    clear() { devices.clear(); sessions.clear(); },
  };
}
