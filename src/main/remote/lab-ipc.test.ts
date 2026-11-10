import { beforeEach, describe, expect, it, vi } from 'vitest';

const frame = { id: 'main' };
const fromFrame = vi.fn();
const fromId = vi.fn();
const fromWebContents = vi.fn();
const getSources = vi.fn();
const showMessageBox = vi.fn();
vi.mock('electron', () => ({
  app: {}, ipcMain: {}, session: {}, safeStorage: {},
  webContents: { fromFrame: (f: unknown) => fromFrame(f), fromId: (id: number) => fromId(id) },
  BrowserWindow: { fromWebContents: (c: unknown) => fromWebContents(c) },
  desktopCapturer: { getSources: (o: unknown) => getSources(o) },
  dialog: { get showMessageBox() { return showMessageBox; } },
}));
vi.mock('../windows', () => ({ windowRegistry: {} }));

const { createDisplayMediaHandler, confirmCaptureDialog, handleMediaAction, remoteLabRequested, wireMediaSession } = await import('./lab-ipc');
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('display media gate', () => {
  const consumeCaptureGrant = vi.fn();
  const isCaptureSession = vi.fn();
  const callback = vi.fn();
  const make = (fake = false) => createDisplayMediaHandler({ consumeCaptureGrant, isCaptureSession }, { fake });
  const request = { frame, videoRequested: true } as never;
  beforeEach(() => {
    vi.clearAllMocks();
    fromFrame.mockReturnValue({ id: 7, mainFrame: frame });
    getSources.mockResolvedValue([{ id: 'screen:0' }]);
    consumeCaptureGrant.mockReturnValue('s1');
    isCaptureSession.mockReturnValue(true);
  });

  it('denies without a frame, for subframes and without video, without consuming the grant', () => {
    const handler = make();
    handler({ frame: null, videoRequested: true } as never, callback);
    fromFrame.mockReturnValue({ id: 7, mainFrame: {} });
    handler(request, callback);
    fromFrame.mockReturnValue({ id: 7, mainFrame: frame });
    handler({ frame, videoRequested: false } as never, callback);
    expect(callback.mock.calls).toEqual([[{}], [{}], [{}]]);
    expect(consumeCaptureGrant).not.toHaveBeenCalled();
  });

  it('consumes the grant exactly once: the second call answers {}', async () => {
    consumeCaptureGrant.mockReturnValueOnce('s1').mockReturnValue(null);
    const handler = make();
    handler(request, callback);
    await flush();
    handler(request, callback);
    await flush();
    expect(consumeCaptureGrant).toHaveBeenCalledWith(7);
    expect(getSources).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls).toEqual([[{ video: { id: 'screen:0' } }], [{}]]);
  });

  it('grants the first screen, video only', async () => {
    make()(request, callback);
    await flush();
    expect(getSources).toHaveBeenCalledWith({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    expect(callback).toHaveBeenCalledWith({ video: { id: 'screen:0' } });
  });

  it('denies without a grant and does not read sources', async () => {
    consumeCaptureGrant.mockReturnValue(null);
    make()(request, callback);
    await flush();
    expect(callback).toHaveBeenCalledWith({});
    expect(getSources).not.toHaveBeenCalled();
  });

  it('checks the capture session after reading sources', async () => {
    isCaptureSession.mockReturnValue(false);
    make()(request, callback);
    await flush();
    expect(isCaptureSession).toHaveBeenCalledWith(7, 's1');
    expect(callback).toHaveBeenCalledWith({});
  });

  it('answers {} in fake mode after consuming the grant, without sources', async () => {
    make(true)(request, callback);
    await flush();
    expect(consumeCaptureGrant).toHaveBeenCalled();
    expect(getSources).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith({});
  });

  it('denies when no source exists or capture fails, and survives a throwing callback', async () => {
    const handler = make();
    getSources.mockResolvedValueOnce([]);
    handler(request, callback);
    await flush();
    getSources.mockRejectedValueOnce(Error('x'));
    handler(request, callback);
    await flush();
    consumeCaptureGrant.mockImplementationOnce(() => { throw Error('y'); });
    handler(request, callback);
    await flush();
    expect(callback.mock.calls).toEqual([[{}], [{}], [{}]]);
    callback.mockImplementation(() => { throw Error('destroyed'); });
    expect(() => handler({ frame: null, videoRequested: true } as never, callback)).not.toThrow();
  });
});

describe('wireMediaSession', () => {
  const MEDIA = 11;
  const setup = (over: { agent?: boolean; granted?: string | null } = {}) => {
    const host = {
      grantedSession: vi.fn(() => (over.granted === undefined ? 's1' : over.granted)),
      mediaGone: vi.fn(), consumeCaptureGrant: vi.fn(), isCaptureSession: vi.fn(),
    };
    let gone: (id: number, r: 'closed' | 'crashed') => void = () => {};
    let destroyed: () => void = () => {};
    const media = {
      owns: (id: number) => id === MEDIA,
      role: (id: number) => (id === MEDIA ? (over.agent === false ? 'viewer' as const : 'agent' as const) : undefined),
      onGone: (l: typeof gone) => { gone = l; },
      onDestroyed: (l: () => void) => { destroyed = l; },
    };
    const ses = {
      on: vi.fn(), setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
      setDisplayMediaRequestHandler: vi.fn(), setSpellCheckerEnabled: vi.fn(),
      clearStorageData: vi.fn().mockResolvedValue(undefined),
    };
    wireMediaSession(host as never, media as never, ses as never, { fake: false });
    return { host, ses, gone: (id: number, r: 'closed' | 'crashed') => gone(id, r), destroyed: () => destroyed() };
  };

  it('has permission and display handlers, and spellcheck is off (K12)', () => {
    const { ses } = setup();
    expect(ses.setPermissionRequestHandler).toHaveBeenCalledTimes(1);
    expect(ses.setPermissionCheckHandler).toHaveBeenCalled(); // replaced by the check handler of wireMediaSession
    expect(ses.setDisplayMediaRequestHandler).toHaveBeenCalledTimes(1);
    expect(ses.setSpellCheckerEnabled).toHaveBeenCalledWith(false);
  });

  it('allows capture only for an agent window with an unconsumed grant, never opening a dialog', () => {
    const d = { isMainFrame: true, mediaTypes: [] };
    const allowed = (s: ReturnType<typeof setup>, id: number): boolean => {
      const cb = vi.fn();
      s.ses.setPermissionRequestHandler.mock.calls[0][0]({ id }, 'media', cb, d);
      return cb.mock.calls[0][0] as boolean;
    };
    expect(allowed(setup(), MEDIA)).toBe(true);
    expect(allowed(setup(), 99)).toBe(false);
    expect(allowed(setup({ agent: false }), MEDIA)).toBe(false);
    expect(allowed(setup({ granted: null }), MEDIA)).toBe(false);
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('the check handler also passes during the running captured session; request stays one-shot', () => {
    const d = { isMainFrame: true, mediaType: 'video' };
    const s = setup({ granted: null });
    const check = s.ses.setPermissionCheckHandler.mock.calls.at(-1)![0];
    expect(check({ id: MEDIA }, 'media', 'o', d)).toBe(false);
    s.host.isCaptureSession.mockImplementation((id: number) => id === MEDIA);
    expect(check({ id: MEDIA }, 'media', 'o', d)).toBe(true);
    expect(check({ id: MEDIA }, 'display-capture', 'o', d)).toBe(true);
    expect(check({ id: 99 }, 'media', 'o', d)).toBe(false);
    expect(check({ id: MEDIA }, 'media', 'o', { ...d, isMainFrame: false })).toBe(false);
    expect(check({ id: MEDIA }, 'geolocation', 'o', d)).toBe(false);
    const cb = vi.fn();
    s.ses.setPermissionRequestHandler.mock.calls[0][0]({ id: MEDIA }, 'media', cb, { isMainFrame: true, mediaTypes: [] });
    expect(cb).toHaveBeenCalledWith(false);
    const viewer = setup({ agent: false, granted: null });
    viewer.host.isCaptureSession.mockReturnValue(true);
    expect(viewer.ses.setPermissionCheckHandler.mock.calls.at(-1)![0]({ id: MEDIA }, 'media', 'o', d)).toBe(false);
  });

  it('forwards gone to the host and clears storage after every destroyed window (E6)', async () => {
    const s = setup();
    s.gone(MEDIA, 'crashed');
    expect(s.host.mediaGone).toHaveBeenCalledWith(MEDIA, 'crashed');
    s.destroyed();
    expect(s.ses.clearStorageData).toHaveBeenCalledTimes(1);
    s.ses.clearStorageData.mockRejectedValueOnce(new Error('x'));
    expect(() => s.destroyed()).not.toThrow();
    await flush();
  });
});

describe('remote-media:action', () => {
  const MEDIA = 11;
  const media = { owns: (id: number) => id === MEDIA };
  const mainFrame = { id: 'main' };
  const make = () => ({ mediaAction: vi.fn(async () => ({ ok: true as const })) });

  it('forwards the main frame of an owned media window to the host', async () => {
    const host = make();
    expect(await handleMediaAction(host, media, { sender: { id: MEDIA, mainFrame }, senderFrame: mainFrame }, { kind: 'stop' })).toEqual({ ok: true });
    expect(host.mediaAction).toHaveBeenCalledWith(MEDIA, { kind: 'stop' });
  });

  it('answers stale for the main window id, foreign contents and subframes without calling the host', () => {
    const host = make();
    expect(handleMediaAction(host, media, { sender: { id: 1, mainFrame }, senderFrame: mainFrame }, {})).toEqual({ ok: false, code: 'stale' });
    expect(handleMediaAction(host, media, { sender: { id: 99, mainFrame }, senderFrame: mainFrame }, {})).toEqual({ ok: false, code: 'stale' });
    expect(handleMediaAction(host, media, { sender: { id: MEDIA, mainFrame }, senderFrame: { id: 'sub' } }, {})).toEqual({ ok: false, code: 'stale' });
    expect(handleMediaAction(host, media, { sender: { id: MEDIA, mainFrame } }, {})).toEqual({ ok: false, code: 'stale' });
    expect(host.mediaAction).not.toHaveBeenCalled();
  });
});

describe('confirmCaptureDialog', () => {
  const fingerprint = 'abcdef0123456789'.repeat(4);
  const prompt = { name: 'Laptop', fingerprint, verified: true };
  const parent = { isDestroyed: () => false };
  beforeEach(() => {
    vi.clearAllMocks();
    fromId.mockReturnValue({ id: 3 });
    fromWebContents.mockReturnValue(parent);
    showMessageBox.mockResolvedValue({ response: 1 });
  });

  it('shows a modal warning with decline first and accepts only the second button', async () => {
    const signal = new AbortController().signal;
    expect(await confirmCaptureDialog(3, prompt, signal)).toBe('accepted');
    const [win, options] = showMessageBox.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(win).toBe(parent);
    expect(options).toMatchObject({ type: 'warning', defaultId: 0, cancelId: 0, noLink: true, signal });
    expect(options.buttons).toHaveLength(2);
    expect(options.detail).toContain('abcdef01 23456789 abcdef01 23456789');
    showMessageBox.mockResolvedValue({ response: 0 });
    expect(await confirmCaptureDialog(3, prompt, signal)).toBe('declined');
  });

  it('does not show a dialog without a parent window or with an aborted signal', async () => {
    fromWebContents.mockReturnValue(null);
    expect(await confirmCaptureDialog(3, prompt, new AbortController().signal)).toBe('unavailable');
    fromWebContents.mockReturnValue({ isDestroyed: () => true });
    expect(await confirmCaptureDialog(3, prompt, new AbortController().signal)).toBe('unavailable');
    fromId.mockReturnValue(undefined);
    expect(await confirmCaptureDialog(3, prompt, new AbortController().signal)).toBe('unavailable');
    fromId.mockReturnValue({ id: 3 });
    fromWebContents.mockReturnValue(parent);
    const abort = new AbortController();
    abort.abort();
    expect(await confirmCaptureDialog(3, prompt, abort.signal)).toBe('unavailable');
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('is false when aborted during the dialog or when the dialog throws', async () => {
    const abort = new AbortController();
    showMessageBox.mockImplementation(async () => { abort.abort(); return { response: 1 }; });
    expect(await confirmCaptureDialog(3, prompt, abort.signal)).toBe('declined');
    showMessageBox.mockRejectedValue(Error('x'));
    expect(await confirmCaptureDialog(3, prompt, new AbortController().signal)).toBe('unavailable');
  });

  it('reads showMessageBox at call time', async () => {
    const replaced = vi.fn().mockResolvedValue({ response: 1 });
    showMessageBox.mockImplementation(replaced);
    await confirmCaptureDialog(3, prompt, new AbortController().signal);
    expect(replaced).toHaveBeenCalled();
  });
});

describe('remote lab flag', () => {
  it('needs its own flag in an unpacked build', () => {
    expect(remoteLabRequested({ SHELLHERD_REMOTE_LAB: '1' }, false)).toBe(true);
  });
  it('is not enabled by the sync lab flag', () => {
    expect(remoteLabRequested({ SHELLHERD_SYNC_LAB: '1' }, false)).toBe(false);
  });
  it('stays off in a packaged build', () => {
    expect(remoteLabRequested({ SHELLHERD_REMOTE_LAB: '1' }, true)).toBe(false);
  });
});
