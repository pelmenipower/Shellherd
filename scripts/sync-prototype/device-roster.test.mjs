import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { sign } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it as platformIt } from 'vitest';
import { createDeviceIdentity, enrollmentBody } from './device-proof.mjs';
import { createDeviceRoster } from './device-roster.mjs';

const it = platformIt.runIf(process.platform === 'linux');
const serverId = '1'.repeat(64); const namespace = 'roster'; const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(options = {}) {
  const directory = options.directory ?? await mkdtemp(join(tmpdir(), 'shellherd-roster-')); if (!options.directory) cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let now = 1000; const clock = () => now;
  const roster = await createDeviceRoster({ directory, serverId, namespace, clock, ...options.extra });
  return { directory, roster, advance: ms => { now += ms; }, reopen: () => createDeviceRoster({ directory, serverId, namespace, clock }) };
}
const document = (identity, name = 'Laptop', patch = {}) => {
  const body = JSON.parse(enrollmentBody(serverId, namespace, identity.id, identity.signingPublicKey, identity.publicKey, name));
  Object.entries(patch).forEach(([i, v]) => { body[i] = v; });
  return [body, sign(null, Buffer.from(JSON.stringify(body)), identity.signingKey).toString('base64')];
};
const enroll = (roster, identity, name, ephemeral = false) => roster.enroll({ document: document(identity, name), ephemeral });
const status = async promise => (await promise.then(() => null, e => e))?.status;

it('enrolls, lists with signing keys sorted by enrolledAt then id, and exposes the lookups', async () => {
  const { roster, advance } = await setup(); const a = createDeviceIdentity(); const b = createDeviceIdentity();
  expect(roster.list()).toEqual([]);
  expect((await enroll(roster, a, 'A')).created).toBe(true); advance(5); await enroll(roster, b, 'B');
  expect(roster.list()).toEqual([
    { id: a.id, name: 'A', signingKey: a.signingPublicKey, enrolledAt: 1000, revokedAt: null, ephemeral: false },
    { id: b.id, name: 'B', signingKey: b.signingPublicKey, enrolledAt: 1005, revokedAt: null, ephemeral: false },
  ]);
  expect(roster.noiseKeyOf(a.id)).toBe(a.publicKey); expect(roster.isActive(a.id)).toBe(true); expect(roster.isActive('f'.repeat(64))).toBe(false);
  expect(roster.signingKeyOf(a.id).asymmetricKeyType).toBe('ed25519'); expect(roster.entry(b.id).name).toBe('B');
  const ids = [createDeviceIdentity(), createDeviceIdentity()]; for (const i of ids) await enroll(roster, i, 'same');
  const sameTime = roster.list().filter(d => d.name === 'same').map(d => d.id); expect(sameTime).toEqual(sameTime.slice().sort());
});
it('rejects malformed, mismatching and wrongly signed enrollment documents', async () => {
  const { roster } = await setup(); const id = createDeviceIdentity(); const other = createDeviceIdentity();
  expect(await status(roster.enroll({ document: document(id, 'x', { 3: other.id }) }))).toBe(400);
  expect(await status(roster.enroll({ document: document(id, 'x', { 1: '2'.repeat(64) }) }))).toBe(400);
  expect(await status(roster.enroll({ document: document(id, 'x', { 2: 'other' }) }))).toBe(400);
  expect(await status(roster.enroll({ document: document(id, 'x', { 0: 'tag' }) }))).toBe(400);
  expect(await status(roster.enroll({ document: [document(id)[0]] }))).toBe(400);
  expect(await status(roster.enroll({ document: 'nope' }))).toBe(400);
  // Signed by another key: 401.
  const forged = document(id); forged[1] = sign(null, Buffer.from(JSON.stringify(forged[0])), other.signingKey).toString('base64');
  expect(await status(roster.enroll({ document: forged }))).toBe(401);
  // Identity point as signing key.
  const point = Buffer.concat([Buffer.from([1]), Buffer.alloc(31)]).toString('base64');
  const weak = JSON.parse(enrollmentBody(serverId, namespace, id.id, id.signingPublicKey, id.publicKey, 'w')); weak[4] = point;
  expect(await status(roster.enroll({ document: [weak, Buffer.concat([Buffer.from([1]), Buffer.alloc(63)]).toString('base64')] }))).toBe(400);
  expect(roster.list()).toEqual([]);
});
it('is idempotent for the same keys, updates the name and lifts a revocation on re-enrollment', async () => {
  const { roster, directory } = await setup(); const id = createDeviceIdentity(); await enroll(roster, id, 'One');
  const before = await readFile(join(directory, 'devices.json'), 'utf8');
  expect(await enroll(roster, id, 'One')).toMatchObject({ created: false }); expect(await readFile(join(directory, 'devices.json'), 'utf8')).toBe(before);
  expect((await enroll(roster, id, 'Two')).entry.name).toBe('Two');
  await roster.revoke(id.id); expect(roster.isActive(id.id)).toBe(false);
  expect((await enroll(roster, id, 'Two')).created).toBe(false); expect(roster.isActive(id.id)).toBe(true); expect(roster.entry(id.id).revokedAt).toBeNull();
});
it('answers 409 for the same id with another key or another ephemeral flag, also when revoked', async () => {
  const { roster } = await setup(); const id = createDeviceIdentity(); await enroll(roster, id, 'One');
  const other = createDeviceIdentity(); const swapped = { ...other, id: id.id, publicKey: id.publicKey };
  expect(await status(roster.enroll({ document: document(swapped, 'Evil') }))).toBe(409);
  expect(await status(enroll(roster, id, 'One', true))).toBe(409);
  await roster.revoke(id.id); expect(await status(roster.enroll({ document: document(swapped, 'Evil') }))).toBe(409);
});
it('revokes idempotently, answers 404 for unknown ids and removes ephemeral entries', async () => {
  const { roster } = await setup(); const id = createDeviceIdentity(); await enroll(roster, id, 'One');
  expect(await roster.revoke(id.id)).toEqual({ revoked: true }); const at = roster.entry(id.id).revokedAt; expect(typeof at).toBe('number');
  expect(await roster.revoke(id.id)).toEqual({ revoked: true }); expect(roster.entry(id.id).revokedAt).toBe(at);
  expect(roster.signingKeyOf(id.id)).toBeDefined(); // revoked entries keep their key for author checks
  expect(await status(roster.revoke('9'.repeat(64)))).toBe(404);
  const eph = createDeviceIdentity(); await enroll(roster, eph, 'Eph', true); await roster.revoke(eph.id); expect(roster.entry(eph.id)).toBeUndefined();
});
it('caps active persistent devices at 16 and drops the oldest revoked entry at 64', async () => {
  const { roster, advance } = await setup(); const all = [];
  for (let i = 0; i < 16; i++) { const id = createDeviceIdentity(); all.push(id); await enroll(roster, id, 'd' + i); advance(1); }
  expect(await status(enroll(roster, createDeviceIdentity(), 'x'))).toBe(429);
  // Revoke and re-add up to 64 entries; the oldest revocation falls out first.
  const revokedOrder = [];
  for (let i = 0; i < 64 - 16; i++) { await roster.revoke(all[i % 16].id); revokedOrder.push(all[i % 16].id); const id = createDeviceIdentity(); all.push(id); advance(1); await enroll(roster, id, 'n' + i); all[i % 16] = id; advance(1); }
  expect(roster.list()).toHaveLength(64);
  const oldest = roster.list().filter(d => d.revokedAt !== null).sort((a, b) => a.revokedAt - b.revokedAt)[0].id;
  await roster.revoke(all[0].id); advance(1);
  await enroll(roster, createDeviceIdentity(), 'p65');
  expect(roster.list()).toHaveLength(64); expect(roster.entry(oldest)).toBeUndefined();
});
it('keeps ephemeral entries in RAM only, expires them after 12 hours and evicts the oldest idle one', async () => {
  const { roster, directory, advance } = await setup(); const active = new Set(); roster.hasSession = id => active.has(id);
  const first = createDeviceIdentity(); await enroll(roster, first, 'e0', true); expect(roster.entry(first.id).ephemeral).toBe(true);
  expect(await readdir(directory)).toEqual([]);
  const rest = []; for (let i = 1; i < 8; i++) { advance(10); const id = createDeviceIdentity(); rest.push(id); await enroll(roster, id, 'e' + i, true); }
  advance(10); await enroll(roster, createDeviceIdentity(), 'e8', true);
  expect(roster.entry(first.id)).toBeUndefined(); expect(roster.list()).toHaveLength(8);
  // All active: 429.
  for (const d of roster.list()) active.add(d.id);
  expect(await status(enroll(roster, createDeviceIdentity(), 'e9', true))).toBe(429);
  // touch() renews the lease; without it the entry expires after 12 hours.
  active.clear(); advance(11 * 3600_000); roster.touch(rest[0].id); advance(3600_000);
  expect(roster.entry(rest[0].id)).toBeDefined(); expect(roster.entry(rest[1].id)).toBeUndefined();
});
it('persists atomically with private permissions and survives a restart without ephemeral entries', async () => {
  const { roster, directory, reopen } = await setup(); const p = createDeviceIdentity(); const e = createDeviceIdentity();
  await enroll(roster, p, 'Persistent'); await enroll(roster, e, 'Temporary', true); await roster.revoke(p.id);
  expect(await readdir(directory)).toEqual(['devices.json']);
  const text = await readFile(join(directory, 'devices.json'), 'utf8'); expect(JSON.parse(text)).toMatchObject({ format: 'shellherd-device-roster', version: 1, serverId, namespace });
  expect(text).not.toContain('Temporary');
  const next = await reopen(); expect(next.list()).toEqual([expect.objectContaining({ id: p.id, name: 'Persistent', revokedAt: expect.any(Number) })]);
});
it('turns an uncertain write after the rename into 503 for every later call', async () => {
  let fail = true; const { roster, reopen } = await setup({ extra: { fault: async point => { if (fail && point === 'afterDevicesRename') throw Error('boom'); } } });
  const id = createDeviceIdentity(); await expect(enroll(roster, id, 'One')).rejects.toThrow('boom'); fail = false;
  expect(() => roster.assertHealthy()).toThrow(); expect(await status(enroll(roster, createDeviceIdentity(), 'Two'))).toBe(503);
  expect((await reopen()).list()).toHaveLength(1); // the rename did happen
});
it('keeps the old state when the write fails before the rename', async () => {
  const { roster, directory } = await setup({ extra: { fault: async point => { if (point === 'beforeDevicesRename') throw Error('early'); } } });
  await expect(enroll(roster, createDeviceIdentity(), 'One')).rejects.toThrow('early');
  expect(roster.list()).toEqual([]); expect(() => roster.assertHealthy()).not.toThrow(); expect(await readdir(directory)).toEqual([]);
});
it('serializes concurrent enrollments without losing one', async () => {
  const { roster, reopen } = await setup(); const ids = Array.from({ length: 6 }, createDeviceIdentity);
  await Promise.all(ids.map((id, i) => enroll(roster, id, 'c' + i)));
  expect(roster.list()).toHaveLength(6); expect((await reopen()).list()).toHaveLength(6);
});
it('answers 200 for the second of two concurrent identical persistent enrollments', async () => {
  const { roster } = await setup(); const id = createDeviceIdentity();
  const results = await Promise.all([enroll(roster, id, 'Same'), enroll(roster, id, 'Same')]);
  expect(results.map(r => r.created).sort()).toEqual([false, true]);
});
it('refuses to start on an unsafe, foreign or non-canonical devices.json', async () => {
  const { roster, directory } = await setup(); await enroll(roster, createDeviceIdentity(), 'One'); const file = join(directory, 'devices.json');
  const text = await readFile(file, 'utf8'); const open = (extra = {}) => createDeviceRoster({ directory, serverId, namespace, ...extra });
  await expect(createDeviceRoster({ directory, serverId: '2'.repeat(64), namespace })).rejects.toMatchObject({ status: 500 });
  await expect(createDeviceRoster({ directory, serverId, namespace: 'other' })).rejects.toMatchObject({ status: 500 });
  await writeFile(file, JSON.stringify(JSON.parse(text), null, 1), { mode: 0o600 }); await expect(open()).rejects.toMatchObject({ status: 500 });
  await writeFile(file, text.replace('"One"', '"O\\u0000ne"'), { mode: 0o600 }); await expect(open()).rejects.toMatchObject({ status: 500 });
  await writeFile(file, text.replace(/"id":"[a-f0-9]{64}"/, `"id":"${'0'.repeat(64)}"`), { mode: 0o600 }); await expect(open()).rejects.toMatchObject({ status: 500 });
  await writeFile(file, text, { mode: 0o600 }); await chmod(file, 0o644); await expect(open()).rejects.toMatchObject({ status: 500 });
  await chmod(file, 0o600); expect((await open()).list()).toHaveLength(1);
  await rm(file); await symlink('/etc/hostname', file); await expect(open()).rejects.toThrow();
});
