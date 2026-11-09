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

const { createDisplayMediaHandler, confirmCaptureDialog, emergencyReload, remoteLabRequested } = await import('./lab-ipc');
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('display media gate', () => {
  const requestCapture = vi.fn();
  const captureArmed = vi.fn();
  const callback = vi.fn();
  const make = (fake = false) => createDisplayMediaHandler({ requestCapture, captureArmed }, { fake });
  beforeEach(() => {
    vi.clearAllMocks();
    fromFrame.mockReturnValue({ id: 7, mainFrame: frame });
    getSources.mockResolvedValue([{ id: 'screen:0' }]);
    captureArmed.mockReturnValue(true);
    requestCapture.mockResolvedValue('s1');
  });

  it('denies without a frame, for subframes and without video', () => {
    const handler = make();
    handler({ frame: null, videoRequested: true } as never, callback);
    fromFrame.mockReturnValue({ id: 7, mainFrame: {} });
    handler({ frame, videoRequested: true } as never, callback);
    fromFrame.mockReturnValue({ id: 7, mainFrame: frame });
    handler({ frame, videoRequested: false } as never, callback);
    expect(callback.mock.calls).toEqual([[{}], [{}], [{}]]);
    expect(requestCapture).not.toHaveBeenCalled();
  });

  it('denies without consent and does not read sources', async () => {
    requestCapture.mockResolvedValue(null);
    make()({ frame, videoRequested: true } as never, callback);
    await flush();
    expect(requestCapture).toHaveBeenCalledWith(7);
    expect(callback).toHaveBeenCalledWith({});
    expect(getSources).not.toHaveBeenCalled();
  });

  it('grants the first screen, video only', async () => {
    make()({ frame, videoRequested: true } as never, callback);
    await flush();
    expect(getSources).toHaveBeenCalledWith({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    expect(callback).toHaveBeenCalledWith({ video: { id: 'screen:0' } });
  });

  it('denies when the grant lapsed while sources were read', async () => {
    captureArmed.mockReturnValue(false);
    make()({ frame, videoRequested: true } as never, callback);
    await flush();
    expect(callback).toHaveBeenCalledWith({});
  });

  it('answers {} in fake mode after consent without sources', async () => {
    make(true)({ frame, videoRequested: true } as never, callback);
    await flush();
    expect(requestCapture).toHaveBeenCalled();
    expect(getSources).not.toHaveBeenCalled();
    expect(callback).toHaveBeenCalledWith({});
  });

  it('denies when no source exists or capture fails, and survives a throwing callback', async () => {
    const handler = make();
    getSources.mockResolvedValueOnce([]);
    handler({ frame, videoRequested: true } as never, callback);
    await flush();
    getSources.mockRejectedValueOnce(Error('x'));
    handler({ frame, videoRequested: true } as never, callback);
    await flush();
    requestCapture.mockRejectedValueOnce(Error('y'));
    handler({ frame, videoRequested: true } as never, callback);
    await flush();
    expect(callback.mock.calls).toEqual([[{}], [{}], [{}]]);
    callback.mockImplementation(() => { throw Error('destroyed'); });
    expect(() => handler({ frame: null, videoRequested: true } as never, callback)).not.toThrow();
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
    expect(await confirmCaptureDialog(3, prompt, signal)).toBe(true);
    const [win, options] = showMessageBox.mock.calls[0] as [unknown, Record<string, unknown>];
    expect(win).toBe(parent);
    expect(options).toMatchObject({ type: 'warning', defaultId: 0, cancelId: 0, noLink: true, signal });
    expect(options.buttons).toHaveLength(2);
    expect(options.detail).toContain('abcdef01 23456789 abcdef01 23456789');
    showMessageBox.mockResolvedValue({ response: 0 });
    expect(await confirmCaptureDialog(3, prompt, signal)).toBe(false);
  });

  it('does not show a dialog without a parent window or with an aborted signal', async () => {
    fromWebContents.mockReturnValue(null);
    expect(await confirmCaptureDialog(3, prompt, new AbortController().signal)).toBe(false);
    fromWebContents.mockReturnValue({ isDestroyed: () => true });
    expect(await confirmCaptureDialog(3, prompt, new AbortController().signal)).toBe(false);
    fromId.mockReturnValue(undefined);
    expect(await confirmCaptureDialog(3, prompt, new AbortController().signal)).toBe(false);
    fromId.mockReturnValue({ id: 3 });
    fromWebContents.mockReturnValue(parent);
    const abort = new AbortController();
    abort.abort();
    expect(await confirmCaptureDialog(3, prompt, abort.signal)).toBe(false);
    expect(showMessageBox).not.toHaveBeenCalled();
  });

  it('is false when aborted during the dialog or when the dialog throws', async () => {
    const abort = new AbortController();
    showMessageBox.mockImplementation(async () => { abort.abort(); return { response: 1 }; });
    expect(await confirmCaptureDialog(3, prompt, abort.signal)).toBe(false);
    showMessageBox.mockRejectedValue(Error('x'));
    expect(await confirmCaptureDialog(3, prompt, new AbortController().signal)).toBe(false);
  });

  it('reads showMessageBox at call time', async () => {
    const replaced = vi.fn().mockResolvedValue({ response: 1 });
    showMessageBox.mockImplementation(replaced);
    await confirmCaptureDialog(3, prompt, new AbortController().signal);
    expect(replaced).toHaveBeenCalled();
  });
});

describe('emergencyReload', () => {
  it('crashes the renderer before reloading', () => {
    const order: string[] = [];
    fromId.mockReturnValue({ isDestroyed: () => false, forcefullyCrashRenderer: () => order.push('crash'), reload: () => order.push('reload') });
    emergencyReload(3);
    expect(order).toEqual(['crash', 'reload']);
  });
  it('ignores destroyed or unknown contents', () => {
    const wc = { isDestroyed: () => true, forcefullyCrashRenderer: vi.fn(), reload: vi.fn() };
    fromId.mockReturnValue(wc);
    emergencyReload(3);
    fromId.mockReturnValue(undefined);
    emergencyReload(3);
    expect(wc.forcefullyCrashRenderer).not.toHaveBeenCalled();
    expect(wc.reload).not.toHaveBeenCalled();
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
