import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { afterEach, describe as linuxDescribe, expect, it as linuxIt } from 'vitest';
import sodium from 'libsodium-wrappers';
import { createSyncServer } from './server.mjs';
import { Authority, Client, device } from './protocol.mjs';
import { probeSyncServer } from './http-transport.mjs';
import { DeviceAccess, ServerAdmin, verifyEnrollment } from './client-access.mjs';
import { LocalState } from './local-state.mjs';
// Persistence prototype relies on Linux permissions, directory fsync and process semantics.
const it = linuxIt.runIf(process.platform === 'linux');
const describe = linuxDescribe.runIf(process.platform === 'linux');
const cleanup = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function setup(overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'shellherd-device-auth-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const owner = device('owner'); const joining = device('joining'); const admin = new ServerAdmin();
  cleanup.push(() => { owner.destroy(); joining.destroy(); admin.destroy(); });
  const config = { directory, serverId: randomBytes(32).toString('hex'), namespace: 'devices', devices: [{ id: owner.id, signingKey: owner.public[1] }], adminPublicKey: admin.publicKey, adminDevices: [owner.id], ...overrides };
  const server = await createSyncServer(config); cleanup.push(() => server.close());
  const info = await probeSyncServer(await server.listen(), { allowLoopbackHttp: true });
  admin.bootstrap(info, [[owner.id, owner.public[1], null]]);
  const operator = new DeviceAccess(info, owner); const candidate = new DeviceAccess(info, joining);
  const approve = async () => {
    const pending = await candidate.enroll(); const status = await operator.accessStatus();
    const document = admin.approve(info, status, (await operator.pending())[0], pending.fingerprint);
    const accepted = await operator.apply(document); admin.acceptStatus(info, accepted); return { pending, document, accepted };
  };
  return { directory, owner, joining, admin, config, server, info, operator, candidate, approve };
}
describe('central server explicit device authorization', () => {
  it('keeps a self-signed request pending until an independent fingerprint comparison and signed approval', async () => {
    const { candidate, operator, info, admin, joining, owner } = await setup();
    expect(info.enrollmentAvailable).toBe(true);
    await expect(candidate.list()).rejects.toMatchObject({ status: 401 });
    const pending = await candidate.enroll(); expect((await candidate.enroll()).requestId).toBe(pending.requestId);
    expect(await candidate.enrollmentStatus(pending.requestId)).toMatchObject({ status: 'pending' });
    expect((await operator.pending())[0].device).toEqual(joining.public);
    await expect(candidate.accessStatus()).rejects.toMatchObject({ status: 401 });
    const status = await operator.accessStatus();
    expect(() => admin.approve(info, status, pending, '0'.repeat(64))).toThrow();
    const approval = admin.approve(info, status, pending, pending.fingerprint);
    expect(approval[0][5].map(d => d[0]).sort()).toEqual([joining.id, owner.id].sort());
    const accepted = await operator.apply(approval); admin.acceptStatus(info, accepted);
    expect(await candidate.list()).toEqual([]);
    expect(await candidate.enrollmentStatus(pending.requestId)).toMatchObject({ status: 'authorized' });
    expect(await operator.pending()).toEqual([]);
    expect(await operator.apply(approval)).toEqual(accepted); // Exact network retry only.
  });

  it('does not let a normal approved device add devices or grant Vault decryption', async () => {
    const { owner, joining, operator, candidate, info, admin, approve } = await setup(); await approve();
    await expect(candidate.pending()).rejects.toMatchObject({ status: 403 });
    const current = await operator.accessStatus(); const forged = structuredClone(current.access); forged[0][3]++;
    await expect(operator.apply(forged)).rejects.toMatchObject({ status: 403 });
    await expect(candidate.apply(current.access)).rejects.toMatchObject({ status: 403 });
    const authority = new Authority('devices'); const membership = authority.setMembers([owner]);
    const client = new Client(owner, authority.publicKey, 'devices'); client.useMembership(membership);
    const wire = client.snapshot({ api: { password: 'STILL_E2EE_PRIVATE' } }); const id = await operator.put(wire);
    expect(await candidate.get(id)).toBe(wire); // Storage access alone cannot unwrap the key.
    const packet = JSON.parse(wire)[1][0][2];
    expect(() => sodium.crypto_box_seal_open(Buffer.from(packet, 'base64'), joining.box.publicKey, joining.box.privateKey)).toThrow();
    const outsider = new Client(joining, authority.publicKey, 'devices');
    expect(() => outsider.useMembership(membership)).toThrow('removed'); authority.destroy();
    expect(() => admin.approve(info, { ...current, devices: [...current.devices, ['extra', owner.public[1], null]] }, { document: [] }, 'x')).toThrow();
  });

  it('persists grants and revocations across restart, invalidates pending requests and rejects old roster replay', async () => {
    const { config, server, owner, joining, admin, info, operator, candidate, approve } = await setup();
    const { document } = await approve();
    const savedAdmin = admin.exportState(); const restoredAdmin = ServerAdmin.restore(savedAdmin); cleanup.push(() => restoredAdmin.destroy());
    await server.close(); const next = await createSyncServer(config); cleanup.push(() => next.close());
    const nextInfo = await probeSyncServer(await next.listen(), { allowLoopbackHttp: true });
    const nextOperator = new DeviceAccess(nextInfo, owner); const nextCandidate = new DeviceAccess(nextInfo, joining);
    expect(await nextCandidate.list()).toEqual([]);
    const current = await nextOperator.accessStatus();
    const revoked = await nextOperator.apply(restoredAdmin.revoke(nextInfo, current, joining.id)); restoredAdmin.acceptStatus(nextInfo, revoked);
    await expect(nextCandidate.list()).rejects.toMatchObject({ status: 401 });
    await expect(nextOperator.apply(document)).rejects.toMatchObject({ status: 409 });
    expect(() => restoredAdmin.acceptStatus(info, current)).toThrow();
    await next.close(); const last = await createSyncServer(config); cleanup.push(() => last.close());
    const finalInfo = await probeSyncServer(await last.listen(), { allowLoopbackHttp: true });
    await expect(new DeviceAccess(finalInfo, joining).list()).rejects.toMatchObject({ status: 401 });
    expect((await new DeviceAccess(finalInfo, owner).accessStatus()).revision).toBe(2);
  });

  it('does not trust an unpinned bootstrap list or server-replaced public keys/fingerprints', async () => {
    const { operator, candidate, admin, info, owner } = await setup(); const pending = await candidate.enroll();
    const status = await operator.accessStatus();
    const wrongBootstrap = { ...status, devices: [...status.devices, ['injected', owner.public[1], null]] };
    expect(() => admin.approve(info, wrongBootstrap, pending, pending.fingerprint)).toThrow();
    const modified = structuredClone(pending); modified.document[0][3][1] = owner.public[1];
    expect(() => verifyEnrollment(info, modified)).toThrow();
    expect(() => admin.approve({ ...info, serverId: 'a'.repeat(64) }, status, pending, pending.fingerprint)).toThrow();
  });

  it('expires/withdraws requests and refuses approval after server restart', async () => {
    let now = 1000;
    const { operator, candidate, admin, info, config, server } = await setup({ clock: () => now });
    const pending = await candidate.enroll(); await candidate.withdraw(pending.requestId);
    expect(await operator.pending()).toEqual([]);
    const withdrawnApproval = admin.approve(info, await operator.accessStatus(), pending, pending.fingerprint);
    await expect(operator.apply(withdrawnApproval)).rejects.toMatchObject({ status: 409 });
    const expiring = await candidate.enroll(); now += 300_000;
    expect(await operator.pending()).toEqual([]);
    await expect(candidate.enrollmentStatus(expiring.requestId)).rejects.toMatchObject({ status: 401 });
    const rebooted = await candidate.enroll(); await server.close();
    const next = await createSyncServer(config); cleanup.push(() => next.close());
    const nextInfo = await probeSyncServer(await next.listen(), { allowLoopbackHttp: true });
    const nextOperator = new DeviceAccess(nextInfo, operator.identity);
    await expect(nextOperator.apply(admin.approve(nextInfo, await nextOperator.accessStatus(), rebooted, rebooted.fingerprint))).rejects.toMatchObject({ status: 409 });
  });

  it('bounds pending requests and frees capacity after withdrawal', async () => {
    const { info, operator } = await setup(); const requests = [];
    for (let i = 0; i < 17; i++) {
      const identity = device(`queue-${i}`); cleanup.push(() => identity.destroy());
      const remote = new DeviceAccess(info, identity); requests.push(remote);
      if (i < 16) await remote.enroll();
    }
    expect(await operator.pending()).toHaveLength(16);
    await expect(requests[16].enroll()).rejects.toMatchObject({ status: 429 });
    const first = await requests[0].enroll(); await requests[0].withdraw(first.requestId);
    await expect(requests[16].enroll()).resolves.toHaveProperty('requestId');
    expect(await operator.pending()).toHaveLength(16);
  });

  it('retains confirmed access after a pre-rename failure and permits a safe retry', async () => {
    let fail = false;
    const { candidate, operator, admin, info } = await setup({ accessFault: stage => { if (fail && stage === 'beforeAccessRename') throw Error('Injected write failure'); } });
    const pending = await candidate.enroll(); const document = admin.approve(info, await operator.accessStatus(), pending, pending.fingerprint);
    fail = true; await expect(operator.apply(document)).rejects.toThrow();
    expect(await operator.accessStatus()).toMatchObject({ revision: 0 });
    await expect(candidate.list()).rejects.toMatchObject({ status: 401 });
    fail = false; const accepted = await operator.apply(document); admin.acceptStatus(info, accepted);
    await expect(candidate.list()).resolves.toEqual([]);
  });

  it('fails closed on an uncertain durable ACL change and validates the signed state after restart', async () => {
    let fail = false;
    const { config, directory, server, candidate, operator, admin, info } = await setup({ accessFault: stage => { if (fail && stage === 'afterAccessRename') throw Error('Injected fsync failure'); } });
    const pending = await candidate.enroll(); const document = admin.approve(info, await operator.accessStatus(), pending, pending.fingerprint);
    fail = true; await expect(operator.apply(document)).rejects.toThrow();
    await expect(operator.list()).rejects.toMatchObject({ status: 503 });
    await server.close(); fail = false;
    const next = await createSyncServer(config); cleanup.push(() => next.close());
    const nextInfo = await probeSyncServer(await next.listen(), { allowLoopbackHttp: true });
    expect(await new DeviceAccess(nextInfo, candidate.identity).list()).toEqual([]);
    await next.close(); const stored = JSON.parse(await readFile(join(directory, 'access.json'), 'utf8')); stored[0][3]++;
    await writeFile(join(directory, 'access.json'), JSON.stringify(stored));
    await expect(createSyncServer(config)).rejects.toThrow();
  });

  it('stores the private administration key and pinned roster only in the encrypted local checkpoint', async () => {
    const { directory, owner, admin, info, approve } = await setup(); await approve();
    const authority = new Authority('devices'); const client = new Client(owner, authority.publicKey, 'devices'); client.useMembership(authority.setMembers([owner]));
    const localDir = await mkdtemp(join(tmpdir(), 'shellherd-admin-state-')); cleanup.push(() => rm(localDir, { recursive: true, force: true }));
    const file = join(localDir, 'admin.enc'); const key = admin.exportState()[1];
    const local = await LocalState.create(file, 'public test passphrase', { client, authority, deviceData: { serverAdmin: admin.exportState() } }); cleanup.push(() => local.lock());
    expect(await readFile(file, 'utf8')).not.toContain(key);
    expect(await readFile(join(directory, 'access.json'), 'utf8')).not.toContain(key);
    const restored = await LocalState.unlock(file, 'public test passphrase', { context: 'devices' }); cleanup.push(() => restored.lock());
    const signer = ServerAdmin.restore(restored.deviceData.serverAdmin); cleanup.push(() => signer.destroy());
    expect(signer.publicKey).toBe(admin.publicKey);
    expect(() => signer.bootstrap(info, [[owner.id, owner.public[1], null]])).toThrow(); // Pin survived restart.
  });
});
