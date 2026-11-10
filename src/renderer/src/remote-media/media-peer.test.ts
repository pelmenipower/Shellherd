import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteMediaAction, RemoteMediaEvent, RemoteMediaReply } from '../../../shared/remote-media';
import { REMOTE_LAB_LIMITS } from '../../../shared/remote-lab';
import { splitSignal } from '../../../shared/remote-signal';
import { MediaPeer, realCapture, type CaptureSource, type MediaView, type PeerFactory } from './media-peer';

const FP = Array.from({ length: 32 }, () => 'ab').join(':');
const sdp = (extra = '', direction = 'a=sendonly'): string => `v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=fingerprint:sha-256 ${FP}\r\na=setup:actpass\r\n${direction}\r\n${extra}`;

class FakePc {
  config: RTCConfiguration;
  tracks: unknown[] = [];
  closed = false;
  iceGatheringState = 'new';
  connectionState = 'new';
  localDescription: { type: string; sdp: string } | null = null;
  remote: { type: string; sdp: string } | null = null;
  ontrack: ((e: unknown) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  listeners = new Map<string, () => void>();
  localSdp = sdp();
  localAnswerSdp = sdp('', 'a=recvonly');
  transceivers: { direction: string }[] = [];
  addTransceivers: { track: unknown; init: unknown }[] = [];
  constructor(config: RTCConfiguration) { this.config = config; }
  addTransceiver(track: unknown, init: unknown): void { this.tracks.push(track); this.addTransceivers.push({ track, init }); }
  getTransceivers(): { direction: string }[] { return this.transceivers; }
  addEventListener(name: string, fn: () => void): void { this.listeners.set(name, fn); }
  removeEventListener(name: string): void { this.listeners.delete(name); }
  async createOffer(): Promise<{ type: string; sdp: string }> { return { type: 'offer', sdp: this.localSdp }; }
  async createAnswer(): Promise<{ type: string; sdp: string }> { return { type: 'answer', sdp: this.localAnswerSdp }; }
  async setLocalDescription(d: { type: string; sdp: string }): Promise<void> { this.localDescription = d; }
  async setRemoteDescription(d: { type: string; sdp: string }): Promise<void> { this.remote = d; if (d.type === 'offer') this.transceivers.push({ direction: 'sendrecv' }); }
  close(): void { this.closed = true; }
  complete(): void { this.iceGatheringState = 'complete'; this.listeners.get('icegatheringstatechange')?.(); }
}

function track() { return { stopped: false, onended: null as (() => void) | null, stop() { this.stopped = true; } }; }
function streamOf(tracks: ReturnType<typeof track>[]): MediaStream {
  return { getTracks: () => tracks } as unknown as MediaStream;
}

function setup(opts: { capture?: (sourceId?: string) => Promise<MediaStream>; reply?: RemoteMediaReply } = {}) {
  const actions: RemoteMediaAction[] = [];
  let listener: (e: RemoteMediaEvent) => void = () => {};
  const unsubscribe = vi.fn();
  const api = {
    action: vi.fn(async (r: RemoteMediaAction): Promise<RemoteMediaReply> => { actions.push(r); return opts.reply ?? { ok: true }; }),
    onEvent: (l: (e: RemoteMediaEvent) => void) => { listener = l; return unsubscribe; }
  };
  const pcs: FakePc[] = [];
  const peers: PeerFactory = { create: config => { const pc = new FakePc(config); pcs.push(pc); return pc as unknown as RTCPeerConnection; } };
  const tracks = [track()];
  const capture: CaptureSource = { capture: opts.capture ?? (async () => streamOf(tracks)) };
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  const peer = new MediaPeer(api, peers, capture, {
    setTimeout: (fn, ms) => { timers.set(next, { fn, ms }); return next++; },
    clearTimeout: h => { timers.delete(h as number); }
  });
  const views: MediaView[] = [];
  peer.subscribe(v => views.push(v));
  return { peer, api, actions, pcs, tracks, timers, views, unsubscribe, emit: (e: RemoteMediaEvent) => listener(e) };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const hello = (role: 'agent' | 'viewer'): RemoteMediaEvent => ({ kind: 'hello', role, peerName: 'Laptop', expiresAt: 1000 });

const originalOffer = FakePc.prototype.createOffer;
afterEach(() => { vi.unstubAllGlobals(); FakePc.prototype.createOffer = originalOffer; });

describe('MediaPeer agent', () => {
  it('captures, then creates the offer exactly once after accepted', async () => {
    const t = setup();
    t.emit(hello('agent'));
    expect(await t.peer.capture()).toBe(true);
    expect(t.pcs).toHaveLength(0);
    t.emit({ kind: 'accepted' });
    t.emit({ kind: 'accepted' });
    await flush();
    t.pcs[0]!.complete();
    await flush();
    expect(t.pcs).toHaveLength(1);
    const pc = t.pcs[0]!;
    expect(pc.config).toEqual({ iceServers: [] });
    expect(pc.addTransceivers).toEqual([{ track: t.tracks[0], init: expect.objectContaining({ direction: 'sendonly' }) }]);
    expect(t.actions).toHaveLength(1);
    expect(t.actions[0]).toMatchObject({ kind: 'signal', part: { kind: 'offer', part: 1, of: 1 } });
  });

  it('checks the local offer before sending it', async () => {
    const t = setup();
    t.emit(hello('agent'));
    await t.peer.capture();
    const offer = sdp('', 'a=sendrecv');
    FakePc.prototype.createOffer = async () => ({ type: 'offer', sdp: offer });
    t.emit({ kind: 'accepted' });
    await flush();
    t.pcs[0]!.complete();
    await flush();
    expect(t.actions.filter(a => a.kind === 'signal')).toEqual([]);
    expect(t.actions).toEqual([{ kind: 'failed', code: 'signal' }]);
  });

  it('reports exactly one failed signal when the host rejects a signal part', async () => {
    const t = setup({ reply: { ok: false, code: 'stale' } as RemoteMediaReply });
    t.emit(hello('agent'));
    await t.peer.capture();
    t.emit({ kind: 'accepted' });
    await flush();
    t.pcs[0]!.complete();
    await flush();
    expect(t.actions.filter(a => a.kind === 'failed')).toEqual([{ kind: 'failed', code: 'signal' }]);
  });

  it('stops waiting for ICE gathering after gatherMs', async () => {
    const t = setup();
    t.emit(hello('agent'));
    await t.peer.capture();
    t.emit({ kind: 'accepted' });
    await flush();
    expect(t.actions).toEqual([]);
    const gather = [...t.timers.values()].find(x => x.ms === REMOTE_LAB_LIMITS.gatherMs);
    expect(gather).toBeDefined();
    gather!.fn();
    await flush();
    expect(t.actions[0]).toMatchObject({ kind: 'signal' });
  });

  it('applies the answer parts', async () => {
    const t = setup();
    t.emit(hello('agent'));
    await t.peer.capture();
    t.emit({ kind: 'accepted' });
    await flush();
    t.pcs[0]!.complete();
    await flush();
    for (const part of splitSignal('answer', sdp('', 'a=recvonly'))) t.emit({ kind: 'signal', part });
    await flush();
    expect(t.pcs[0]!.remote).toEqual({ type: 'answer', sdp: sdp('', 'a=recvonly') });
  });

  it('reports peer and cleans up when the connection fails', async () => {
    const t = setup();
    t.emit(hello('agent'));
    await t.peer.capture();
    t.emit({ kind: 'accepted' });
    await flush();
    t.pcs[0]!.complete();
    await flush();
    t.pcs[0]!.connectionState = 'failed';
    t.pcs[0]!.onconnectionstatechange?.();
    await flush();
    expect(t.actions.at(-1)).toEqual({ kind: 'failed', code: 'peer' });
    expect(t.tracks[0]!.stopped).toBe(true);
    expect(t.pcs[0]!.closed).toBe(true);
  });

  it('sends stop when the capture track ends', async () => {
    const t = setup();
    t.emit(hello('agent'));
    await t.peer.capture();
    t.emit({ kind: 'accepted' });
    await flush();
    t.tracks[0]!.onended?.();
    await flush();
    expect(t.actions.at(-1)).toEqual({ kind: 'stop' });
    expect(t.tracks[0]!.stopped).toBe(true);
    expect(t.pcs[0]!.closed).toBe(true);
  });

  it('capture resolves false when the capture is refused', async () => {
    const t = setup({ capture: () => Promise.reject(new Error('denied')) });
    t.emit(hello('agent'));
    expect(await t.peer.capture()).toBe(false);
    expect(t.actions).toEqual([]);
  });

  it('passes the source id of fallback path B to the capture source', async () => {
    const capture = vi.fn(async () => streamOf([track()]));
    const t = setup({ capture });
    expect(await t.peer.capture('screen:1:0')).toBe(true);
    expect(capture).toHaveBeenCalledWith('screen:1:0');
  });

  it('reports media when accepted arrives without a captured stream', async () => {
    const t = setup();
    t.emit(hello('agent'));
    t.emit({ kind: 'accepted' });
    await flush();
    expect(t.actions).toEqual([{ kind: 'failed', code: 'media' }]);
  });
});

describe('MediaPeer viewer', () => {
  it('answers an offer, exposes the stream and sets recvonly after the remote description', async () => {
    const t = setup();
    t.emit(hello('viewer'));
    for (const part of splitSignal('offer', sdp())) t.emit({ kind: 'signal', part });
    await flush();
    const pc = t.pcs[0]!;
    expect(pc.config).toEqual({ iceServers: [] });
    expect(pc.remote).toEqual({ type: 'offer', sdp: sdp() });
    expect(pc.transceivers).toEqual([{ direction: 'recvonly' }]);
    expect(pc.addTransceivers).toEqual([]);
    pc.complete();
    await flush();
    expect(t.actions.at(-1)).toMatchObject({ kind: 'signal', part: { kind: 'answer', part: 1, of: 1 } });
    const stream = { id: 'stream' } as unknown as MediaStream;
    pc.ontrack?.({ streams: [stream], track: {} });
    expect(t.peer.view.stream).toBe(stream);
    expect(t.peer.view).toMatchObject({ role: 'viewer', peerName: 'Laptop', expiresAt: 1000 });
  });

  it('fails with signal on a second complete message and creates no second connection', async () => {
    const t = setup();
    t.emit(hello('viewer'));
    for (const part of splitSignal('offer', sdp())) t.emit({ kind: 'signal', part });
    await flush();
    for (const part of splitSignal('offer', sdp())) t.emit({ kind: 'signal', part });
    await flush();
    expect(t.pcs).toHaveLength(1);
    expect(t.actions.at(-1)).toEqual({ kind: 'failed', code: 'signal' });
    expect(t.pcs[0]!.closed).toBe(true);
  });

  it('rejects an offer that is not sendonly', async () => {
    const t = setup();
    t.emit(hello('viewer'));
    for (const part of splitSignal('offer', sdp('', 'a=sendrecv'))) t.emit({ kind: 'signal', part });
    await flush();
    expect(t.actions).toEqual([{ kind: 'failed', code: 'signal' }]);
    expect(t.pcs).toHaveLength(0);
  });

  it('reports peer when the connection fails', async () => {
    const t = setup();
    t.emit(hello('viewer'));
    for (const part of splitSignal('offer', sdp())) t.emit({ kind: 'signal', part });
    await flush();
    t.pcs[0]!.connectionState = 'failed';
    t.pcs[0]!.onconnectionstatechange?.();
    await flush();
    expect(t.actions.at(-1)).toEqual({ kind: 'failed', code: 'peer' });
  });

  it('stop() sends stop and closes the connection', async () => {
    const t = setup();
    t.emit(hello('viewer'));
    for (const part of splitSignal('offer', sdp())) t.emit({ kind: 'signal', part });
    await flush();
    t.peer.stop();
    await flush();
    expect(t.actions.at(-1)).toEqual({ kind: 'stop' });
    expect(t.pcs[0]!.closed).toBe(true);
  });

  it('dispose unsubscribes and closes', async () => {
    const t = setup();
    t.peer.dispose();
    expect(t.unsubscribe).toHaveBeenCalled();
  });
});

describe('realCapture', () => {
  it('uses getDisplayMedia without a source id (path A)', async () => {
    const getDisplayMedia = vi.fn(async () => 'stream');
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia, getUserMedia: vi.fn() } });
    await realCapture.capture();
    expect(getDisplayMedia).toHaveBeenCalledWith({ video: true, audio: false });
  });

  it('uses getUserMedia with chromeMediaSourceId on path B', async () => {
    const getUserMedia = vi.fn(async () => 'stream');
    vi.stubGlobal('navigator', { mediaDevices: { getDisplayMedia: vi.fn(), getUserMedia } });
    await realCapture.capture('screen:1:0');
    expect(getUserMedia).toHaveBeenCalledWith({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: 'screen:1:0' } } });
  });
});
