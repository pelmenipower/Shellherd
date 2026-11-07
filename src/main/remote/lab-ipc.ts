import { app, desktopCapturer, ipcMain, session, webContents } from 'electron';
import type { DisplayMediaRequestHandlerHandlerRequest, Streams, WebFrameMain } from 'electron';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { windowRegistry } from '../windows';
import { IPC_CHANNELS } from '../../shared/ipc';
import { RemoteLabHost } from './lab-host';
import type { RemoteAccount, RemoteDeps, RemotePeer, RemoteServerInfo } from './lab-host';
import { RemoteIdentityStore, safeStorageCipher } from './identity';
import type { RemoteIdentity } from './identity';
import { PresenceLoop } from './presence';
import type { PresenceTimers } from './presence';

// Resolved relative to the main bundle (out/main): app.getAppPath() points to the run dir under the run-app driver.
const script = (file: string): string => pathToFileURL(join(__dirname, '..', '..', 'scripts', 'sync-prototype', file)).href;

const timers: PresenceTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
  now: () => Date.now(),
};

type CaptureHost = Pick<RemoteLabHost, 'consumeCaptureGrant'>;
type CaptureCallback = (streams: Streams) => void;

/** Display-media gate: only a one-shot grant bound to the main frame of the owner window yields a screen source. */
export function createDisplayMediaHandler(host: CaptureHost): (request: DisplayMediaRequestHandlerHandlerRequest, callback: CaptureCallback) => void {
  return (request, callback) => {
    const reply = (streams: Streams): void => { try { callback(streams); } catch { /* frame destroyed meanwhile */ } };
    const frame: WebFrameMain | null = request.frame;
    const contents = frame ? webContents.fromFrame(frame) : undefined;
    if (!contents || request.frame !== contents.mainFrame || !request.videoRequested) return reply({});
    const sessionId = host.consumeCaptureGrant(contents.id);
    if (!sessionId) return reply({});
    desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
      .then(sources => sources[0] ? reply({ video: sources[0] }) : reply({}))
      .catch(() => reply({}));
  };
}

/** Rendezvous scripts are loaded only in an explicitly enabled dev checkout; anything missing leaves the host without deps. */
export async function registerRemoteLabIpc(options: { isUnlocked(): boolean }): Promise<RemoteLabHost> {
  let host = new RemoteLabHost();
  if (!app.isPackaged && process.env.SHELLHERD_SYNC_LAB === '1') {
    try {
      const transport = await import(/* @vite-ignore */ script('http-common.mjs')) as {
        probeSyncServer(url: string, options: { allowLoopbackHttp: boolean; signal: AbortSignal }): Promise<RemoteServerInfo>;
      };
      const accounts = await import(/* @vite-ignore */ script('account-transport.mjs')) as {
        AccountStore: new (info: RemoteServerInfo, options: { signal: AbortSignal }) => RemoteAccount;
      };
      const client = await import(/* @vite-ignore */ script('rendezvous-client.mjs')) as {
        createRendezvousIdentity(): RemoteIdentity;
        RendezvousPeer: new (store: RemoteAccount, identity: RemoteIdentity) => RemotePeer;
      };
      const rendezvous = await import(/* @vite-ignore */ script('rendezvous.mjs')) as { deviceId(publicKey: string): string };
      const store = new RemoteIdentityStore(join(app.getPath('userData'), 'remote-identity.json'), safeStorageCipher(),
        () => client.createRendezvousIdentity(),
        pkcs8 => {
          const privateKey = createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' });
          const publicKey = createPublicKey(privateKey).export({ format: 'der', type: 'spki' }).toString('base64');
          return { privateKey, publicKey, id: rendezvous.deviceId(publicKey) };
        });
      const deps: RemoteDeps = {
        probe: (serverUrl, signal) => transport.probeSyncServer(serverUrl, { allowLoopbackHttp: true, signal }),
        createAccount: (info, signal) => new accounts.AccountStore(info, { signal }),
        createPeer: (account, identity) => new client.RendezvousPeer(account, identity),
        identity: () => store,
        presence: (transportLike, name, handlers) => new PresenceLoop(transportLike, name, timers, handlers),
        timers,
        isUnlocked: options.isUnlocked,
      };
      host = new RemoteLabHost(deps);
    } catch { /* Absent scripts: feature stays unavailable. */ }
  }
  if (host.enabled) session.defaultSession.setDisplayMediaRequestHandler(createDisplayMediaHandler(host));
  ipcMain.handle(IPC_CHANNELS.remoteLabAction, (event, raw: unknown) => {
    windowRegistry.requireMain(event); // Includes main-frame ownership.
    return host.action(event.sender.id, raw);
  });
  host.onEvent((owner, event) => {
    const target = webContents.fromId(owner);
    if (target && !target.isDestroyed()) target.send(IPC_CHANNELS.remoteLabEvent, event);
  });
  return host;
}
