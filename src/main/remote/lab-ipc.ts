import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session, webContents } from 'electron';
import type { DisplayMediaRequestHandlerHandlerRequest, Session, Streams, WebFrameMain } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { windowRegistry } from '../windows';
import { IPC_CHANNELS } from '../../shared/ipc';
import { REMOTE_LAB_LIMITS } from '../../shared/remote-lab';
import { REMOTE_MEDIA_CHANNELS, type RemoteMediaReply } from '../../shared/remote-media';
import { formatFingerprint } from '../../shared/remote-signal';
import { brandIconPath } from '../brand';
import { mainT } from '../i18n';
import { localeStore } from '../locale';
import { decidePermission, registerPermissionHandlers } from '../permissions';
import type { PermissionDetails } from '../permissions';
import { MediaWindows, REMOTE_MEDIA_PARTITION } from './media-window';
import { RemoteLabHost } from './lab-host';
import type { CapturePrompt, RemoteAccount, RemoteDeps, RemotePeer, RemoteServerInfo } from './lab-host';
import type { RemoteIdentityStore } from './identity';
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

export type CaptureHost = Pick<RemoteLabHost, 'consumeCaptureGrant' | 'isCaptureSession'>;
type CaptureCallback = (streams: Streams) => void;

/** Display-media gate of the media session: the one-time grant is consumed here, then the primary screen. */
export function createDisplayMediaHandler(host: CaptureHost, options: { fake: boolean }): (request: DisplayMediaRequestHandlerHandlerRequest, callback: CaptureCallback) => void {
  return (request, callback) => {
    const reply = (streams: Streams): void => { try { callback(streams); } catch { /* frame destroyed meanwhile */ } };
    const frame: WebFrameMain | null = request.frame;
    const contents = frame ? webContents.fromFrame(frame) : undefined;
    if (!contents || request.frame !== contents.mainFrame || !request.videoRequested) return reply({});
    const run = async (): Promise<void> => {
      const id = host.consumeCaptureGrant(contents.id);
      if (id === null || options.fake) return reply({});
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      reply(sources[0] && host.isCaptureSession(contents.id, id) ? { video: sources[0] } : {});
    };
    run().catch(() => reply({}));
  };
}

/** Minimal views of the media windows and ipcMain, so the wiring is testable without Electron. */
export interface MediaWiring {
  owns(webContentsId: number): boolean;
  role(webContentsId: number): 'viewer' | 'agent' | undefined;
  onGone(listener: (id: number, reason: 'closed' | 'crashed') => void): unknown;
  onDestroyed(listener: () => void): unknown;
}
export interface MediaSessionLike extends Pick<Session, 'setSpellCheckerEnabled' | 'setDisplayMediaRequestHandler' | 'clearStorageData'> {
  setPermissionRequestHandler: Session['setPermissionRequestHandler'];
  setPermissionCheckHandler: Session['setPermissionCheckHandler'];
  setDevicePermissionHandler: Session['setDevicePermissionHandler'];
  on: Session['on'];
}

/** Handlers of the ephemeral media session (E3, E6, K12): no capture except the one-time grant of an agent window. */
export function wireMediaSession(host: RemoteLabHost, media: MediaWiring, mediaSession: MediaSessionLike, options: { fake: boolean }): void {
  registerPermissionHandlers(mediaSession as Session, {
    remoteLabEnabled: true,
    captureGranted: id => media.role(id) === 'agent' && host.grantedSession(id) !== null,
  });
  // The check (not the request) also passes while the captured session runs: Chromium re-checks the permission
  // during capture, after the one-time grant was consumed. Request and display handlers stay strictly one-shot.
  const checkCtx = { remoteLabEnabled: true, captureGranted: (id: number): boolean => media.role(id) === 'agent' && (host.grantedSession(id) !== null || host.isCaptureSession(id) === true) };
  mediaSession.setPermissionCheckHandler((wc, permission, _origin, details) =>
    decidePermission(permission, details as PermissionDetails, wc?.id ?? null, 'check', checkCtx));
  mediaSession.setDisplayMediaRequestHandler(createDisplayMediaHandler(host, options));
  mediaSession.setSpellCheckerEnabled(false);
  media.onGone((id, reason) => host.mediaGone(id, reason));
  media.onDestroyed(() => void mediaSession.clearStorageData().catch(() => undefined));
}

/** Only the main frame of a live media window may act; everything else is stale without reaching the host. */
export function handleMediaAction(host: Pick<RemoteLabHost, 'mediaAction'>, media: Pick<MediaWiring, 'owns'>, event: { sender: { id: number; mainFrame: unknown }; senderFrame?: unknown }, raw: unknown): Promise<RemoteMediaReply> | RemoteMediaReply {
  return event.senderFrame === event.sender.mainFrame && media.owns(event.sender.id)
    ? host.mediaAction(event.sender.id, raw)
    : { ok: false, code: 'stale' } satisfies RemoteMediaReply;
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

/** Remote access has its own dev flag, independent of the sync lab; never in packaged builds. */
export function remoteLabRequested(env: NodeJS.ProcessEnv = process.env, packaged = app.isPackaged): boolean {
  return !packaged && env.SHELLHERD_REMOTE_LAB === '1';
}

/** Rendezvous scripts are loaded only in an explicitly enabled dev checkout; anything missing leaves the host without deps. */
export async function registerRemoteLabIpc(options: { isUnlocked(): boolean; matchesVaultPassword(password: string): Promise<boolean>; identity: RemoteIdentityStore; background: () => string }): Promise<{ host: RemoteLabHost; media?: MediaWindows }> {
  const fake = process.env.SHELLHERD_REMOTE_CAPTURE_FAKE === '1';
  const createMedia = (): MediaWindows => new MediaWindows({
    create: windowOptions => new BrowserWindow(windowOptions),
    load: async window => {
      const url = process.env.ELECTRON_RENDERER_URL;
      if (url) await window.loadURL(`${url}/remote-media.html`);
      else await window.loadFile(join(__dirname, '../renderer/remote-media.html'));
    },
    preload: join(__dirname, '../preload/remote-media.cjs'),
    title: (role, name) => role === 'viewer' ? mainT('window.remoteViewer', { name }) : mainT('window.remoteAgent'),
    locale: () => localeStore.get().effective,
    captureFake: fake,
    background: options.background,
    icon: brandIconPath(),
    timers,
    readyMs: REMOTE_LAB_LIMITS.mediaReadyMs,
    captureMs: REMOTE_LAB_LIMITS.captureMs,
  });
  let host = new RemoteLabHost();
  let media: MediaWindows | undefined;
  if (remoteLabRequested()) {
    try {
      media = createMedia();
      const transport = await import(/* @vite-ignore */ script('http-common.mjs')) as {
        probeSyncServer(url: string, options: { allowLoopbackHttp: boolean; allowPrivateHttp: boolean; signal: AbortSignal }): Promise<RemoteServerInfo>;
      };
      const accounts = await import(/* @vite-ignore */ script('account-transport.mjs')) as {
        AccountStore: new (info: RemoteServerInfo, options: { signal: AbortSignal }) => RemoteAccount;
      };
      const client = await import(/* @vite-ignore */ script('rendezvous-client.mjs')) as {
        RendezvousPeer: new (store: RemoteAccount, identity: RemoteIdentity) => RemotePeer;
      };
      const deps: RemoteDeps = {
        probe: (serverUrl, allowPrivateHttp, signal) => transport.probeSyncServer(serverUrl, { allowLoopbackHttp: true, allowPrivateHttp, signal }),
        createAccount: (info, signal) => new accounts.AccountStore(info, { signal }),
        createPeer: (account, identity) => new client.RendezvousPeer(account, identity),
        identity: () => options.identity,
        presence: (transportLike, name, handlers) => new PresenceLoop(transportLike, name, timers, handlers),
        timers,
        isUnlocked: options.isUnlocked,
        matchesVaultPassword: options.matchesVaultPassword,
        confirmCapture: confirmCaptureDialog,
        media,
      };
      host = new RemoteLabHost(deps);
    } catch { /* Absent scripts: feature stays unavailable. */ }
  }
  if (host.enabled && media) {
    const windows = media;
    wireMediaSession(host, windows, session.fromPartition(REMOTE_MEDIA_PARTITION), { fake });
    app.on('will-quit', () => windows.destroyAll());
    ipcMain.handle(REMOTE_MEDIA_CHANNELS.action, (event, raw: unknown) => handleMediaAction(host, windows, event, raw));
  }
  ipcMain.handle(IPC_CHANNELS.remoteLabAction, (event, raw: unknown) => {
    windowRegistry.requireMain(event); // Includes main-frame ownership.
    return host.action(event.sender.id, raw);
  });
  host.onEvent((owner, event) => {
    const target = webContents.fromId(owner);
    if (target && !target.isDestroyed()) target.send(IPC_CHANNELS.remoteLabEvent, event);
  });
  return host.enabled && media ? { host, media } : { host };
}
