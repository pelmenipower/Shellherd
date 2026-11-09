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
import { startServer } from './main.mjs';
const directory = await mkdtemp(join(tmpdir(), 'shellherd-server-smoke-'));
const password = randomBytes(32).toString('hex'); const stores = []; const channels = []; let server;
try {
  const config = { account: await createAccount('smoke', password), serverId: randomBytes(32).toString('hex'), namespace: 'smoke' };
  await writeFile(join(directory, 'server.json'), JSON.stringify(config), { mode: 0o600 });
  server = await startServer({ dataDirectory: directory, port: 0 });
  const info = await probeSyncServer(`http://127.0.0.1:${server.server.address().port}/`, { allowLoopbackHttp: true });
  for (let i = 0; i < 2; i++) { const store = new AccountStore(info); stores.push(store); await store.login('smoke', password); }
  const alice = new RendezvousPeer(stores[0]); const bob = new RendezvousPeer(stores[1]);
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
  console.log('PASS: persisted account, two logins, presence, simulated consent, encrypted bidirectional signaling and session closure.');
} finally {
  for (const channel of channels) channel.dispose();
  for (const store of stores) await store.logout().catch(() => store.close());
  await server?.close(); await rm(directory, { recursive: true, force: true });
}
