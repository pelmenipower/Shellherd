// Server-side roster of enrolled devices: persistent entries in devices.json, ephemeral ones in RAM only.
import { randomBytes, verify } from 'node:crypto';
import { constants } from 'node:fs';
import { open, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DEVICE_ENROLLMENT, DEVICE_NAME, enrollmentBody, signingKeyOf } from './device-proof.mjs';
import { deviceId } from './rendezvous.mjs';
const FORMAT = 'shellherd-device-roster';
const MAX_BYTES = 65536; const MAX_ENTRIES = 64; const MAX_ACTIVE = 16; const MAX_EPHEMERAL = 8; const EPHEMERAL_TTL = 12 * 3600_000;
const check = (ok, status = 400) => { if (!ok) { const error = Error('Device request rejected'); error.status = status; throw error; } };
const safe = value => Number.isSafeInteger(value) && value >= 0;
function base64(value, length) {
  check(typeof value === 'string' && value.length <= 256); const bytes = Buffer.from(value, 'base64');
  check(bytes.toString('base64') === value && bytes.length === length); return bytes;
}
export async function createDeviceRoster({ directory, serverId, namespace, clock = Date.now, fault = async () => {} }) {
  const file = join(directory, 'devices.json');
  const persistent = new Map(); // id -> entry
  const ephemeral = new Map(); // id -> entry + lastSession
  const keys = new Map(); // id -> KeyObject
  let uncertain = false; let chain = Promise.resolve();
  const wireOf = list => JSON.stringify({ format: FORMAT, version: 1, serverId, namespace, devices: list.map(e => ({ id: e.id, name: e.name, signingKey: e.signingKey, noiseKey: e.noiseKey, enrolledAt: e.enrolledAt, revokedAt: e.revokedAt })) });
  const ordered = list => [...list].sort((a, b) => a.enrolledAt - b.enrolledAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // Load
  let handle;
  try { handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) { if (error.code !== 'ENOENT') throw Object.assign(Error('Device roster unreadable'), { status: 500 }); }
  if (handle) {
    try {
      const stat = await handle.stat(); check(stat.isFile() && stat.nlink === 1 && (stat.mode & 0o077) === 0 && stat.size <= MAX_BYTES, 500);
      const data = Buffer.alloc(MAX_BYTES + 1); let used = 0;
      while (used < data.length) { const read = await handle.read(data, used, data.length - used, used); if (!read.bytesRead) break; used += read.bytesRead; }
      check(used <= MAX_BYTES, 500); const text = data.subarray(0, used).toString('utf8');
      let parsed; try { parsed = JSON.parse(text); } catch { check(false, 500); }
      check(parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).join(',') === 'format,version,serverId,namespace,devices' && parsed.format === FORMAT && parsed.version === 1 && parsed.serverId === serverId && parsed.namespace === namespace && Array.isArray(parsed.devices), 500);
      check(parsed.devices.length <= MAX_ENTRIES, 500);
      for (const raw of parsed.devices) {
        check(raw && typeof raw === 'object' && Object.keys(raw).join(',') === 'id,name,signingKey,noiseKey,enrolledAt,revokedAt', 500);
        let key; try { check(deviceId(raw.noiseKey) === raw.id); key = signingKeyOf(raw.signingKey); } catch { check(false, 500); }
        check(typeof raw.name === 'string' && DEVICE_NAME.test(raw.name) && safe(raw.enrolledAt) && (raw.revokedAt === null || (safe(raw.revokedAt) && raw.revokedAt >= raw.enrolledAt)) && !persistent.has(raw.id), 500);
        persistent.set(raw.id, { ...raw }); keys.set(raw.id, key);
      }
      check([...persistent.values()].filter(e => e.revokedAt === null).length <= MAX_ACTIVE, 500);
      check(wireOf([...persistent.values()]) === text, 500);
    } finally { await handle.close(); }
  }
  const expire = () => {
    const now = clock();
    for (const [id, entry] of ephemeral) if (now < entry.lastSession || now - entry.lastSession >= EPHEMERAL_TTL) { ephemeral.delete(id); keys.delete(id); }
  };
  const find = id => { expire(); return persistent.get(id) ?? ephemeral.get(id); };
  const view = e => ({ id: e.id, name: e.name, signingKey: e.signingKey, enrolledAt: e.enrolledAt, revokedAt: e.revokedAt, ephemeral: e.ephemeral === true });
  // Serialized writes: each task re-reads the current state; RAM state is replaced only after a successful write.
  const serial = task => { const result = chain.then(task); chain = result.catch(() => {}); return result; };
  async function write(next, apply) {
    check(!uncertain, 503);
    const temporary = join(directory, randomBytes(16).toString('hex') + '.devices-tmp'); let renamed = false;
    try {
      const f = await open(temporary, 'wx', 0o600);
      try { await f.writeFile(wireOf(ordered(next))); await f.sync(); } finally { await f.close(); }
      await fault('beforeDevicesRename'); await rename(temporary, file); renamed = true; await fault('afterDevicesRename');
      const dir = await open(directory, 'r'); try { await dir.sync(); } finally { await dir.close(); }
      apply();
    } catch (error) { if (renamed) uncertain = true; throw error; }
    finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
  }
  const roster = {
    hasSession: () => false,
    assertHealthy() { check(!uncertain, 503); },
    entry(id) { const e = find(id); return e ? view(e) : undefined; },
    signingKeyOf(id) { return find(id) ? keys.get(id) : undefined; },
    noiseKeyOf(id) { return find(id)?.noiseKey; },
    isActive(id) { const e = find(id); return Boolean(e) && e.revokedAt === null; },
    touch(id) { expire(); const e = ephemeral.get(id); if (e) e.lastSession = clock(); },
    list() { expire(); return ordered([...persistent.values(), ...ephemeral.values()]).map(view); },
    async enroll({ document, ephemeral: wantEphemeral = false }) {
      check(typeof wantEphemeral === 'boolean' && Array.isArray(document) && document.length === 2 && Array.isArray(document[0]) && document[0].length === 7);
      const [body, signature] = document;
      let key; let rebuilt;
      try { rebuilt = enrollmentBody(...body.slice(1)); key = signingKeyOf(body[4]); check(deviceId(body[5]) === body[3]); } catch { check(false); }
      check(JSON.stringify(body) === rebuilt && body[0] === DEVICE_ENROLLMENT && body[1] === serverId && body[2] === namespace);
      check(verify(null, Buffer.from(JSON.stringify(body)), key, base64(signature, 64)), 401);
      const [, , , id, signingKey, noiseKey, name] = body;
      expire(); const existing = persistent.get(id) ?? ephemeral.get(id);
      if (existing) {
        check(existing.signingKey === signingKey && existing.noiseKey === noiseKey && (existing.ephemeral === true) === wantEphemeral, 409);
        if (existing.name === name && existing.revokedAt === null) return { entry: view(existing), created: false };
        if (wantEphemeral) { existing.name = name; existing.revokedAt = null; return { entry: view(existing), created: false }; }
        return serial(async () => {
          const current = persistent.get(id); check(current, 409);
          const updated = { ...current, name, revokedAt: null }; const next = new Map(persistent); next.set(id, updated);
          if (current.name === name && current.revokedAt === null) return { entry: view(current), created: false };
          check(current.revokedAt === null || [...persistent.values()].filter(e => e.revokedAt === null).length < MAX_ACTIVE, 429);
          await write([...next.values()], () => { persistent.set(id, updated); });
          return { entry: view(updated), created: false };
        });
      }
      const now = clock();
      if (wantEphemeral) {
        if (ephemeral.size >= MAX_EPHEMERAL) {
          const candidates = [...ephemeral.values()].filter(e => !roster.hasSession(e.id)).sort((a, b) => a.lastSession - b.lastSession);
          check(candidates.length > 0, 429);
          ephemeral.delete(candidates[0].id); keys.delete(candidates[0].id);
        }
        const entry = { id, name, signingKey, noiseKey, enrolledAt: now, revokedAt: null, ephemeral: true, lastSession: now };
        ephemeral.set(id, entry); keys.set(id, key); return { entry: view(entry), created: true };
      }
      return serial(async () => {
        check(!persistent.has(id) && !ephemeral.has(id), 409);
        check([...persistent.values()].filter(e => e.revokedAt === null).length < MAX_ACTIVE, 429);
        const next = new Map(persistent); let dropped;
        if (next.size >= MAX_ENTRIES) {
          dropped = [...next.values()].filter(e => e.revokedAt !== null).sort((a, b) => a.revokedAt - b.revokedAt)[0];
          check(dropped, 429); next.delete(dropped.id);
        }
        const entry = { id, name, signingKey, noiseKey, enrolledAt: now, revokedAt: null };
        next.set(id, entry);
        await write([...next.values()], () => { if (dropped) { persistent.delete(dropped.id); keys.delete(dropped.id); } persistent.set(id, entry); keys.set(id, key); });
        return { entry: view(entry), created: true };
      });
    },
    async revoke(id) {
      const e = find(id); check(e, 404);
      if (e.ephemeral) { ephemeral.delete(id); keys.delete(id); return { revoked: true }; }
      if (e.revokedAt !== null) return { revoked: true };
      return serial(async () => {
        const current = persistent.get(id); if (!current || current.revokedAt !== null) return { revoked: true };
        const updated = { ...current, revokedAt: Math.max(clock(), current.enrolledAt) }; const next = new Map(persistent); next.set(id, updated);
        await write([...next.values()], () => { persistent.set(id, updated); });
        return { revoked: true };
      });
    },
  };
  return roster;
}
