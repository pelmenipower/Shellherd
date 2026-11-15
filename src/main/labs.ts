import { join } from 'node:path';
import { app } from 'electron';
import { registerSyncLabIpc } from './sync-prototype/lab-ipc';
import type { SyncLabHost } from './sync-prototype/lab-host';
import { registerRemoteLabIpc } from './remote/lab-ipc';
import type { RemoteLabHost } from './remote/lab-host';
import type { MediaWindows } from './remote/media-window';
import { RemoteIdentityStore, safeStorageCipher } from './remote/identity';
import type { VaultSessionManager, VaultSessionSnapshot } from './vault/session';

/** Lab wiring, imported dynamically so release builds (__SHELLHERD_LABS__ = false) leave it out. */
export async function registerLabs(options: { sessions: VaultSessionManager; onSynced: (s: VaultSessionSnapshot) => void; background: () => string }): Promise<{ sync: SyncLabHost; remote: RemoteLabHost; media?: MediaWindows }> {
  // One identity store (and file) for both labs; load() caches.
  const identity = new RemoteIdentityStore(join(app.getPath('userData'), 'remote-identity.json'), safeStorageCipher());
  const sync = await registerSyncLabIpc({ sessions: options.sessions, identity, onSynced: options.onSynced });
  const { host: remote, media } = await registerRemoteLabIpc({ isUnlocked: () => options.sessions.isUnlocked(), matchesVaultPassword: p => options.sessions.matchesPassword(p), identity, background: options.background });
  return { sync, remote, media };
}
