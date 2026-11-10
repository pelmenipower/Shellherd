// Self-contained functional demonstration with synthetic data and simulated consent.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { createAccount } from '../scripts/sync-prototype/account-auth.mjs';
import { AccountStore } from '../scripts/sync-prototype/account-transport.mjs';
import { probeSyncServer } from '../scripts/sync-prototype/http-common.mjs';
import { RendezvousPeer } from '../scripts/sync-prototype/rendezvous-client.mjs';
import { createDeviceIdentity } from '../scripts/sync-prototype/device-proof.mjs';
import { startServer, setEnrollment } from './main.mjs';
const directory = await mkdtemp(join(tmpdir(), 'shellherd-server-smoke-'));
const password = randomBytes(32).toString('hex'); const stores = []; const identities = []; const channels = []; let server;
try {
  const config = { account: await createAccount('smoke', password), serverId: randomBytes(32).toString('hex'), namespace: 'smoke' };
  await writeFile(join(directory, 'server.json'), JSON.stringify(config), { mode: 0o600 });
  server = await startServer({ dataDirectory: directory, port: 0 });
  const info = await probeSyncServer(`http://127.0.0.1:${server.server.address().port}/`, { allowLoopbackHttp: true });
  assert.deepEqual([info.authentication, info.deviceSessions], ['enrolled-device', true]);
  for (const name of ['synthetic-client', 'synthetic-target']) {
    const store = new AccountStore(info); const identity = createDeviceIdentity(); stores.push(store); identities.push(identity);
    await store.enroll(identity, { username: 'smoke', password, name, ephemeral: false }); await store.openSession(identity);
  }
  const alice = new RendezvousPeer(stores[0], identities[0]); const bob = new RendezvousPeer(stores[1], identities[1]);
  await alice.register('synthetic-client'); await bob.register('synthetic-target');
  const session = await alice.request(bob.identity.id, 'view');
  // Simulation: both fingerprints come directly from our local test identities.
  const a = alice.channel(session, bob.identity.id, 'view');
  const b = bob.channel(session, alice.identity.id, 'view'); channels.push(a, b);
  await b.accept();
  for (let round = 0; round < 6 && !(a.ready && b.ready); round++) { await a.receive(); await b.receive(); }
  assert.equal(a.ready, true); assert.equal(b.ready, true);
  await a.send({ signal: 'synthetic-offer' }); assert.deepEqual(await b.receive(), [{ signal: 'synthetic-offer' }]);
  await b.send({ signal: 'synthetic-answer' }); assert.deepEqual(await a.receive(), [{ signal: 'synthetic-answer' }]);
  await a.close(); assert.deepEqual(await bob.sessions(), []);
  const roster = await stores[0].devices(); assert.deepEqual(roster.map(d => d.name).sort(), ['synthetic-client', 'synthetic-target']);
  // Enrollment code: a device enrolls with the issuer's secret and no password, and the roster records the issuer.
  const secret = randomBytes(32).toString('hex'); await stores[0].invite(identities[0], { secret, object: null });
  const guest = new AccountStore(info); const guestIdentity = createDeviceIdentity(); stores.push(guest); identities.push(guestIdentity);
  assert.equal((await guest.enrollWithInvite(guestIdentity, { secret, name: 'synthetic-guest', ephemeral: false })).username, 'smoke');
  assert.equal((await stores[0].devices()).find(d => d.id === guestIdentity.id).enrolledBy, identities[0].id);
  await stores[0].revoke(identities[0], identities[1].id);
  assert.equal((await stores[0].devices()).find(d => d.id === identities[1].id).revokedAt !== null, true);
  await assert.rejects(() => stores[1].list(), error => error.status === 401);
  // Offline switch to invite-only, then restart: the password form is refused, an enrollment code still works.
  await server.close(); await setEnrollment(directory, 'invite-only'); server = await startServer({ dataDirectory: directory, port: 0 });
  const locked = await probeSyncServer(`http://127.0.0.1:${server.server.address().port}/`, { allowLoopbackHttp: true });
  assert.equal(locked.enrollment, 'invite-only');
  await assert.rejects(() => new AccountStore(locked).enroll(createDeviceIdentity(), { username: 'smoke', password, name: 'late-device', ephemeral: false }), error => error.status === 403);
  const again = new AccountStore(locked); stores.push(again); await again.openSession(identities[0]);
  const second = randomBytes(32).toString('hex'); await again.invite(identities[0], { secret: second, object: null });
  const late = new AccountStore(locked); stores.push(late); await late.enrollWithInvite(createDeviceIdentity(), { secret: second, name: 'late-guest', ephemeral: false });
  console.log('PASS: persisted roster, two enrolled devices, presence, simulated consent, encrypted bidirectional signaling, session closure, revocation, enrollment codes and the invite-only switch.');
} finally {
  for (const channel of channels) channel.dispose();
  for (const store of stores) await store.logout().catch(() => store.close());
  await server?.close(); await rm(directory, { recursive: true, force: true });
}
