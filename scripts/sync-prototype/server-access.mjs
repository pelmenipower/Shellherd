// Server-side access control. Node primitives only; stores public metadata, never client secrets.
import { createHash, createPublicKey, randomBytes, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
export const accessDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function accessCheck(ok, status = 400) { if (!ok) { const error = Error('Access request rejected'); error.status = status; throw error; } }
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
export function accessBytes(value, size) {
  accessCheck(typeof value === 'string' && value.length < 256);
  const data = Buffer.from(value, 'base64'); accessCheck(data.length === size && data.toString('base64') === value); return data;
}
export function signingPublicKey(value) {
  return createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), accessBytes(value, 32)]), format: 'der', type: 'spki' });
}
export function parseEnrollment(document, serverId, namespace) {
  accessCheck(Array.isArray(document) && document.length === 2);
  const [body, signature] = document;
  accessCheck(Array.isArray(body) && body.length === 4 && body[0] === 'shellherd-server-enrollment-v1' && body[1] === serverId && body[2] === namespace);
  const member = body[3]; accessCheck(Array.isArray(member) && member.length === 3 && id(member[0]));
  accessBytes(member[1], 32); accessBytes(member[2], 32);
  accessCheck(verify(null, Buffer.from(JSON.stringify(body)), signingPublicKey(member[1]), accessBytes(signature, 64)), 401);
  return { device: member, fingerprint: accessDigest(body) };
}

export async function createAccessRegistry({ directory, serverId, namespace, devices, keys, adminPublicKey = null, adminDevices = [], clock = Date.now, fault = async () => {} }) {
  const enabled = adminPublicKey !== null;
  accessCheck(Array.isArray(adminDevices) && adminDevices.length <= 16 && new Set(adminDevices).size === adminDevices.length);
  const bootstrap = new Map(devices.map(d => [d.id, d.signingKey]));
  accessCheck(!enabled || adminDevices.length > 0);
  accessCheck(adminDevices.every(d => bootstrap.has(d)));
  const root = enabled ? signingPublicKey(adminPublicKey) : null;
  let roster = devices.map(d => [d.id, d.signingKey, null]); let current = null; let revision = 0; let busy = false; let uncertain = false;
  const pending = new Map(); const file = join(directory, 'access.json');
  function unpack(document) {
    accessCheck(enabled && Array.isArray(document) && document.length === 2, 403);
    const [body, signature] = document;
    accessCheck(Array.isArray(body) && body.length === 7 && body[0] === 'shellherd-server-access-v1' && body[1] === serverId && body[2] === namespace);
    accessCheck(Number.isSafeInteger(body[3]) && body[3] > 0 && (body[4] === null || /^[a-f0-9]{64}$/.test(body[4])));
    accessCheck(Array.isArray(body[5]) && body[5].length > 0 && body[5].length <= 16 && new Set(body[5].map(v => v?.[0])).size === body[5].length);
    for (const entry of body[5]) {
      accessCheck(Array.isArray(entry) && entry.length === 3 && id(entry[0]) && (entry[2] === null || /^[a-f0-9]{64}$/.test(entry[2]))); signingPublicKey(entry[1]);
    }
    accessCheck(adminDevices.every(admin => body[5].some(v => v[0] === admin && v[1] === bootstrap.get(admin))), 403);
    accessCheck(Array.isArray(body[6]) && body[6].length === 3 && ['approve', 'revoke'].includes(body[6][0]) && id(body[6][1]));
    accessCheck(verify(null, Buffer.from(JSON.stringify(body)), root, accessBytes(signature, 64)), 403);
    return body;
  }
  function install(document, body) {
    current = structuredClone(document); revision = body[3]; roster = structuredClone(body[5]);
    keys.clear(); for (const entry of roster) keys.set(entry[0], signingPublicKey(entry[1]));
  }
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await handle.stat(); accessCheck(stat.isFile() && stat.nlink === 1 && stat.size <= 16384 && (stat.mode & 0o077) === 0, 500);
    const wire = await handle.readFile('utf8'); accessCheck(Buffer.byteLength(wire) <= 16384, 500);
    const document = JSON.parse(wire); accessCheck(JSON.stringify(document) === wire, 500); install(document, unpack(document));
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  finally { await handle?.close(); }
  const expire = () => { for (const [key, value] of pending) if (clock() < value.created || clock() - value.created >= 300_000) pending.delete(key); };
  return {
    enabled, adminPublicKey,
    assertHealthy() { accessCheck(!uncertain, 503); },
    isAdmin(deviceId) { return adminDevices.includes(deviceId); },
    pendingKey(requestId, deviceId) { expire(); const item = pending.get(requestId); return item?.device[0] === deviceId ? signingPublicKey(item.device[1]) : undefined; },
    registrationKey(body, deviceId) {
      accessCheck(enabled, 404); const document = JSON.parse(body); const parsed = parseEnrollment(document, serverId, namespace);
      accessCheck(JSON.stringify(document) === body && parsed.device[0] === deviceId, 401); return signingPublicKey(parsed.device[1]);
    },
    enroll(body) {
      accessCheck(enabled, 404); expire(); const document = JSON.parse(body); const parsed = parseEnrollment(document, serverId, namespace);
      accessCheck(!roster.some(d => d[0] === parsed.device[0]), 409);
      for (const item of pending.values()) if (item.device[0] === parsed.device[0]) { accessCheck(item.fingerprint === parsed.fingerprint, 409); return structuredClone(item); }
      accessCheck(pending.size < 16, 429);
      const item = { requestId: randomBytes(32).toString('hex'), document, ...parsed, created: clock(), expiresAt: clock() + 300_000 };
      pending.set(item.requestId, item); return structuredClone(item);
    },
    listPending() { expire(); return [...pending.values()].map(v => structuredClone(v)); },
    enrollmentStatus(requestId, deviceId) {
      expire(); const item = pending.get(requestId);
      if (item?.device[0] === deviceId) return { status: 'pending', requestId, fingerprint: item.fingerprint, expiresAt: item.expiresAt };
      accessCheck(roster.some(d => d[0] === deviceId && d[2] === requestId), 404);
      return { status: 'authorized', requestId, access: structuredClone(current) };
    },
    withdraw(requestId, deviceId) { expire(); accessCheck(pending.get(requestId)?.device[0] === deviceId, 404); pending.delete(requestId); return { status: 'withdrawn' }; },
    status() { return { serverId, namespace, revision, digest: current === null ? null : accessDigest(current), devices: structuredClone(roster), access: structuredClone(current) }; },
    async apply(document) {
      accessCheck(!uncertain, 503); accessCheck(!busy, 409); expire();
      // Exact retries are idempotent; a stale signed document never rolls state back.
      if (current && JSON.stringify(current) === JSON.stringify(document)) return this.status();
      const body = unpack(document); accessCheck(body[3] === revision + 1 && body[4] === (current === null ? null : accessDigest(current)), 409);
      const [kind, deviceId, proof] = body[6]; let expected;
      if (kind === 'approve') {
        accessCheck(Array.isArray(proof) && proof.length === 2, 400);
        const item = pending.get(proof[0]); accessCheck(item && item.device[0] === deviceId && item.fingerprint === proof[1], 409);
        accessCheck(!roster.some(d => d[0] === deviceId), 409);
        expected = [...roster, [deviceId, item.device[1], item.requestId]];
      } else {
        accessCheck(proof === null && roster.some(d => d[0] === deviceId) && !adminDevices.includes(deviceId), 403);
        expected = roster.filter(d => d[0] !== deviceId);
      }
      const sorted = value => [...value].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
      accessCheck(JSON.stringify(sorted(expected)) === JSON.stringify(body[5]), 403);
      const wire = JSON.stringify(document); accessCheck(Buffer.byteLength(wire) <= 16384); busy = true;
      const temporary = join(directory, randomBytes(16).toString('hex') + '.access-tmp'); let renamed = false;
      try {
        const f = await open(temporary, 'wx', 0o600); try { await f.writeFile(wire); await f.sync(); } finally { await f.close(); }
        await fault('beforeAccessRename'); await rename(temporary, file); renamed = true; await fault('afterAccessRename');
        const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
        install(document, body); if (kind === 'approve') pending.delete(proof[0]); return this.status();
      } catch (error) { if (renamed) uncertain = true; throw error; }
      finally { busy = false; await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
    },
  };
}
