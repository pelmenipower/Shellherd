import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import sodium from 'libsodium-wrappers';
import { afterEach, expect, it as linuxIt } from 'vitest';
import { Authority, Client, device } from './protocol.mjs';
import { createSyncServer } from './server.mjs';
import { requestProof } from './http-proof.mjs';
import { probeSyncServer, RemoteStore } from './http-transport.mjs';
// Persistence prototype relies on Linux permissions, directory fsync and process semantics.
const it = linuxIt.runIf(process.platform === 'linux');
const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-central-sync-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const a = device('alice'); const b = device('bob'); cleanup.push(() => { a.destroy(); b.destroy(); });
  const authority = new Authority('central-vault'); const membership = authority.setMembers([a, b]); cleanup.push(() => authority.destroy());
  const ca = new Client(a, authority.publicKey, 'central-vault'); ca.useMembership(membership);
  const cb = new Client(b, authority.publicKey, 'central-vault'); cb.useMembership(membership);
  const config = { directory, serverId: randomBytes(32).toString('hex'), namespace: 'central-vault', devices: [a, b].map(d => ({ id: d.id, signingKey: d.public[1] })) };
  const service = await createSyncServer(config); cleanup.push(() => service.close());
  const url = await service.listen(); const info = await probeSyncServer(url, { allowLoopbackHttp: true });
  return { directory, config, service, url, info, a, b, ca, cb, authority, remoteA: new RemoteStore(info, a), remoteB: new RemoteStore(info, b) };
}
it('stores E2EE snapshots centrally, serves an offline sender, accepts another device independently and survives server restart', async () => {
  const { ca, cb, a, authority, remoteA, remoteB, service, config, directory } = await setup();
  const wire = ca.snapshot({ api: { password: 'CENTRAL_SECRET_INITIAL' } });
  const root = await remoteA.put(wire);
  const savedA = ca.exportState(); ca.destroy(); authority.destroy(); // Sender and administrator are now offline.
  expect(a.signing.privateKey.every(v => v === 0)).toBe(true);
  expect(await remoteB.list()).toEqual([root]);
  cb.receive(await remoteB.get(root));
  const edited = cb.snapshot({ api: { password: 'CENTRAL_SECRET_FROM_B' } });
  const bId = await remoteB.put(edited); // No PC-to-PC link and no online management device.
  expect(await remoteB.put(edited)).toBe(bId);
  await service.close();
  const restarted = await createSyncServer(config); cleanup.push(() => restarted.close());
  const info = await probeSyncServer(await restarted.listen(), { allowLoopbackHttp: true });
  const restoredA = Client.restore(savedA); cleanup.push(() => restoredA.destroy());
  const remoteRestored = new RemoteStore(info, restoredA.identity);
  expect((await remoteRestored.list()).sort()).toEqual([root, bId].sort());
  const head = restoredA.receive(await remoteRestored.get(bId));
  expect(restoredA.value(head).api.password).toBe('CENTRAL_SECRET_FROM_B');
  for (const name of await readdir(directory)) {
    const bytes = await readFile(join(directory, name), 'utf8');
    expect(bytes).not.toContain('CENTRAL_SECRET'); expect(bytes).not.toContain(savedA[3][2]);
  }
});
it('rejects unauthorized devices, nonce replay, changed request bodies and wrong server audience', async () => {
  const { info, url, a, ca, remoteA } = await setup();
  const wire = ca.snapshot({ api: { password: 'secret' } });
  const rogue = device('rogue'); cleanup.push(() => rogue.destroy());
  await expect(new RemoteStore(info, rogue).list()).rejects.toThrow();
  const path = `/v1/vaults/${info.namespace}/objects`;
  async function signed(body, proofBody = body, audience = info.serverUrl) {
    const { nonce } = await (await fetch(new URL('v1/challenge', url))).json();
    const signature = sodium.to_base64(sodium.crypto_sign_detached(requestProof(info.serverId, audience, 'PUT', path, nonce, a.id, proofBody), a.signing.privateKey), sodium.base64_variants.ORIGINAL);
    return { method: 'PUT', headers: { 'content-type': 'application/json', 'x-shellherd-device': a.id, 'x-shellherd-nonce': nonce, 'x-shellherd-signature': signature }, body };
  }
  const request = await signed(wire);
  expect((await fetch(new URL(path, url), request)).status).toBe(201);
  expect((await fetch(new URL(path, url), request)).status).toBe(401);
  expect((await fetch(new URL(path, url), await signed(wire, wire + ' '))).status).toBe(401);
  expect((await fetch(new URL(path, url), await signed(wire, wire, 'https://other.invalid/'))).status).toBe(401);
  await expect(remoteA.put(JSON.stringify([['shellherd-lab-local-v1'], 'private-checkpoint']))).rejects.toThrow();
});
it('detects altered server blobs and refuses redirects or unrelated HTTP services during URL setup', async () => {
  const { remoteA, ca, directory } = await setup();
  const wire = ca.snapshot({ api: { password: 'secret' } }); const id = await remoteA.put(wire);
  await writeFile(join(directory, id + '.blob'), wire + ' ');
  await expect(remoteA.get(id)).rejects.toThrow();
  let redirects = 0;
  const redirect = createServer((req, res) => { redirects++; res.writeHead(302, { location: '/target' }); res.end(); });
  await new Promise(resolve => redirect.listen(0, '127.0.0.1', resolve));
  cleanup.push(() => new Promise(resolve => { redirect.closeAllConnections(); redirect.close(resolve); }));
  await expect(probeSyncServer(`http://127.0.0.1:${redirect.address().port}/`, { allowLoopbackHttp: true })).rejects.toThrow();
  expect(redirects).toBe(1);
});

const get = (url, options) => fetch(url, options);
it('rate limits /v1/info per source with retry-after and X-Forwarded-For only behind a trusted proxy', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-limits-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const a = device('alice'); cleanup.push(() => a.destroy());
  const config = { directory, serverId: randomBytes(32).toString('hex'), namespace: 'central-vault', devices: [{ id: a.id, signingKey: a.public[1] }], clock: () => 5000 };
  const plain = await createSyncServer(config); cleanup.push(() => plain.close()); const url = await plain.listen();
  for (let i = 0; i < 30; i++) expect((await get(url + 'v1/info')).status).toBe(200);
  const limited = await get(url + 'v1/info'); expect(limited.status).toBe(429); expect(Number(limited.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
  expect((await get(url + 'v1/info', { headers: { 'x-forwarded-for': '9.9.9.9' } })).status).toBe(429); // header ignored without the flag
  await plain.close();
  const proxied = await createSyncServer({ ...config, trustedProxy: '127.0.0.1' }); cleanup.push(() => proxied.close()); const proxiedUrl = await proxied.listen();
  for (let i = 0; i < 30; i++) await get(proxiedUrl + 'v1/info', { headers: { 'x-forwarded-for': '1.1.1.1' } });
  expect((await get(proxiedUrl + 'v1/info', { headers: { 'x-forwarded-for': '1.1.1.1' } })).status).toBe(429);
  expect((await get(proxiedUrl + 'v1/info', { headers: { 'x-forwarded-for': '2.2.2.2' } })).status).toBe(200); // other source
  expect((await get(proxiedUrl + 'v1/info', { headers: { 'x-forwarded-for': '9.9.9.9, 1.1.1.1' } })).status).toBe(429); // last element counts
});
it('does not let one source exhaust the global budget for others', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-global-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const a = device('alice'); cleanup.push(() => a.destroy());
  const service = await createSyncServer({ directory, serverId: randomBytes(32).toString('hex'), namespace: 'central-vault', devices: [{ id: a.id, signingKey: a.public[1] }], trustedProxy: '127.0.0.1', clock: () => 5000 });
  cleanup.push(() => service.close()); const url = await service.listen();
  for (let i = 0; i < 600; i++) await get(url + 'v1/info', { headers: { 'x-forwarded-for': '6.6.6.6' } });
  expect((await get(url + 'v1/info', { headers: { 'x-forwarded-for': '1.2.3.4' } })).status).toBe(200);
});
it('closes the ninth connection of one source unless a trusted proxy is configured', async () => {
  const open = async (trustedProxy) => {
    const directory = await mkdtemp(join(tmpdir(), 'shellherd-conn-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
    const a = device('alice'); cleanup.push(() => a.destroy());
    const service = await createSyncServer({ directory, serverId: randomBytes(32).toString('hex'), namespace: 'central-vault', devices: [{ id: a.id, signingKey: a.public[1] }], trustedProxy });
    cleanup.push(() => service.close()); const port = Number(new URL(await service.listen()).port);
    const sockets = []; let closed = 0;
    for (let i = 0; i < 9; i++) await new Promise(resolve => { const s = connect(port, '127.0.0.1', resolve); s.on('error', () => {}); s.on('close', () => { closed++; }); sockets.push(s); });
    await new Promise(resolve => setTimeout(resolve, 150)); sockets.forEach(s => s.destroy()); return closed;
  };
  expect(await open(false)).toBeGreaterThanOrEqual(1);
  expect(await open('127.0.0.1')).toBe(0);
});

it('refuses DELETE in device mode and validates listen hosts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-del-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const a = device('alice'); cleanup.push(() => a.destroy());
  const service = await createSyncServer({ directory, serverId: randomBytes(32).toString('hex'), namespace: 'central-vault', devices: [{ id: a.id, signingKey: a.public[1] }] });
  cleanup.push(() => service.close());
  await expect(service.listen(0, 'nicht-ip')).rejects.toMatchObject({ status: 400 });
  await expect(service.listen(0, 42)).rejects.toMatchObject({ status: 400 });
  const url = await service.listen(); const res = await fetch(url + 'v1/vaults/central-vault/objects/' + 'a'.repeat(64), { method: 'DELETE' });
  expect(res.status).toBe(405);
});
it('accepts private and IPv6 listen hosts past the check and formats the returned URL', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-host-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const a = device('alice'); cleanup.push(() => a.destroy());
  const make = () => createSyncServer({ directory, serverId: randomBytes(32).toString('hex'), namespace: 'central-vault', devices: [{ id: a.id, signingKey: a.public[1] }] });
  const bind = await make(); cleanup.push(() => bind.close());
  await bind.listen(0, '10.9.8.7').catch(error => expect(error.status).not.toBe(400)); // bind may fail on this host; the check must pass
  const v6 = await make(); cleanup.push(() => v6.close());
  const url = await v6.listen(0, '::1').catch(error => { expect(error.status).not.toBe(400); return null; });
  if (url) expect(url).toMatch(/^http:\/\/\[::1\]:\d+\/$/);
  const any = await make(); cleanup.push(() => any.close());
  expect(await any.listen(0, '0.0.0.0')).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
});
