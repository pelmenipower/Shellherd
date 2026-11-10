import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeCapture } from './capture-fake';

const track = () => ({ stop: vi.fn(), addEventListener: vi.fn() });

function stubDom(getDisplayMedia: () => Promise<unknown>, getUserMedia: () => Promise<unknown> = () => Promise.reject(new Error('unused'))) {
  const canvasTrack = track();
  const fillRect = vi.fn();
  const canvas = { width: 0, height: 0, getContext: () => ({ fillRect, fillStyle: '' }), captureStream: () => ({ getTracks: () => [canvasTrack] }) };
  vi.stubGlobal('document', { createElement: () => canvas });
  vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn(getDisplayMedia), getUserMedia: vi.fn(getUserMedia) } });
  return { canvasTrack, canvas };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('fakeCapture', () => {
  it('calls getDisplayMedia first; a rejection yields the canvas stream', async () => {
    vi.useFakeTimers();
    const { canvasTrack, canvas } = stubDom(() => Promise.reject(new Error('denied')));
    const stream = await fakeCapture().capture();
    expect(navigator.mediaDevices.getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: false });
    expect(stream.getTracks()).toEqual([canvasTrack]);
    expect([canvas.width, canvas.height]).toEqual([640, 360]);
    canvasTrack.stop();
  });

  it('stops the tracks of a successful real capture and still returns the canvas stream', async () => {
    vi.useFakeTimers();
    const real = track();
    const { canvasTrack } = stubDom(async () => ({ getTracks: () => [real] }));
    const stream = await fakeCapture().capture();
    expect(real.stop).toHaveBeenCalledTimes(1);
    expect(stream.getTracks()).toEqual([canvasTrack]);
  });

  it('uses getUserMedia with the source id on path B', async () => {
    vi.useFakeTimers();
    const { canvasTrack } = stubDom(() => Promise.reject(new Error('unused')), () => Promise.reject(new Error('denied')));
    const stream = await fakeCapture().capture('screen:1:0');
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(navigator.mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
    expect(stream.getTracks()).toEqual([canvasTrack]);
  });
});
