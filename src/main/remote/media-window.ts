import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron';
import {
  REMOTE_MEDIA_CAPTURE_SCRIPT,
  REMOTE_MEDIA_CHANNELS,
  REMOTE_MEDIA_FAKE_ARG,
  REMOTE_MEDIA_LOCALE_ARG,
  type RemoteMediaEvent,
  type RemoteMediaRole,
} from '../../shared/remote-media';
import type { Locale } from '../../shared/locale';

export const REMOTE_MEDIA_PARTITION = 'remote-media';
const SOURCE_ID = /^screen:[0-9]+:[0-9]+$/;

export interface MediaTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}
export interface MediaWindowFactory {
  create(options: BrowserWindowConstructorOptions): BrowserWindow;
  load(window: BrowserWindow): Promise<void>; // loadURL(dev server)/loadFile(out/renderer/remote-media.html)
  preload: string; // absolute path of out/preload/remote-media.cjs
  locale(): Locale;
  captureFake: boolean;
  title(role: RemoteMediaRole, peerName: string): string;
  background(): string;
  icon?: string;
  timers: MediaTimers;
  readyMs: number; // REMOTE_LAB_LIMITS.mediaReadyMs
  captureMs: number; // REMOTE_LAB_LIMITS.captureMs
}
/** What RemoteLabHost sees (Electron-free). */
export interface MediaPort {
  /** Creates the window synchronously; returns its webContents id. At most one window lives; older ones are destroyed first. */
  open(input: { role: RemoteMediaRole; peerName: string }): number;
  /** true after did-finish-load within readyMs; false on timeout, did-fail-load, crash, close or unknown id. Never rejects. */
  ready(id: number): Promise<boolean>;
  /** No-op for unknown or destroyed ids. */
  send(id: number, event: RemoteMediaEvent): void;
  /** true only if the page returned exactly `true` within captureMs. Never rejects. */
  capture(id: number, sourceId?: string): Promise<boolean>;
  /** Synchronous, idempotent: drops own listeners, forcefullyCrashRenderer, destroy. Never calls onGone. */
  destroy(id: number): void;
}

interface Entry {
  id: number;
  role: RemoteMediaRole;
  win: BrowserWindow;
  loaded: boolean;
  failed: boolean;
  ending: boolean; // destroy() ran or the webContents is gone
  goneFired: boolean;
  waiters: Array<(ok: boolean) => void>;
  detach: Array<() => void>;
}

export class MediaWindows implements MediaPort {
  readonly #factory: MediaWindowFactory;
  readonly #entries = new Map<number, Entry>();
  readonly #gone = new Set<(id: number, reason: 'closed' | 'crashed') => void>();
  readonly #alive = new Set<(agents: number) => void>();
  readonly #destroyed = new Set<(id: number, role: RemoteMediaRole) => void>();

  constructor(factory: MediaWindowFactory) {
    this.#factory = factory;
  }

  open(input: { role: RemoteMediaRole; peerName: string }): number {
    this.destroyAll();
    const f = this.#factory;
    const webPreferences = {
      preload: f.preload,
      partition: REMOTE_MEDIA_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      devTools: false,
      spellcheck: false,
      backgroundThrottling: false,
      additionalArguments: [`${REMOTE_MEDIA_LOCALE_ARG}${f.locale()}`, `${REMOTE_MEDIA_FAKE_ARG}${f.captureFake ? '1' : '0'}`],
    };
    const title = f.title(input.role, input.peerName);
    const options: BrowserWindowConstructorOptions =
      input.role === 'viewer'
        ? {
            width: 1280, height: 800, minWidth: 480, minHeight: 320, show: false, autoHideMenuBar: true,
            title, backgroundColor: f.background(), ...(f.icon ? { icon: f.icon } : {}), webPreferences,
          }
        : {
            width: 640, height: 360, show: false, paintWhenInitiallyHidden: true, skipTaskbar: true, focusable: false,
            title, backgroundColor: f.background(), webPreferences,
          };
    const win = f.create(options);
    const wc = win.webContents;
    const entry: Entry = {
      id: wc.id, role: input.role, win, loaded: false, failed: false, ending: false, goneFired: false, waiters: [], detach: [],
    };
    this.#entries.set(entry.id, entry);

    // Own listeners; all but the 'destroyed' hook are dropped by destroy().
    const on = (target: { on(e: string, l: (...a: any[]) => void): unknown; removeListener(e: string, l: (...a: any[]) => void): unknown }, ev: string, l: (...a: any[]) => void): void => {
      target.on(ev, l);
      entry.detach.push(() => target.removeListener(ev, l));
    };
    const winT = win as unknown as Parameters<typeof on>[0];
    const wcT = wc as unknown as Parameters<typeof on>[0];
    win.removeMenu();
    win.setContentProtection(true);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    on(wcT, 'will-navigate', (e: { preventDefault(): void }) => e.preventDefault());
    on(wcT, 'will-attach-webview', (e: { preventDefault(): void }) => e.preventDefault());
    on(winT, 'page-title-updated', (e: { preventDefault(): void }) => e.preventDefault());
    on(wcT, 'did-finish-load', () => {
      entry.loaded = true;
      this.#settle(entry, true);
    });
    on(wcT, 'did-fail-load', (_e: unknown, _code: unknown, _desc: unknown, _url: unknown, isMainFrame?: boolean) => {
      if (isMainFrame === false) return;
      entry.failed = true;
      this.#settle(entry, false);
    });
    on(wcT, 'did-start-navigation', (details: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
      if (entry.loaded && details?.isMainFrame && !details.isSameDocument) this.#fireGone(entry, 'crashed');
    });
    on(wcT, 'render-process-gone', () => {
      entry.failed = true;
      this.#settle(entry, false);
      this.#fireGone(entry, 'crashed');
    });
    on(winT, 'closed', () => {
      entry.failed = true;
      this.#settle(entry, false);
      this.#fireGone(entry, 'closed');
    });
    // Kept after destroy(): reports the real end of the webContents.
    (wcT as { on(e: string, l: () => void): unknown }).on('destroyed', () => {
      // Electron fires this before the window's 'closed'; without our destroy() it is a user close.
      this.#fireGone(entry, 'closed');
      entry.ending = true;
      entry.failed = true;
      this.#settle(entry, false);
      this.#entries.delete(entry.id);
      for (const l of [...this.#destroyed]) l(entry.id, entry.role);
      this.#emitAlive();
    });
    if (input.role === 'viewer') win.once('ready-to-show', () => win.show());

    f.load(win).catch(() => {
      if (entry.loaded || entry.ending) return;
      entry.failed = true;
      this.#settle(entry, false);
    });
    this.#emitAlive();
    return entry.id;
  }

  ready(id: number): Promise<boolean> {
    const entry = this.#entries.get(id);
    if (!entry || entry.ending || entry.failed) return Promise.resolve(false);
    if (entry.loaded) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timers = this.#factory.timers;
      const handle = timers.setTimeout(() => finish(false), this.#factory.readyMs);
      const finish = (ok: boolean): void => {
        timers.clearTimeout(handle);
        entry.waiters = entry.waiters.filter((w) => w !== finish);
        resolve(ok);
      };
      entry.waiters.push(finish);
    });
  }

  send(id: number, event: RemoteMediaEvent): void {
    const entry = this.#live(id);
    if (entry) entry.win.webContents.send(REMOTE_MEDIA_CHANNELS.event, event);
  }

  async capture(id: number, sourceId?: string): Promise<boolean> {
    const entry = this.#live(id);
    if (!entry || entry.role !== 'agent' || !entry.loaded) return false;
    let code = REMOTE_MEDIA_CAPTURE_SCRIPT;
    if (sourceId !== undefined) {
      if (!SOURCE_ID.test(sourceId)) return false;
      code = `globalThis.shellherdRemoteMedia.capture(${JSON.stringify(sourceId)})`;
    }
    const timers = this.#factory.timers;
    let handle: unknown;
    const timeout = new Promise<boolean>((resolve) => {
      handle = timers.setTimeout(() => resolve(false), this.#factory.captureMs);
    });
    try {
      const run = entry.win.webContents.executeJavaScript(code, true).then((v) => v === true, () => false);
      return await Promise.race([run, timeout]);
    } catch {
      return false;
    } finally {
      timers.clearTimeout(handle);
    }
  }

  destroy(id: number): void {
    const entry = this.#entries.get(id);
    if (!entry || entry.ending) return;
    entry.ending = true;
    entry.failed = true;
    for (const d of entry.detach.splice(0)) d();
    this.#settle(entry, false);
    const wc = entry.win.webContents;
    try {
      if (!wc.isDestroyed()) wc.forcefullyCrashRenderer();
    } catch {
      // best effort: the window is destroyed below either way
    }
    if (!entry.win.isDestroyed()) entry.win.destroy();
  }

  destroyAll(): void {
    for (const id of [...this.#entries.keys()]) this.destroy(id);
  }

  owns(webContentsId: number): boolean {
    return this.#live(webContentsId) !== undefined;
  }

  role(webContentsId: number): RemoteMediaRole | undefined {
    return this.#live(webContentsId)?.role;
  }

  agentsAlive(): number {
    let n = 0;
    for (const e of this.#entries.values()) if (e.role === 'agent' && !e.win.isDestroyed()) n++;
    return n;
  }

  onGone(listener: (id: number, reason: 'closed' | 'crashed') => void): () => void {
    this.#gone.add(listener);
    return () => this.#gone.delete(listener);
  }

  onAlive(listener: (agents: number) => void): () => void {
    this.#alive.add(listener);
    return () => this.#alive.delete(listener);
  }

  onDestroyed(listener: (id: number, role: RemoteMediaRole) => void): () => void {
    this.#destroyed.add(listener);
    return () => this.#destroyed.delete(listener);
  }

  #live(id: number): Entry | undefined {
    const e = this.#entries.get(id);
    return e && !e.ending && !e.win.isDestroyed() ? e : undefined;
  }

  #settle(entry: Entry, ok: boolean): void {
    for (const w of [...entry.waiters]) w(ok);
  }

  #fireGone(entry: Entry, reason: 'closed' | 'crashed'): void {
    if (entry.ending || entry.goneFired) return;
    entry.goneFired = true;
    for (const l of [...this.#gone]) l(entry.id, reason);
  }

  #emitAlive(): void {
    const n = this.agentsAlive();
    for (const l of [...this.#alive]) l(n);
  }
}
