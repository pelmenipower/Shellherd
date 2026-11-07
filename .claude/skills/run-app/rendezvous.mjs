// Rendezvous fake for the remote-view scene: the prototype password sync server with the rendezvous broker on loopback.
// Synthetic account `demo` / `synthetic-rendezvous-demo`; nothing here touches a real vault or server.
// The sync server insists on a 0700 data directory, so this fake does not run on Windows.
import { randomBytes } from 'node:crypto';
import { createAccount } from '../../../scripts/sync-prototype/account-auth.mjs';
import { createSyncServer } from '../../../scripts/sync-prototype/server.mjs';

export const RENDEZVOUS_USER = 'demo';
export const RENDEZVOUS_PASSWORD = 'synthetic-rendezvous-demo';

/** Starts the fake on 127.0.0.1; `port: 0` picks a free port. `dir` holds the server's private data. */
export async function startRendezvousFake({ port, dir }) {
  const account = await createAccount(RENDEZVOUS_USER, RENDEZVOUS_PASSWORD);
  const server = await createSyncServer({ directory: dir, serverId: randomBytes(32).toString('hex'), namespace: 'demo', account, rendezvous: true });
  const url = await server.listen(port);
  return { port: Number(new URL(url).port), url, close: () => server.close() };
}
