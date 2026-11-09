import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, webContents } from 'electron';
import type { DisplayMediaRequestHandlerHandlerRequest, Streams, WebFrameMain } from 'electron';
import { createPrivateKey, createPublicKey } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { windowRegistry } from '../windows';
import { IPC_CHANNELS } from '../../shared/ipc';
import { formatFingerprint } from '../../shared/remote-signal';
import { mainT } from '../i18n';
import { RemoteLabHost } from './lab-host';
import type { CapturePrompt, RemoteAccount, RemoteDeps, RemotePeer, RemoteServerInfo } from './lab-host';
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

export interface CaptureHost { grantedSession(webContentsId: number): string | null; isGranted(webContentsId: number, sessionId: string): boolean; requestCapture(webContentsId: number): Promise<string | null> }
type CaptureCallback = (streams: Streams) => void;

/** Display-media gate: native consent (once per session) in the main frame of its owner, then the primary screen. */
export function createDisplayMediaHandler(host: CaptureHost, options: { fake: boolean }): (request: DisplayMediaRequestHandlerHandlerRequest, callback: CaptureCallback) => void {
  return (request, callback) => {
    const reply = (streams: Streams): void => { try { callback(streams); } catch { /* frame destroyed meanwhile */ } };
    const frame: WebFrameMain | null = request.frame;
    const contents = frame ? webContents.fromFrame(frame) : undefined;
    if (!contents || request.frame !== contents.mainFrame || !request.videoRequested) return reply({});
    const run = async (): Promise<void> => {
      // Normally the permission request already ran the dialog; reaching this without it asks here, once per session.
      const id = host.grantedSession(contents.id) ?? await host.requestCapture(contents.id);
      if (id === null || options.fake) return reply({});
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      reply(sources[0] && host.isGranted(contents.id, id) ? { video: sources[0] } : {});
    };
    run().catch(() => reply({}));
  };
}

/** Native consent; the renderer cannot click it. Aborts with the session; 'unavailable' only when no dialog could be shown. */
export async function confirmCaptureDialog(owner: number, prompt: CapturePrompt, signal: AbortSignal): Promise<'accepted' | 'declined' | 'unavailable'> {
  try {
    const target = webContents.fromId(owner);
    const parent = target ? BrowserWindow.fromWebContents(target) : null;
    // Without a parent macOS would ignore the signal.
    if (!parent || parent.isDestroyed() || signal.aborted) return 'unavailable';
    const { response } = await dialog.showMessageBox(parent, {
      type: 'warning',
      title: mainT('dialogs.remoteConsent.title'),
      message: mainT('dialogs.remoteConsent.message', { name: prompt.name }),
      detail: mainT('dialogs.remoteConsent.detail', { fingerprint: formatFingerprint(prompt.fingerprint) }),
      buttons: [mainT('dialogs.remoteConsent.decline'), mainT('dialogs.remoteConsent.confirm')],
      defaultId: 0, cancelId: 0, noLink: true, signal,
    });
    return response === 1 && !signal.aborted ? 'accepted' : 'declined';
  } catch {
    return 'unavailable';
  }
}

/** Renderer did not stop its tracks in time: the process ends with them, then the window reloads. */
export function emergencyReload(owner: number): void {
  const wc = webContents.fromId(owner);
  if (wc && !wc.isDestroyed()) { wc.forcefullyCrashRenderer(); wc.reload(); }
}

/** Remote access has its own dev flag, independent of the sync lab; never in packaged builds. */
export function remoteLabRequested(env: NodeJS.ProcessEnv = process.env, packaged = app.isPackaged): boolean {
  return !packaged && env.SHELLHERD_REMOTE_LAB === '1';
}

/** Rendezvous scripts are loaded only in an explicitly enabled dev checkout; anything missing leaves the host without deps. */
export async function registerRemoteLabIpc(options: { isUnlocked(): boolean; matchesVaultPassword(password: string): Promise<boolean> }): Promise<RemoteLabHost> {
  let host = new RemoteLabHost();
  if (remoteLabRequested()) {
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
        matchesVaultPassword: options.matchesVaultPassword,
        confirmCapture: confirmCaptureDialog,
        emergency: emergencyReload,
      };
      host = new RemoteLabHost(deps);
    } catch { /* Absent scripts: feature stays unavailable. */ }
  }
  if (host.enabled) session.defaultSession.setDisplayMediaRequestHandler(createDisplayMediaHandler(host, { fake: process.env.SHELLHERD_REMOTE_CAPTURE_FAKE === '1' }));
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
