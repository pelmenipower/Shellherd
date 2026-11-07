import { beforeEach, describe, expect, it, vi } from 'vitest';

const frame = { id: 'main' };
const fromFrame = vi.fn();
const getSources = vi.fn();
vi.mock('electron', () => ({
  app: {}, ipcMain: {}, session: {}, safeStorage: {},
  webContents: { fromFrame: (f: unknown) => fromFrame(f), fromId: () => undefined },
  desktopCapturer: { getSources: (o: unknown) => getSources(o) },
}));
vi.mock('../windows', () => ({ windowRegistry: {} }));

const { createDisplayMediaHandler, remoteLabRequested } = await import('./lab-ipc');
const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe('display media gate', () => {
  const consume = vi.fn();
  const callback = vi.fn();
  const handler = createDisplayMediaHandler({ consumeCaptureGrant: consume });
  beforeEach(() => {
    vi.clearAllMocks();
    fromFrame.mockReturnValue({ id: 7, mainFrame: frame });
    getSources.mockResolvedValue([{ id: 'screen:0' }]);
  });

  it('denies without a frame, for subframes and without video', () => {
    handler({ frame: null, videoRequested: true } as never, callback);
    fromFrame.mockReturnValue({ id: 7, mainFrame: {} });
    handler({ frame, videoRequested: true } as never, callback);
    fromFrame.mockReturnValue({ id: 7, mainFrame: frame });
    handler({ frame, videoRequested: false } as never, callback);
    expect(callback.mock.calls).toEqual([[{}], [{}], [{}]]);
    expect(consume).not.toHaveBeenCalled();
  });

  it('denies without a grant', () => {
    consume.mockReturnValue(null);
    handler({ frame, videoRequested: true } as never, callback);
    expect(consume).toHaveBeenCalledWith(7);
    expect(callback).toHaveBeenCalledWith({});
    expect(getSources).not.toHaveBeenCalled();
  });

  it('grants the first screen, video only', async () => {
    consume.mockReturnValue('s1');
    handler({ frame, videoRequested: true } as never, callback);
    await flush();
    expect(getSources).toHaveBeenCalledWith({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    expect(callback).toHaveBeenCalledWith({ video: { id: 'screen:0' } });
  });

  it('denies when no source exists or capture fails, and survives a throwing callback', async () => {
    consume.mockReturnValue('s1');
    getSources.mockResolvedValueOnce([]);
    handler({ frame, videoRequested: true } as never, callback);
    await flush();
    getSources.mockRejectedValueOnce(Error('x'));
    handler({ frame, videoRequested: true } as never, callback);
    await flush();
    expect(callback.mock.calls).toEqual([[{}], [{}]]);
    callback.mockImplementation(() => { throw Error('destroyed'); });
    expect(() => handler({ frame: null, videoRequested: true } as never, callback)).not.toThrow();
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
