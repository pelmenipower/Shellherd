import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { MediaWindows, REMOTE_MEDIA_PARTITION, type MediaWindowFactory } from './media-window';
import { REMOTE_MEDIA_CAPTURE_SCRIPT } from '../../shared/remote-media';

let nextId = 10;
class FakeWc extends EventEmitter {
  id = nextId++;
  destroyedFlag = false;
  calls: string[] = [];
  sent: unknown[][] = [];
  js: (code: string, gesture: boolean) => Promise<unknown> = async () => true;
  executed: Array<[string, boolean]> = [];
  openHandler: unknown;
  setWindowOpenHandler(h: unknown): void { this.openHandler = h; }
  isDestroyed(): boolean { return this.destroyedFlag; }
  send(...a: unknown[]): void { this.sent.push(a); }
  executeJavaScript(code: string, gesture: boolean): Promise<unknown> { this.executed.push([code, gesture]); return this.js(code, gesture); }
  forcefullyCrashRenderer(): void { this.calls.push('crash'); }
}
class FakeWin extends EventEmitter {
  webContents = new FakeWc();
  destroyedFlag = false;
  calls: string[] = [];
  removeMenu(): void { this.calls.push('removeMenu'); }
  setContentProtection(on: boolean): void { this.calls.push(`protect:${on}`); }
  show(): void { this.calls.push('show'); }
  isDestroyed(): boolean { return this.destroyedFlag; }
  destroy(): void {
    this.webContents.calls.push('destroy');
    this.destroyedFlag = true;
    this.webContents.destroyedFlag = true;
    this.webContents.emit('destroyed');
    this.emit('closed');
  }
}

function setup(over: Partial<MediaWindowFactory> = {}) {
  const wins: FakeWin[] = [];
  const options: Array<Record<string, any>> = [];
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const factory: MediaWindowFactory = {
    create: (o) => { const w = new FakeWin(); wins.push(w); options.push(o as any); return w as any; },
    load: async () => {},
    preload: '/p/remote-media.cjs',
    locale: () => 'de-DE',
    captureFake: false,
    title: (role, peer) => `${role}:${peer}`,
    background: () => '#000',
    icon: '/i.png',
    timers: {
      setTimeout: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; },
      clearTimeout: (h) => { (h as any).live = false; },
    },
    readyMs: 100,
    captureMs: 200,
    ...over,
  };
  const media = new MediaWindows(factory);
  const fire = (ms: number) => timers.filter((t) => t.live && t.ms === ms).forEach((t) => { t.live = false; t.fn(); });
  return { media, wins, options, timers, fire };
}
const agent = { role: 'agent', peerName: 'Anna' } as const;
const viewer = { role: 'viewer', peerName: 'Ben' } as const;

describe('MediaWindows', () => {
  it('open creates the window synchronously with the exact web preferences', () => {
    const { media, wins, options } = setup();
    const id = media.open(agent);
    expect(id).toBe(wins[0].webContents.id);
    expect(options[0].webPreferences).toEqual({
      preload: '/p/remote-media.cjs', partition: REMOTE_MEDIA_PARTITION, sandbox: true, contextIsolation: true,
      nodeIntegration: false, nodeIntegrationInSubFrames: false, webviewTag: false, devTools: false, spellcheck: false,
      backgroundThrottling: false,
      additionalArguments: ['--shellherd-locale=de-DE', '--shellherd-remote-capture-fake=0'],
    });
    expect(REMOTE_MEDIA_PARTITION).toBe('remote-media');
  });

  it('uses role specific window options', () => {
    const { media, options, wins } = setup({ captureFake: true });
    media.open(agent);
    expect(options[0]).toMatchObject({ width: 640, height: 360, show: false, paintWhenInitiallyHidden: true, skipTaskbar: true, focusable: false, title: 'agent:Anna', backgroundColor: '#000' });
    expect(options[0].webPreferences.additionalArguments[1]).toBe('--shellherd-remote-capture-fake=1');
    media.open(viewer);
    expect(options[1]).toMatchObject({ width: 1280, height: 800, minWidth: 480, minHeight: 320, show: false, autoHideMenuBar: true, title: 'viewer:Ben', backgroundColor: '#000', icon: '/i.png' });
    wins[1].emit('ready-to-show');
    expect(wins[1].calls).toContain('show');
    expect(wins[0].calls).not.toContain('show');
  });

  it('hardens every window', () => {
    const { media, wins } = setup();
    media.open(viewer);
    const w = wins[0];
    expect(w.calls).toEqual(expect.arrayContaining(['removeMenu', 'protect:true']));
    expect((w.webContents.openHandler as () => unknown)()).toEqual({ action: 'deny' });
    for (const [emitter, name] of [[w.webContents, 'will-navigate'], [w.webContents, 'will-attach-webview'], [w, 'page-title-updated']] as const) {
      const ev = { preventDefault: vi.fn() };
      emitter.emit(name, ev);
      expect(ev.preventDefault, name).toHaveBeenCalled();
    }
  });

  it('a second open destroys the first window', () => {
    const { media, wins } = setup();
    const a = media.open(agent);
    const b = media.open(viewer);
    expect(wins[0].destroyedFlag).toBe(true);
    expect(media.owns(a)).toBe(false);
    expect(media.owns(b)).toBe(true);
  });

  it('ready is true after did-finish-load', async () => {
    const { media, wins } = setup();
    const id = media.open(agent);
    const p = media.ready(id);
    wins[0].webContents.emit('did-finish-load');
    expect(await p).toBe(true);
    expect(await media.ready(id)).toBe(true);
  });

  it('ready is false after readyMs, did-fail-load, crash, close and for unknown ids', async () => {
    const t = setup();
    const id = t.media.open(agent);
    const p = t.media.ready(id);
    t.fire(100);
    expect(await p).toBe(false);

    const f = setup();
    const fid = f.media.open(agent);
    const fp = f.media.ready(fid);
    f.wins[0].webContents.emit('did-fail-load', {}, -2, 'x', 'u', true);
    expect(await fp).toBe(false);

    const c = setup();
    const cid = c.media.open(agent);
    const cp = c.media.ready(cid);
    c.wins[0].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(await cp).toBe(false);

    const cl = setup();
    const clid = cl.media.open(agent);
    const clp = cl.media.ready(clid);
    cl.wins[0].emit('closed');
    expect(await clp).toBe(false);

    expect(await t.media.ready(9999)).toBe(false);
  });

  it('ready is false when the load itself rejects', async () => {
    const { media } = setup({ load: () => Promise.reject(new Error('x')) });
    const id = media.open(agent);
    expect(await media.ready(id)).toBe(false);
  });

  it('capture runs the constant script with a user gesture and only accepts true', async () => {
    const { media, wins } = setup();
    const id = media.open(agent);
    wins[0].webContents.emit('did-finish-load');
    expect(await media.capture(id)).toBe(true);
    expect(wins[0].webContents.executed[0]).toEqual([REMOTE_MEDIA_CAPTURE_SCRIPT, true]);
    wins[0].webContents.js = async () => 'yes';
    expect(await media.capture(id)).toBe(false);
    wins[0].webContents.js = async () => 1;
    expect(await media.capture(id)).toBe(false);
    wins[0].webContents.js = async () => { throw new Error('x'); };
    expect(await media.capture(id)).toBe(false);
  });

  it('capture times out to false', async () => {
    const { media, wins, fire } = setup();
    const id = media.open(agent);
    wins[0].webContents.emit('did-finish-load');
    wins[0].webContents.js = () => new Promise(() => {});
    const p = media.capture(id);
    fire(200);
    expect(await p).toBe(false);
  });

  it('capture needs a loaded agent window', async () => {
    const { media, wins } = setup();
    const id = media.open(agent);
    expect(await media.capture(id)).toBe(false);
    expect(wins[0].webContents.executed).toEqual([]);
    const v = media.open(viewer);
    wins[1].webContents.emit('did-finish-load');
    expect(await media.capture(v)).toBe(false);
    expect(await media.capture(4242)).toBe(false);
  });

  it('path B validates the source id and passes it as JSON', async () => {
    const { media, wins } = setup();
    const id = media.open(agent);
    wins[0].webContents.emit('did-finish-load');
    expect(await media.capture(id, 'screen:0:0"); alert(1); ("')).toBe(false);
    expect(await media.capture(id, 'window:1:0')).toBe(false);
    expect(wins[0].webContents.executed).toEqual([]);
    expect(await media.capture(id, 'screen:1:0')).toBe(true);
    expect(wins[0].webContents.executed[0]).toEqual(['globalThis.shellherdRemoteMedia.capture("screen:1:0")', true]);
  });

  it('send delivers to live windows and ignores unknown ids', () => {
    const { media, wins } = setup();
    const id = media.open(agent);
    media.send(id, { kind: 'accepted' });
    media.send(777, { kind: 'accepted' });
    expect(wins[0].webContents.sent).toEqual([['remote-media:event', { kind: 'accepted' }]]);
    media.destroy(id);
    media.send(id, { kind: 'accepted' });
    expect(wins[0].webContents.sent).toHaveLength(1);
  });

  it('destroy crashes the renderer before destroy, is idempotent and does not call onGone', () => {
    const { media, wins } = setup();
    const gone = vi.fn();
    media.onGone(gone);
    const id = media.open(agent);
    media.destroy(id);
    media.destroy(id);
    expect(wins[0].webContents.calls).toEqual(['crash', 'destroy']);
    expect(gone).not.toHaveBeenCalled();
    expect(media.owns(id)).toBe(false);
  });

  it('onGone fires for close, crash and navigation after load, not for the first load', () => {
    const t = setup();
    const gone = vi.fn();
    t.media.onGone(gone);
    const a = t.media.open(agent);
    t.wins[0].webContents.emit('did-start-navigation', { isMainFrame: true });
    expect(gone).not.toHaveBeenCalled();
    t.wins[0].webContents.emit('did-finish-load');
    t.wins[0].webContents.emit('did-start-navigation', { isMainFrame: false });
    expect(gone).not.toHaveBeenCalled();
    t.wins[0].webContents.emit('did-start-navigation', { isMainFrame: true });
    expect(gone).toHaveBeenCalledWith(a, 'crashed');

    const b = t.media.open(viewer);
    t.wins[1].webContents.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(gone).toHaveBeenCalledWith(b, 'crashed');

    const c = t.media.open(viewer);
    t.wins[2].emit('closed');
    expect(gone).toHaveBeenCalledWith(c, 'closed');
  });

  it('reports a user close although Electron fires webContents destroyed before closed', () => {
    for (const input of [viewer, agent]) {
      const t = setup();
      const gone = vi.fn();
      t.media.onGone(gone);
      const id = t.media.open(input);
      const w = t.wins[0];
      w.webContents.destroyedFlag = true;
      w.webContents.emit('destroyed');
      w.emit('closed');
      expect(gone).toHaveBeenCalledWith(id, 'closed');
      expect(gone).toHaveBeenCalledTimes(1);
    }
  });

  it('onAlive and agentsAlive count live', () => {
    const { media, wins } = setup();
    const alive = vi.fn();
    media.onAlive(alive);
    const id = media.open(agent);
    expect(alive).toHaveBeenLastCalledWith(1);
    expect(media.agentsAlive()).toBe(1);
    media.open(viewer);
    expect(alive).toHaveBeenLastCalledWith(0);
    expect(wins[0].destroyedFlag).toBe(true);
    expect(media.agentsAlive()).toBe(0);
    expect(media.role(id)).toBeUndefined();
  });

  it('onDestroyed reports id and role, role is known while alive', () => {
    const { media } = setup();
    const done = vi.fn();
    media.onDestroyed(done);
    const id = media.open(viewer);
    expect(media.role(id)).toBe('viewer');
    media.destroyAll();
    expect(done).toHaveBeenCalledWith(id, 'viewer');
  });
});
