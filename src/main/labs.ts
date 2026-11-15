import { join } from 'node:path';
import { app } from 'electron';
import { registerSyncLabIpc } from './sync-prototype/lab-ipc';
import type { SyncLabHost } from './sync-prototype/lab-host';
import { registerRemoteLabIpc } from './remote/lab-ipc';
import type { RemoteLabHost } from './remote/lab-host';
import { RemoteIdentityStore, safeStorageCipher } from './remote/identity';
import type { VaultSessionManager, VaultSessionSnapshot } from './vault/session';

/** Lab wiring, imported dynamically so release builds (__SHELLHERD_LABS__ = false) leave it out. */
export async function registerLabs(options: { sessions: VaultSessionManager; onSynced: (s: VaultSessionSnapshot) => void }): Promise<{ sync: SyncLabHost; remote: RemoteLabHost }> {
  // One identity store (and file) for both labs; load() caches.
  const identity = new RemoteIdentityStore(join(app.getPath('userData'), 'remote-identity.json'), safeStorageCipher());
  const sync = await registerSyncLabIpc({ sessions: options.sessions, identity, onSynced: options.onSynced });
  const remote = await registerRemoteLabIpc({ isUnlocked: () => options.sessions.isUnlocked(), matchesVaultPassword: p => options.sessions.matchesPassword(p), identity });
  return { sync, remote };
}
