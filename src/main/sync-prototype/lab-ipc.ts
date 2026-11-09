import { app, dialog, ipcMain } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { windowRegistry } from '../windows';
import { SyncLabHost } from './lab-host';
import type { AccountDriver } from './lab-host';
import { synchronizeVault, importSyncedVault, removeForeignObjects } from './vault-sync';
import type { VaultRemote } from './vault-sync';
import type { VaultSessionManager, VaultSessionSnapshot } from '../vault/session';
import { mainT } from '../i18n';
import { AppError } from '../../shared/errors';
import type { SyncLabState } from '../../shared/sync-lab';

/** Maps a locked vault to undefined (no check possible); other failures propagate and end sign-in as a connection error. */
export function vaultPasswordMatcher(sessions?: Pick<VaultSessionManager, 'matchesPassword'>): ((password: string) => Promise<boolean | undefined>) | undefined {
  if (!sessions) return undefined;
  return async password => {
    try { return await sessions.matchesPassword(password); }
    catch (e) { if (e instanceof AppError && e.code === 'core.vaultLocked') return undefined; throw e; }
  };
}

/** Account transport scripts are loaded only in an explicitly enabled dev checkout. */
export async function registerSyncLabIpc(options: { sessions?: VaultSessionManager; onSynced?: (snapshot: VaultSessionSnapshot) => void } = {}): Promise<SyncLabHost> {
  let host = new SyncLabHost();
  if (!app.isPackaged && process.env.SHELLHERD_SYNC_LAB === '1') {
    try {
      const transportUrl = pathToFileURL(join(app.getAppPath(), 'scripts/sync-prototype/http-common.mjs')).href;
      const transport = await import(/* @vite-ignore */ transportUrl) as { probeSyncServer(url: string, options: { allowLoopbackHttp: boolean; allowPrivateHttp: boolean; signal: AbortSignal }): Promise<NonNullable<SyncLabState['server']>> };
      const accountUrl = pathToFileURL(join(app.getAppPath(), 'scripts/sync-prototype/account-transport.mjs')).href;
      const account = await import(/* @vite-ignore */ accountUrl) as { AccountStore: new (info: NonNullable<SyncLabState['server']>, options: { signal: AbortSignal }) => AccountDriver };
      host = new SyncLabHost(() => ({ action: () => ({ ok: false, code: 'unavailable' }), close() {} }),
        (serverUrl, allowPrivateHttp, signal) => transport.probeSyncServer(serverUrl, { allowLoopbackHttp: true, allowPrivateHttp, signal }), undefined,
        (info, signal) => new account.AccountStore(info, { signal }),
        async (remote, info, signal, request) => {
          if (!options.sessions || !remote.get || !remote.put) throw Error('Sync unavailable');
          const transport: VaultRemote = { list: async () => await remote.list() as string[], get: (id: string) => remote.get!(id), put: (wire: string) => remote.put!(wire) };
          if (remote.remove) transport.remove = (id: string) => remote.remove!(id);
          if (request.kind === 'removeForeign') return { removedForeign: await removeForeignObjects(options.sessions, transport, info, request.ids, signal) };
          if (request.kind === 'importVault') return importSyncedVault(options.sessions, transport, info, request.password, signal, async () => {
            const parent = windowRegistry.main(); if (!parent || signal.aborted) return undefined;
            const result = await dialog.showSaveDialog(parent, { title: mainT('dialogs.vaultSave.title'), defaultPath: 'synced-vault.term', filters: [{ name: mainT('dialogs.vaultFilter'), extensions: ['term'] }] });
            return result.canceled ? undefined : result.filePath;
          });
          return synchronizeVault(options.sessions, transport, info, signal, request.kind === 'keepLocal' ? request.revision : undefined);
        }, vaultPasswordMatcher(options.sessions));
    } catch { /* Absent scripts: feature stays unavailable. */ }
  }
  ipcMain.handle('sync-lab:action', (event, request: unknown) => {
    windowRegistry.requireMain(event); // Includes main-frame ownership; no secondary/iframe calls.
    if (request && typeof request === 'object' && 'kind' in request && ['synchronize', 'keepLocal', 'importVault', 'removeForeign'].includes(String(request.kind))) {
      return host.performSync(event.sender.id, request).then(reply => {
        if (reply.ok && reply.vaultChanged) options.onSynced?.(reply.vaultChanged);
        return reply;
      });
    }
    if (request && typeof request === 'object' && 'kind' in request && request.kind === 'connect') return host.connect(event.sender.id, request);
    if (request && typeof request === 'object' && 'kind' in request && request.kind === 'signIn') return host.signIn(event.sender.id, request);
    if (request && typeof request === 'object' && 'kind' in request && ['requestAccess', 'refreshAccess'].includes(String(request.kind))) return host.authorize(event.sender.id, request);
    return host.request(event.sender.id, request);
  });
  return host;
}
