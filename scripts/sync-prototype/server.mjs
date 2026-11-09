// Central ciphertext-only transport prototype. No client crypto/decryption modules.
// This executable intentionally listens on loopback only. Not a production release.
import http from 'node:http';
import net from 'node:net';
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir, rename, unlink, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requestProof } from './http-proof.mjs';
import { normalizeSyncServerUrl } from '../../src/shared/sync-server-url.mjs';
import { createAccessRegistry } from './server-access.mjs';
import { accountAuth } from './account-auth.mjs';
import { validateVaultFile } from './vault-file-wire.mjs';
import { createRendezvous } from './rendezvous.mjs';
import { DEFAULT_LIMITS, createLimiter, sourceOf } from './rate-limit.mjs';
const MAX = 1024 * 1024;
const sha = data => createHash('sha256').update(data).digest('hex');
const ascii = s => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(s);
function check(ok, code = 400, retryAfter) { if (!ok) { const error = Error('Request rejected'); error.status = code; if (retryAfter !== undefined) error.retryAfter = retryAfter; throw error; } }
function base64(s, length) {
  check(typeof s === 'string' && s.length < MAX * 2); const bytes = Buffer.from(s, 'base64');
  check(bytes.toString('base64') === s && (length === undefined || bytes.length === length)); return bytes;
}
export async function createSyncServer({ directory, serverId, namespace, devices = [], account = null, publicUrl = null, clock = () => Date.now(), adminPublicKey = null, adminDevices = [], accessFault, rendezvous = false, trustedProxy = false, limits = {} }) {
  limits = { ...DEFAULT_LIMITS, ...limits };
  check(typeof serverId === 'string' && /^[a-f0-9]{64}$/.test(serverId) && ascii(namespace));
  check(Array.isArray(devices) && devices.length <= 16 && (account !== null ? devices.length === 0 && adminPublicKey === null && adminDevices.length === 0 : devices.length > 0));
  const login = account === null ? null : accountAuth(account, clock, limits);
  check(typeof rendezvous === 'boolean' && (!rendezvous || login !== null));
  const broker = rendezvous ? createRendezvous({ authorize: header => login.authorize(header), isActive: key => login.isActive(key), clock, serverId }) : null;
  check(publicUrl === null || normalizeSyncServerUrl(publicUrl) === publicUrl);
  const keys = new Map();
  for (const device of devices) {
    check(ascii(device.id) && !keys.has(device.id));
    keys.set(device.id, createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), base64(device.signingKey, 32)]), format: 'der', type: 'spki' }));
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const dirStat = await lstat(directory);
  check(dirStat.isDirectory() && !dirStat.isSymbolicLink() && (dirStat.mode & 0o077) === 0, 500);
  const access = await createAccessRegistry({ directory, serverId, namespace, devices, keys, adminPublicKey, adminDevices, clock, fault: accessFault });
  const objects = new Map(); let total = 0; let busy = false; let uncertain = false;
  function opaque(wire) {
    if (login) { validateVaultFile(wire); return null; }
    check(Buffer.byteLength(wire) <= MAX); const tuple = JSON.parse(wire);
    check(Array.isArray(tuple) && tuple.length === 5 && JSON.stringify(tuple) === wire);
    const [header, recipients, nonce, cipher, signature] = tuple;
    check(Array.isArray(header) && header.length === 6 && header[0] === 'shellherd-lab-snapshot-v1' && header[1] === namespace && ascii(header[2]) && ascii(header[3]) && Number.isSafeInteger(header[4]) && header[4] > 0);
    check(Array.isArray(header[5]) && header[5].length <= 16); header[5].forEach(p => base64(p, 32));
    check(Array.isArray(recipients) && recipients.length > 0 && recipients.length <= 16);
    for (const packet of recipients) { check(Array.isArray(packet) && packet.length === 3 && ascii(packet[0])); base64(packet[1], 32); base64(packet[2], 80); }
    base64(nonce, 24); check(base64(cipher).length >= 16); base64(signature, 64);
    return header[3];
  }
  async function readObject(id) {
    const handle = await open(join(directory, id + '.blob'), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat(); check(stat.isFile() && stat.nlink === 1 && stat.size <= MAX && (stat.mode & 0o077) === 0, 500);
      const data = Buffer.alloc(MAX + 1); let used = 0;
      while (used < data.length) { const read = await handle.read(data, used, data.length - used, used); if (!read.bytesRead) break; used += read.bytesRead; }
      check(used <= MAX, 500); const wire = data.subarray(0, used).toString('utf8'); check(sha(wire) === id, 500); opaque(wire); return wire;
    } finally { await handle.close(); }
  }
  const files = await readdir(directory); check(files.length <= 256, 500);
  for (const file of files) {
    if (file === 'access.json') continue;
    if (!/^[a-f0-9]{64}\.blob$/.test(file)) { check(file.endsWith('.tmp') || file.endsWith('.access-tmp'), 500); continue; }
    const id = file.slice(0, -5); const wire = await readObject(id); objects.set(id, Buffer.byteLength(wire)); total += Buffer.byteLength(wire);
  }
  check(objects.size <= 100 && total <= 32 * MAX, 500);
  const nonces = new Map(); let requests = 0; let windowStart = clock();
  const limiter = createLimiter({ clock, maxKeys: limits.maxKeys });
  const budget = (key, capacity, perMinute = capacity) => { const result = limiter.take(key, { capacity, perMinute }); check(result.ok, 429, result.retryAfter); };
  const server = http.createServer({ maxHeaderSize: 8192 }, (request, response) => {
    const send = (status, value, retryAfter) => {
      if (response.destroyed) return;
      const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', connection: 'close' };
      if (status === 429) headers['retry-after'] = String(retryAfter ?? 1);
      response.writeHead(status, headers);
      response.end(JSON.stringify(value));
    };
    void (async () => {
      const now = clock();
      const source = sourceOf(request, { trustedProxy }); budget('source:' + source, limits.source);
      const path = request.url; check(typeof path === 'string' && path.length < 512);
      // Per-source buckets first: only requests that pass them count against the global budget, so one source cannot exhaust it for all.
      if (request.method === 'GET' && path === '/v1/info') budget('info:' + source, limits.info);
      if (login && path === '/v1/login' && request.method === 'POST') budget('login:' + source, limits.login);
      if (now - windowStart >= 60_000 || now < windowStart) { windowStart = now; requests = 0; }
      check(++requests <= limits.global, 429, Math.max(1, Math.ceil((windowStart + 60_000 - now) / 1000)));
      check(request.headers.origin === undefined && request.headers['transfer-encoding'] === undefined);
      if (request.method === 'GET' && path === '/v1/info') {
        check(request.headers['content-length'] === undefined || request.headers['content-length'] === '0');
        send(200, { service: 'shellherd-sync-prototype', protocol: 1, serverId, namespace, maxObjectBytes: MAX, deviceEnrollment: access.enabled, authentication: login ? 'password' : 'device', objectFormat: login ? 'encrypted-vault' : 'device-snapshot', rendezvous: Boolean(broker), rendezvousProof: Boolean(broker), rendezvousNoise: Boolean(broker) }); return;
      }
      if (login && path === '/v1/login') {
        check(request.method === 'POST', 405);
        let body;
        try {
          check(request.headers['content-type'] === 'application/json');
          const length = Number(request.headers['content-length']); check(Number.isSafeInteger(length) && length > 0 && length <= 8192, 413);
          const chunks = []; let used = 0; for await (const chunk of request) { used += chunk.length; check(used <= 8192, 413); chunks.push(chunk); }
          check(used === length); body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch (error) { login.fail(source); throw error; } // a malformed request counts as a failed attempt
        send(200, await login.login(body, source)); return;
      }
      if (login && path === '/v1/logout') {
        check(request.method === 'POST' && Number(request.headers['content-length'] ?? 0) === 0);
        send(200, login.logout(request.headers.authorization)); return;
      }
      if (login && path === '/v1/refresh') {
        check(request.method === 'POST' && Number(request.headers['content-length'] ?? 0) === 0);
        send(200, login.refresh(request.headers.authorization)); return;
      }
      if (broker && path.startsWith('/v1/rendezvous/')) {
        const token = login.authorize(request.headers.authorization); budget('rendezvous:' + token, limits.rendezvousToken);
        await broker.handle(request, path, send); return;
      }
      if (!login && request.method === 'GET' && path === '/v1/challenge') {
        for (const [nonce, since] of nonces) if (now - since >= 30_000 || now < since) nonces.delete(nonce);
        check(nonces.size < 128, 429); const nonce = randomBytes(32).toString('hex'); nonces.set(nonce, now);
        send(200, { nonce }); return;
      }
      const collection = `/v1/vaults/${namespace}/objects`;
      const enrollmentId = /^\/v1\/enrollments\/([a-f0-9]{64})$/.exec(path)?.[1];
      const registration = path === '/v1/enrollments';
      const administration = path === '/v1/access' || path === '/v1/enrollments/pending';
      const control = registration || administration || Boolean(enrollmentId);
      check(path === collection || (path.startsWith(collection + '/') && /^[a-f0-9]{64}$/.test(path.slice(collection.length + 1))) || (control && access.enabled), 404);
      const methods = registration ? ['POST'] : enrollmentId ? ['GET', 'DELETE'] : path === '/v1/enrollments/pending' ? ['GET'] : path === collection || path === '/v1/access' ? ['GET', 'PUT'] : login ? ['GET', 'DELETE'] : ['GET'];
      check(methods.includes(request.method), 405);
      const device = request.headers['x-shellherd-device']; const nonce = request.headers['x-shellherd-nonce']; const signature = request.headers['x-shellherd-signature'];
      const authorized = login ? login.authorize(request.headers.authorization) : null;
      let since;
      if (!login) {
        check(typeof device === 'string' && ascii(device) && typeof nonce === 'string' && nonces.has(nonce), 401);
        since = nonces.get(nonce); nonces.delete(nonce); check(now >= since && now - since < 30_000, 401);
      }
      const length = Number(request.headers['content-length'] ?? 0);
      const limit = control ? 16384 : MAX;
      check(Number.isSafeInteger(length) && length >= 0 && length <= limit, 413);
      check(!['GET', 'DELETE'].includes(request.method) || length === 0);
      if (['PUT', 'POST'].includes(request.method)) check(request.headers['content-type'] === 'application/json' && length > 0 && (control || path === collection));
      const chunks = []; let bytes = 0;
      for await (const chunk of request) { bytes += chunk.length; check(bytes <= limit, 413); chunks.push(chunk); }
      check(bytes === length); const body = Buffer.concat(chunks).toString('utf8');
      let key;
      if (login) check(login.authorize(request.headers.authorization) === authorized, 401);
      else {
        check(clock() >= since && clock() - since < 30_000, 401);
        const audience = publicUrl ?? `http://127.0.0.1:${server.address().port}/`;
        key = registration ? access.registrationKey(body, device) : keys.get(device) ?? (enrollmentId ? access.pendingKey(enrollmentId, device) : undefined);
        check(key, 401);
        check(verify(null, Buffer.from(requestProof(serverId, audience, request.method, path, nonce, device, body)), key, base64(signature, 64)), 401);
      }
      access.assertHealthy();
      if (registration) { send(202, access.enroll(body)); return; }
      if (enrollmentId) { send(200, request.method === 'GET' ? access.enrollmentStatus(enrollmentId, device) : access.withdraw(enrollmentId, device)); return; }
      if (administration) {
        check(access.isAdmin(device), 403);
        if (path === '/v1/enrollments/pending') send(200, { pending: access.listPending() });
        else if (request.method === 'GET') send(200, access.status());
        else {
          check(!busy, 409); busy = true;
          try { const document = JSON.parse(body); check(JSON.stringify(document) === body); send(200, await access.apply(document)); }
          finally { busy = false; }
        }
        return;
      }
      if (request.method === 'DELETE') {
        const id = path.slice(collection.length + 1);
        check(!uncertain, 503); check(!busy, 409); check(objects.has(id), 404); busy = true;
        try {
          await unlink(join(directory, id + '.blob')).catch(error => { if (error.code !== 'ENOENT') throw error; });
          total -= objects.get(id); objects.delete(id);
          try { const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
          catch (error) { uncertain = true; throw error; }
          send(200, { removed: true });
        } finally { busy = false; }
        return;
      }
      if (request.method === 'GET') {
        if (path === collection) send(200, { objects: [...objects.keys()].sort() });
        else {
          const id = path.slice(collection.length + 1); check(objects.has(id), 404); const wire = await readObject(id);
          access.assertHealthy(); const latest = keys.get(device);
          if (login) check(login.authorize(request.headers.authorization) === authorized, 401);
          else check(latest && latest.export({ format: 'der', type: 'spki' }).equals(key.export({ format: 'der', type: 'spki' })), 401);
          send(200, { id, wire });
        }
        return;
      }
      if (login) opaque(body); else check(opaque(body) === device, 403);
      const id = sha(body);
      if (objects.has(id)) { send(200, { id }); return; }
      check(!uncertain, 503); check(!busy, 409); check(objects.size < 100 && total + bytes <= 32 * MAX, 507); busy = true;
      let renamed = false;
      const temporary = join(directory, randomBytes(16).toString('hex') + '.tmp');
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary, join(directory, id + '.blob'));
        renamed = true;
        const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
        objects.set(id, bytes); total += bytes; send(201, { id });
      } catch (error) { if (renamed) uncertain = true; throw error; }
      finally { busy = false; await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
    })().catch(error => send(error.status ?? 400, { error: 'request-rejected' }, error.retryAfter));
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 2000; server.maxConnections = 32; server.maxHeadersCount = 32;
  server.on('clientError', (_error, socket) => socket.destroy());
  // Per-source connection cap; off behind a trusted proxy because every socket then comes from the proxy.
  if (!trustedProxy) {
    const open = new Map();
    server.on('connection', socket => {
      const source = sourceOf({ socket, headers: {} });
      const count = (open.get(source) ?? 0) + 1;
      if (count > limits.connectionsPerSource) { socket.destroy(); return; }
      open.set(source, count);
      socket.once('close', () => { const left = (open.get(source) ?? 1) - 1; if (left > 0) open.set(source, left); else open.delete(source); });
    });
  }
  return { server, info: { serverId, namespace }, async listen(port = 0, host = '127.0.0.1') {
    check(typeof host === 'string' && net.isIP(host) !== 0);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : net.isIPv6(host) ? `[${host}]` : host;
    return `http://${shown}:${server.address().port}/`;
  }, async close() { broker?.clear(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [configFile, directory, port = '8787'] = process.argv.slice(2);
    check(configFile && directory && /^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535);
    const file = await readFile(configFile); check(file.length <= 16_384);
    const service = await createSyncServer({ ...JSON.parse(file.toString('utf8')), directory });
    const url = await service.listen(Number(port));
    console.log(`Development ciphertext server: ${url}`);
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void service.close(); });
  } catch { console.error('Cannot start development server. Expected: server.mjs SERVER_CONFIG.json PRIVATE_DATA_DIR [PORT]'); process.exitCode = 1; }
}
