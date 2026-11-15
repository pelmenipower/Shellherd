// Central ciphertext-only transport prototype. No client crypto/decryption modules.
// This executable intentionally listens on loopback only. Not a production release.
import http from 'node:http';
import net from 'node:net';
import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open, readdir, rename, unlink, readFile, chmod } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { requestProof } from './http-proof.mjs';
import { normalizeSyncServerUrl } from '../../src/shared/sync-server-url.mjs';
import { createAccessRegistry } from './server-access.mjs';
import { accountAuth } from './account-auth.mjs';
import { validateSyncObject, isLegacyVaultObject } from './sync-object-wire.mjs';
import { createDeviceRoster } from './device-roster.mjs';
import { enrollmentBody, sessionProof, requestProofV3, signingKeyOf, ed25519Spki, originOk } from './device-proof.mjs';
import { createRendezvous, deviceId } from './rendezvous.mjs';
import { DEFAULT_LIMITS, createLimiter, parseTrustedProxies, sourceOf } from './rate-limit.mjs';
const MAX = 1024 * 1024;
const sha = data => createHash('sha256').update(data).digest('hex');
const ascii = s => typeof s === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(s);
function check(ok, code = 400, retryAfter) { if (!ok) { const error = Error('Request rejected'); error.status = code; if (retryAfter !== undefined) error.retryAfter = retryAfter; throw error; } }
function base64(s, length) {
  check(typeof s === 'string' && s.length < MAX * 2); const bytes = Buffer.from(s, 'base64');
  check(bytes.toString('base64') === s && (length === undefined || bytes.length === length)); return bytes;
}
export async function createSyncServer({ directory, serverId, namespace, devices = [], account = null, publicUrl = null, origin = null, initialPasswordFile = null, clock = () => Date.now(), adminPublicKey = null, adminDevices = [], accessFault, rosterFault, rendezvous = false, trustedProxy = false, limits = {}, enrollment = 'password' }) {
  limits = { ...DEFAULT_LIMITS, ...limits };
  check(typeof serverId === 'string' && /^[a-f0-9]{64}$/.test(serverId) && ascii(namespace));
  check(Array.isArray(devices) && devices.length <= 16 && (account !== null ? devices.length === 0 && adminPublicKey === null && adminDevices.length === 0 : devices.length > 0));
  if (account !== null) accountAuth(account, clock, limits); // validate the account before touching the disk
  check(typeof rendezvous === 'boolean' && (!rendezvous || account !== null));
  check(publicUrl === null || normalizeSyncServerUrl(publicUrl) === publicUrl);
  // The public origin is configured, never taken from the Host header; null means the listen origin (loopback tests and scenes).
  check(origin === null || originOk(origin));
  check(initialPasswordFile === null || typeof initialPasswordFile === 'string');
  check(enrollment === 'password' || enrollment === 'invite-only');
  check(trustedProxy === false || typeof trustedProxy === 'string' || typeof trustedProxy === 'function');
  if (typeof trustedProxy === 'string') trustedProxy = parseTrustedProxies(trustedProxy);
  const keys = new Map();
  for (const device of devices) {
    check(ascii(device.id) && !keys.has(device.id));
    keys.set(device.id, createPublicKey({ key: ed25519Spki(base64(device.signingKey, 32)), format: 'der', type: 'spki' }));
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const dirStat = await lstat(directory);
  check(dirStat.isDirectory() && !dirStat.isSymbolicLink() && (dirStat.mode & 0o077) === 0, 500);
  const roster = account === null ? null : await createDeviceRoster({ directory, serverId, namespace, clock, fault: rosterFault });
  const login = account === null ? null : accountAuth(account, clock, limits, roster);
  if (roster) roster.hasSession = id => login.hasSession(id);
  const broker = rendezvous ? createRendezvous({ authorize: header => login.authorize(header), isActive: key => login.isActive(key), deviceOf: key => login.deviceOf(key), noiseKeyOf: id => roster.noiseKeyOf(id), clock, serverId }) : null;
  const access = await createAccessRegistry({ directory, serverId, namespace, devices, keys, adminPublicKey, adminDevices, clock, fault: accessFault });
  const objects = new Map(); const quarantined = new Set(); let total = 0; let busy = false; let uncertain = false;
  function opaque(wire) {
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
      check(used <= MAX, 500); const wire = data.subarray(0, used).toString('utf8'); check(sha(wire) === id, 500); if (login) { if (!isLegacyVaultObject(wire)) validateSyncObject(wire); } else opaque(wire); return wire;
    } finally { await handle.close(); }
  }
  // Startup care: stale temp files (older than 1 h) are removed before the file count is checked.
  for (const file of await readdir(directory)) {
    if (!/^[a-f0-9]{32}\.(tmp|devices-tmp|access-tmp)$/.test(file)) continue;
    try {
      const stat = await lstat(join(directory, file));
      if (stat.isFile() && Date.now() - stat.mtimeMs > 3600_000) await unlink(join(directory, file));
    } catch { /* best effort */ }
  }
  const files = (await readdir(directory)); check(files.length <= 256, 500);
  for (const file of files) {
    if (file === 'access.json' || file === 'devices.json') continue;
    if (!/^[a-f0-9]{64}\.blob$/.test(file)) { check(file.endsWith('.tmp') || file.endsWith('.access-tmp') || file.endsWith('.devices-tmp'), 500); continue; }
    const id = file.slice(0, -5);
    let wire;
    try { wire = await readObject(id); } catch { console.error(`Skipping unreadable object ${file}`); quarantined.add(id); continue; }
    objects.set(id, Buffer.byteLength(wire)); total += Buffer.byteLength(wire);
  }
  check(objects.size <= 100 && total <= 32 * MAX, 500);
  // Stateless challenges: ts(8) || rand(8) || mac(16), mac = HMAC(process secret, tag || ts || rand). Only valid, consumed nonces are kept (until they expire).
  const nonceSecret = randomBytes(32); const spent = new Map(); const SPENT_MAX = 4096; const NONCE_TTL = 30_000;
  const nonceMac = payload => createHmac('sha256', nonceSecret).update('shellherd-nonce-v1').update(payload).digest().subarray(0, 16);
  const issueNonce = at => { const payload = Buffer.alloc(16); payload.writeBigUInt64BE(BigInt(at), 0); randomBytes(8).copy(payload, 8); return Buffer.concat([payload, nonceMac(payload)]).toString('hex'); };
  /** Returns the issue time of a fresh nonce and spends it, or null. A full set fails closed with 429 (no eviction: that would reopen replay). */
  const spendNonce = (value, at) => {
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) return null;
    const raw = Buffer.from(value, 'hex');
    if (!timingSafeEqual(raw.subarray(16), nonceMac(raw.subarray(0, 16)))) return null;
    const ts = Number(raw.readBigUInt64BE(0));
    if (!(ts <= at && at - ts < NONCE_TTL) || spent.has(value)) return null;
    if (spent.size >= SPENT_MAX) {
      for (const [nonce, issued] of spent) if (!(issued <= at && at - issued < NONCE_TTL)) spent.delete(nonce);
      check(spent.size < SPENT_MAX, 429, 1);
    }
    spent.set(value, ts); return ts;
  };
  // Open enrollment codes (RAM only). The keybox object an issuer attached is removed once the invite is spent or expired (B7).
  const INVITE_TTL = 600_000; const INVITE_GRACE = 600_000; const invites = [];
  const EMPTY_SHA = sha(Buffer.alloc(0));
  const redeemable = (e, at) => !e.revoked && e.consumedAt === null && at < e.expiresAt;
  const inviteDue = (e, at) => e.revoked || (e.consumedAt === null ? at >= e.expiresAt : at >= Math.max(e.expiresAt, e.consumedAt + INVITE_GRACE));
  async function removeObject(id) {
    check(!uncertain, 503); check(!busy, 409); check(objects.has(id) || quarantined.has(id), 404); busy = true;
    try {
      await unlink(join(directory, id + '.blob')).catch(error => { if (error.code !== 'ENOENT') throw error; });
      // Skipped (unreadable) objects are removable too, so they do not hold a file slot forever.
      if (objects.has(id)) { total -= objects.get(id); objects.delete(id); } else quarantined.delete(id);
      try { const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
      catch (error) { uncertain = true; throw error; }
    } finally { busy = false; }
  }
  // Best effort: a busy or failing removal is retried on the next run, a missing object counts as done.
  // One sweep at a time; object writes wait for a running one instead of being refused with 409 (N5).
  let sweeping = null;
  function sweepInvites(at) {
    sweeping ??= runSweep(at).finally(() => { sweeping = null; });
    return sweeping;
  }
  async function runSweep(at) {
    for (const entry of [...invites]) {
      if (entry.removing || !inviteDue(entry, at)) continue;
      const drop = () => { const index = invites.indexOf(entry); if (index >= 0) invites.splice(index, 1); };
      if (entry.object === null) { drop(); continue; }
      entry.removing = true;
      try { await removeObject(entry.object); drop(); } catch (error) { if (error?.status === 404) drop(); else entry.removing = false; }
    }
  }
  const sweepTimer = login ? setInterval(() => { void sweepInvites(clock()).catch(() => {}); }, 60_000) : null; sweepTimer?.unref();
  let requests = 0; let windowStart = clock();
  const inflight = new Map();
  const limiter = createLimiter({ clock, maxKeys: limits.maxKeys });
  const budget = (key, capacity, perMinute = capacity) => { const result = limiter.take(key, { capacity, perMinute }); check(result.ok, 429, result.retryAfter); };
  const server = http.createServer({ maxHeaderSize: 8192, connectionsCheckingInterval: 1000 }, (request, response) => {
    const send = (status, value, retryAfter) => {
      if (response.destroyed || response.headersSent || response.writableEnded) return;
      const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', connection: 'close' };
      if (status === 429) headers['retry-after'] = String(retryAfter ?? 1);
      response.writeHead(status, headers);
      response.end(JSON.stringify(value));
    };
    void (async () => {
      const now = clock();
      if (login) await sweepInvites(now).catch(() => {});
      const source = sourceOf(request, { trustedProxy });
      // Concurrent handlers per source (works behind a proxy too); released when the response closes.
      const concurrent = (inflight.get(source) ?? 0) + 1; inflight.set(source, concurrent);
      response.once('close', () => { const left = (inflight.get(source) ?? 1) - 1; if (left > 0) inflight.set(source, left); else inflight.delete(source); });
      check(concurrent <= limits.concurrentPerSource, 429, 1);
      budget('source:' + source, limits.source);
      const path = request.url; check(typeof path === 'string' && path.length < 512);
      // Per-source buckets first: only requests that pass them count against the global budget, so one source cannot exhaust it for all.
      if (request.method === 'GET' && path === '/v1/info') budget('info:' + source, limits.info);
      if (request.method === 'GET' && path === '/v1/challenge') budget('challenge:' + source, limits.challenge);
      if (login && path === '/v1/devices' && request.method === 'POST') budget('enroll:' + source, limits.login);
      if (login && path === '/v1/session' && request.method === 'POST') budget('session:' + source, limits.session);
      if (now - windowStart >= 60_000 || now < windowStart) { windowStart = now; requests = 0; }
      check(++requests <= limits.global, 429, Math.max(1, Math.ceil((windowStart + 60_000 - now) / 1000)));
      check(request.headers.origin === undefined && request.headers['transfer-encoding'] === undefined);
      if (request.method === 'GET' && path === '/v1/info') {
        check(request.headers['content-length'] === undefined || request.headers['content-length'] === '0');
        send(200, { service: 'shellherd-sync-prototype', protocol: 1, serverId, namespace, maxObjectBytes: MAX, deviceEnrollment: access.enabled, authentication: login ? 'enrolled-device' : 'device', invites: Boolean(login), objectEpochs: Boolean(login), ...(login ? { enrollment } : {}), deviceSessions: Boolean(login), objectFormat: login ? 'sync-object' : 'device-snapshot', rendezvous: Boolean(broker), rendezvousProof: Boolean(broker), rendezvousNoise: Boolean(broker), origin }); return;
      }
      let rawBody = Buffer.alloc(0); // exact bytes of the last JSON body (the digest of a signed request covers them)
      const readJson = async (max, onFormError) => {
        // Total read deadline before authentication: a slow body is destroyed and counts as a malformed attempt.
        let timer; const deadline = new Promise((_resolve, reject) => { timer = setTimeout(() => { request.destroy(); reject(Object.assign(Error('Request rejected'), { status: 408 })); }, 3000); });
        const reading = (async () => {
          check(request.headers['content-type'] === 'application/json');
          const length = Number(request.headers['content-length']); check(Number.isSafeInteger(length) && length > 0 && length <= max, 413);
          const chunks = []; let used = 0; for await (const chunk of request) { used += chunk.length; check(used <= max, 413); chunks.push(chunk); }
          check(used === length); rawBody = Buffer.concat(chunks); const text = rawBody.toString('utf8'); const body = JSON.parse(text); check(JSON.stringify(body) === text); return body;
        })();
        reading.catch(() => {});
        try { return await Promise.race([reading, deadline]); }
        catch (error) { onFormError(); throw error; } // a malformed request counts as a failed attempt
        finally { clearTimeout(timer); }
      };
      const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
      const sameKeys = (value, expected) => plain(value) && Object.keys(value).sort().join(',') === expected;
      const consumeNonce = value => spendNonce(value, now) !== null;
      if (login && path === '/v1/devices' && request.method === 'POST') {
        const body = await readJson(16384, () => login.fail(source));
        const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
        const byInvite = sameKeys(body, 'enrollment,invite') || sameKeys(body, 'enrollment,ephemeral,invite');
        // Under invite-only the password form is refused before anything is counted or hashed.
        if (!byInvite && enrollment === 'invite-only' && (sameKeys(body, 'enrollment,password,username') || sameKeys(body, 'enrollment,ephemeral,password,username'))) check(false, 403);
        const reject = byInvite ? () => login.failSession(source) : () => login.fail(source);
        try {
          check(byInvite || sameKeys(body, 'enrollment,password,username') || sameKeys(body, 'enrollment,ephemeral,password,username'));
          check(body.ephemeral === undefined || typeof body.ephemeral === 'boolean');
          if (byInvite) check(hex(body.invite));
          const doc = body.enrollment; check(Array.isArray(doc) && doc.length === 2 && Array.isArray(doc[0]) && doc[0].length === 8 && typeof doc[1] === 'string');
          check(JSON.stringify(doc[0]) === enrollmentBody(...doc[0].slice(1)) && doc[0][1] === serverId && doc[0][2] === namespace && doc[0][3] === origin);
          // Cheap rejections (device id vs noise key, weak signing key) come before the expensive password check.
          check(deviceId(doc[0][6]) === doc[0][4]); signingKeyOf(doc[0][5]);
        } catch (error) { reject(); throw error; }
        let enrolledBy = null;
        if (byInvite) {
          login.sessionGate(source);
          // Every open invite is compared, no early exit.
          const wanted = createHash('sha256').update(body.invite, 'utf8').digest(); let match = null;
          for (const entry of invites) if (timingSafeEqual(entry.digest, wanted) && redeemable(entry, now)) match = entry;
          if (!match) { login.failSession(source); check(false, 401); }
          match.consumedAt = now; enrolledBy = match.issuer; // spent at once, even if a later step fails
          check(roster.isActive(match.issuer), 401);
        } else await login.verifyPassword({ username: body.username, password: body.password }, source);
        roster.assertHealthy();
        const { entry, created } = await roster.enroll({ document: body.enrollment, ephemeral: body.ephemeral === true, origin, enrolledBy });
        if (byInvite) login.clearSession(source);
        if (initialPasswordFile) await unlink(initialPasswordFile).catch(() => {}); // the generated password is no longer needed once a device is enrolled
        send(created ? 201 : 200, { device: { id: entry.id, name: entry.name, enrolledAt: entry.enrolledAt, ephemeral: entry.ephemeral }, ...(byInvite ? { username: account.username } : {}) }); return;
      }
      if (login && path === '/v1/devices' && request.method === 'GET') {
        check(request.headers['content-length'] === undefined || request.headers['content-length'] === '0');
        const key = login.authorize(request.headers.authorization);
        send(200, { devices: roster.list().map(d => ({ ...d, self: d.id === login.deviceOf(key) })) }); return;
      }
      if (login && path === '/v1/session') {
        check(request.method === 'POST', 405);
        login.sessionGate(source);
        const body = await readJson(4096, () => login.failSession(source));
        // The nonce is spent first and always, whatever fails next.
        const fresh = plain(body) ? consumeNonce(body.nonce) : false;
        const reject = () => { login.failSession(source); check(false, 401); };
        if (!sameKeys(body, 'device,nonce,signature')) { login.failSession(source); check(false); }
        const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
        if (!fresh || !hex(body.device) || !hex(body.nonce) || !roster.isActive(body.device)) reject();
        let valid = false;
        try { valid = verify(null, Buffer.from(sessionProof(serverId, namespace, origin, body.nonce, body.device)), roster.signingKeyOf(body.device), base64(body.signature, 64)); } catch { valid = false; }
        if (!valid) reject();
        login.clearSession(source); roster.touch(body.device); send(200, { ...login.openSession(body.device), device: body.device }); return;
      }
      const revocation = login ? /^\/v1\/devices\/([a-f0-9]{64})$/.exec(path)?.[1] : undefined;
      if (revocation) {
        check(request.method === 'DELETE', 405);
        login.sessionGate(source);
        const device = request.headers['x-shellherd-device']; const nonce = request.headers['x-shellherd-nonce']; const signature = request.headers['x-shellherd-signature'];
        const fresh = consumeNonce(nonce); // spent first and always, whatever fails next
        let key;
        try { key = login.authorize(request.headers.authorization); } catch (error) { login.failSession(source); throw error; }
        budget('device:' + login.deviceOf(key), limits.deviceWrites);
        const length = Number(request.headers['content-length'] ?? 0); check(Number.isSafeInteger(length) && length >= 0, 400); check(length <= 16384, 413); check(length === 0);
        let valid = false;
        try {
          valid = fresh && device === login.deviceOf(key) && verify(null, Buffer.from(requestProofV3(serverId, namespace, origin, 'DELETE', request.url, nonce, device, EMPTY_SHA)), roster.signingKeyOf(device), base64(signature, 64));
        } catch { valid = false; }
        if (!valid) { login.failSession(source); check(false, 401); }
        login.clearSession(source);
        check(login.authorize(request.headers.authorization) === key, 401); roster.assertHealthy();
        await roster.revoke(revocation); login.dropDevice(revocation); broker?.dropDevice(revocation);
        for (const entry of invites) if (entry.issuer === revocation) entry.revoked = true; // K2: its open invites die with it
        await sweepInvites(now).catch(() => {});
        send(200, { revoked: true }); return;
      }
      if (login && path === '/v1/invites') {
        check(request.method === 'POST', 405);
        login.sessionGate(source);
        const device = request.headers['x-shellherd-device']; const nonce = request.headers['x-shellherd-nonce']; const signature = request.headers['x-shellherd-signature'];
        const fresh = consumeNonce(nonce); // spent first and always, whatever fails next
        let key;
        try { key = login.authorize(request.headers.authorization); } catch (error) { login.failSession(source); throw error; }
        budget('invite:' + login.deviceOf(key), limits.invite);
        const body = await readJson(4096, () => login.failSession(source));
        const bodySha = createHash('sha256').update(rawBody).digest('hex');
        let valid = false;
        try {
          valid = fresh && device === login.deviceOf(key) && verify(null, Buffer.from(requestProofV3(serverId, namespace, origin, 'POST', request.url, nonce, device, bodySha)), roster.signingKeyOf(device), base64(signature, 64));
        } catch { valid = false; }
        if (!valid) { login.failSession(source); check(false, 401); }
        login.clearSession(source);
        check(login.authorize(request.headers.authorization) === key, 401); check(roster.isActive(device), 401);
        const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
        check(sameKeys(body, 'object,secret') && hex(body.secret) && (body.object === null || hex(body.object)));
        if (body.object !== null) { check(objects.has(body.object)); let kind; try { kind = validateSyncObject(await readObject(body.object)).kind; } catch { check(false); } check(kind === 'keybox'); }
        const digest = createHash('sha256').update(body.secret, 'utf8').digest();
        check(!invites.some(e => timingSafeEqual(e.digest, digest)), 409);
        const unspent = invites.filter(e => !e.revoked && e.consumedAt === null);
        check(unspent.filter(e => e.issuer === device).length < 4 && unspent.length < 16, 429);
        invites.push({ digest, issuer: device, object: body.object, createdAt: now, expiresAt: now + INVITE_TTL, consumedAt: null, revoked: false, removing: false });
        send(201, { expiresAt: now + INVITE_TTL }); return;
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
      if (request.method === 'GET' && path === '/v1/challenge') {
        check(request.headers['content-length'] === undefined || request.headers['content-length'] === '0');
        send(200, { nonce: issueNonce(now) }); return;
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
      if (login && ['PUT', 'DELETE'].includes(request.method)) budget('device:' + login.deviceOf(authorized), limits.deviceWrites);
      let since;
      if (!login) {
        check(typeof device === 'string' && ascii(device), 401);
        since = spendNonce(nonce, now); check(since !== null, 401);
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
          await sweeping; check(!busy, 409); busy = true;
          try { const document = JSON.parse(body); check(JSON.stringify(document) === body); send(200, await access.apply(document)); }
          finally { busy = false; }
        }
        return;
      }
      if (request.method === 'DELETE') { await sweeping; await removeObject(path.slice(collection.length + 1)); send(200, { removed: true }); return; }
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
      if (login) validateSyncObject(body); else check(opaque(body) === device, 403);
      const id = sha(body);
      if (objects.has(id)) { send(200, { id }); return; }
      await sweeping; check(!uncertain, 503); check(!busy, 409); check(objects.size < 100 && total + bytes <= 32 * MAX, 507); busy = true;
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
    })().catch(error => send(error.status ?? 400, { error: 'request-rejected' }, error.retryAfter)).catch(() => {});
  });
  server.requestTimeout = 15_000; server.headersTimeout = 5000; server.keepAliveTimeout = 2000; server.maxConnections = 256; server.maxHeadersCount = 32;
  server.on('clientError', (_error, socket) => socket.destroy());
  // Per-source connection cap; off behind a trusted proxy because every socket then comes from the proxy.
  let socketMode = false; const perSource = new Map();
  if (!trustedProxy) {
    server.on('connection', socket => {
      if (socketMode) return;
      const source = sourceOf({ socket, headers: {} });
      const count = (perSource.get(source) ?? 0) + 1;
      if (count > limits.connectionsPerSource) { socket.destroy(); return; }
      perSource.set(source, count);
      socket.once('close', () => { const left = (perSource.get(source) ?? 1) - 1; if (left > 0) perSource.set(source, left); else perSource.delete(source); });
    });
  }
  return { server, info: { serverId, namespace }, async listen(port = 0, host = '127.0.0.1') {
    check(typeof host === 'string' && net.isIP(host) !== 0);
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
    const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : net.isIPv6(host) ? `[${host}]` : host;
    const url = `http://${shown}:${server.address().port}/`;
    if (origin === null) origin = new URL(url).origin;
    return url;
  }, async listenSocket(socketPath) {
    check(origin !== null && typeof socketPath === 'string' && socketPath.startsWith('/'));
    let existing = null; try { existing = await lstat(socketPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing) { check(existing.isSocket()); await unlink(socketPath); } // a stale socket of an earlier run
    // Behind the local proxy every peer is the socket; X-Forwarded-For always comes from it and the per-source connection cap does not apply.
    socketMode = true; trustedProxy = () => true;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
    await chmod(socketPath, 0o660);
    return socketPath;
  }, activeDevices: () => roster?.activeCount() ?? 0, async close() { clearInterval(sweepTimer); broker?.clear(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
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
