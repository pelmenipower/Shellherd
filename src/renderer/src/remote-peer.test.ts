import { describe, expect, it, vi } from 'vitest';
import type { RemoteLabEvent, RemoteLabReply, RemoteLabRequest, RemoteLabState } from '../../shared/remote-lab';
import { splitSignal } from '../../shared/remote-signal';
import { RemoteSessionController, type CaptureSource, type PeerFactory, type RemoteView } from './remote-peer';

const FP = Array.from({ length: 32 }, () => 'ab').join(':');
const sdp = (extra = ''): string => `v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=fingerprint:sha-256 ${FP}\r\n${extra}`;
const idle: RemoteLabState = { phase: 'online' };

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
  constructor(config: RTCConfiguration) { this.config = config; }
  addTrack(track: unknown): void { this.tracks.push(track); }
  addEventListener(name: string, fn: () => void): void { this.listeners.set(name, fn); }
  removeEventListener(name: string): void { this.listeners.delete(name); }
  async createOffer(): Promise<{ type: string; sdp: string }> { return { type: 'offer', sdp: this.localSdp }; }
  async createAnswer(): Promise<{ type: string; sdp: string }> { return { type: 'answer', sdp: this.localSdp }; }
  async setLocalDescription(d: { type: string; sdp: string }): Promise<void> { this.localDescription = d; }
  async setRemoteDescription(d: { type: string; sdp: string }): Promise<void> { this.remote = d; }
  close(): void { this.closed = true; }
  complete(): void { this.iceGatheringState = 'complete'; this.listeners.get('icegatheringstatechange')?.(); }
}

function track() { return { stopped: false, onended: null as (() => void) | null, stop() { this.stopped = true; } }; }
function streamOf(tracks: ReturnType<typeof track>[]): MediaStream {
  return { getTracks: () => tracks } as unknown as MediaStream;
}

function setup(opts: { reply?: (r: RemoteLabRequest) => RemoteLabReply; capture?: () => Promise<MediaStream> } = {}) {
  const log: string[] = [];
  const requests: RemoteLabRequest[] = [];
  let listener: (e: RemoteLabEvent) => void = () => {};
  const unsubscribe = vi.fn();
  const api = {
    remoteLabAction: vi.fn(async (r: RemoteLabRequest): Promise<RemoteLabReply> => {
      log.push(r.kind);
      requests.push(r);
      return opts.reply ? opts.reply(r) : { ok: true, state: idle };
    }),
    onRemoteLabEvent: (l: (e: RemoteLabEvent) => void) => { listener = l; return unsubscribe; }
  };
  const pcs: FakePc[] = [];
  const peers: PeerFactory = { create: config => { const pc = new FakePc(config); pcs.push(pc); return pc as unknown as RTCPeerConnection; } };
  const tracks = [track()];
  const capture: CaptureSource = { capture: opts.capture ?? (async () => { log.push('capture'); return streamOf(tracks); }) };
  const timers = new Map<number, { fn: () => void; ms: number }>();
  let next = 1;
  const controller = new RemoteSessionController(api, 'c1', peers, capture, {
    setTimeout: (fn, ms) => { timers.set(next, { fn, ms }); return next++; },
    clearTimeout: h => { timers.delete(h as number); }
  });
  return { controller, api, log, requests, pcs, tracks, timers, emit: (e: RemoteLabEvent) => listener(e), unsubscribe };
}

const flush = async (): Promise<void> => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

describe('RemoteSessionController act', () => {
  it('adds the clientId, applies the state and clears the error', async () => {
    const t = setup({ reply: () => ({ ok: true, state: { phase: 'signedIn' } }) });
    const seen: unknown[] = [];
    t.controller.subscribe(v => seen.push(v));
    expect(seen).toHaveLength(1);
    await t.controller.act({ kind: 'connect', serverUrl: 'http://x' });
    expect(t.requests[0]).toEqual({ kind: 'connect', serverUrl: 'http://x', clientId: 'c1' });
    expect(t.controller.view.state.phase).toBe('signedIn');
    expect(t.controller.view.error).toBeUndefined();
  });

  it('records error codes and maps an IPC throw to connection', async () => {
    const t = setup({ reply: () => ({ ok: false, code: 'limit' }) });
    await t.controller.act({ kind: 'status' });
    expect(t.controller.view.error).toBe('limit');
    t.controller.clearError();
    expect(t.controller.view.error).toBeUndefined();
    t.api.remoteLabAction.mockRejectedValueOnce(new Error('x'));
    const reply = await t.controller.act({ kind: 'status' });
    expect(reply).toEqual({ ok: false, code: 'connection' });
    expect(t.controller.view.error).toBe('connection');
  });

  it('applies state and error events', () => {
    const t = setup();
    t.emit({ kind: 'state', state: { phase: 'signedIn' } });
    expect(t.controller.view.state.phase).toBe('signedIn');
    t.emit({ kind: 'error', code: 'authentication' });
    expect(t.controller.view.error).toBe('authentication');
  });
});

describe('RemoteSessionController share (agent)', () => {
  it('runs armCapture, capture, accept, then sends the offer parts', async () => {
    const t = setup();
    const done = t.controller.share('s1');
    await flush();
    t.pcs[0]!.complete();
    await done;
    expect(t.log).toEqual(['armCapture', 'capture', 'accept', 'signal']);
    const part = t.requests[2]!;
    expect(part).toMatchObject({ kind: 'signal', sessionId: 's1', part: { kind: 'offer', part: 1, of: 1 } });
    expect(t.pcs[0]!.config).toEqual({ iceServers: [] });
    expect(t.pcs[0]!.tracks).toEqual([t.tracks[0]]);
  });

  it('calls capture after exactly one awaited roundtrip', async () => {
    const t = setup({ capture: () => { t.log.push('capture'); return new Promise<MediaStream>(() => {}); } });
    void t.controller.share('s1');
    expect(t.log).toEqual(['armCapture']);
    // act wraps the IPC call; capture must run within a few microtasks of its reply, not after extra roundtrips.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(t.log).toEqual(['armCapture', 'capture']);
  });

  it('stops when armCapture is refused and never captures', async () => {
    const t = setup({ reply: () => ({ ok: false, code: 'stale' }) });
    await t.controller.share('s1');
    expect(t.log).toEqual(['armCapture']);
    expect(t.controller.view.error).toBe('stale');
  });

  it('declines with media when the capture fails', async () => {
    const t = setup({ capture: async () => { throw new Error('denied'); } });
    await t.controller.share('s1');
    expect(t.log).toEqual(['armCapture', 'decline']);
    expect(t.controller.view.error).toBe('media');
  });

  it('stops the tracks when accept fails', async () => {
    const t = setup({ reply: r => (r.kind === 'accept' ? { ok: false, code: 'expired' } : { ok: true, state: idle }) });
    await t.controller.share('s1');
    expect(t.tracks[0]!.stopped).toBe(true);
    expect(t.controller.view.error).toBe('expired');
    expect(t.pcs).toHaveLength(0);
  });

  it('sends the offer after the 2 s gathering timeout', async () => {
    const t = setup();
    const done = t.controller.share('s1');
    await flush();
    const gather = [...t.timers.values()].find(x => x.ms === 2000);
    expect(gather).toBeDefined();
    expect(t.log).not.toContain('signal');
    gather!.fn();
    await done;
    expect(t.log).toContain('signal');
  });

  it('reports signal and stops when the local SDP is invalid', async () => {
    const t = setup();
    const done = t.controller.share('s1');
    await flush();
    t.pcs[0]!.localSdp = 'v=0\r\n';
    t.pcs[0]!.localDescription = { type: 'offer', sdp: 'v=0\r\n' };
    t.pcs[0]!.complete();
    await done;
    await flush();
    expect(t.controller.view.error).toBe('signal');
    expect(t.log).toContain('stop');
    expect(t.pcs[0]!.closed).toBe(true);
    expect(t.tracks[0]!.stopped).toBe(true);
  });

  it('applies a complete answer as remote description', async () => {
    const t = setup();
    const done = t.controller.share('s1');
    await flush();
    t.pcs[0]!.complete();
    await done;
    for (const part of splitSignal('answer', sdp())) t.emit({ kind: 'signal', sessionId: 's1', part });
    await flush();
    expect(t.pcs[0]!.remote).toEqual({ type: 'answer', sdp: sdp() });
  });

  it('rejects an offer arriving at the agent with signal', async () => {
    const t = setup();
    const done = t.controller.share('s1');
    await flush();
    t.pcs[0]!.complete();
    await done;
    t.emit({ kind: 'signal', sessionId: 's1', part: splitSignal('offer', sdp())[0]! });
    await flush();
    expect(t.controller.view.error).toBe('signal');
    expect(t.log.at(-1)).toBe('stop');
  });

  it('reports peer and stops when the connection fails', async () => {
    const t = setup();
    const done = t.controller.share('s1');
    await flush();
    t.pcs[0]!.complete();
    await done;
    t.pcs[0]!.connectionState = 'failed';
    t.pcs[0]!.onconnectionstatechange?.();
    await flush();
    expect(t.controller.view.error).toBe('peer');
    expect(t.log.at(-1)).toBe('stop');
    expect(t.tracks[0]!.stopped).toBe(true);
    expect(t.pcs[0]!.closed).toBe(true);
  });
});

describe('RemoteSessionController viewer', () => {
  const viewerState: RemoteLabState = {
    phase: 'online',
    session: { id: 'v1', role: 'viewer', peer: { id: 'f'.repeat(64), name: 'x' }, scope: 'view', state: 'active', expiresAt: 1 }
  };

  it('answers an offer and exposes the stream', async () => {
    const t = setup();
    t.emit({ kind: 'state', state: viewerState });
    for (const part of splitSignal('offer', sdp())) t.emit({ kind: 'signal', sessionId: 'v1', part });
    await flush();
    const pc = t.pcs[0]!;
    expect(pc.config).toEqual({ iceServers: [] });
    expect(pc.remote).toEqual({ type: 'offer', sdp: sdp() });
    pc.complete();
    await flush();
    expect(t.requests.at(-1)).toMatchObject({ kind: 'signal', sessionId: 'v1', part: { kind: 'answer', part: 1, of: 1 } });
    const stream = { id: 'stream' } as unknown as MediaStream;
    pc.ontrack?.({ streams: [stream], track: {} });
    expect(t.controller.view.stream).toBe(stream);
  });

  it('flags a broken offer as signal', async () => {
    const t = setup();
    t.emit({ kind: 'state', state: viewerState });
    t.emit({ kind: 'signal', sessionId: 'v1', part: { kind: 'offer', part: 1, of: 1, data: 'v=0' } });
    await flush();
    expect(t.controller.view.error).toBe('signal');
    expect(t.log).toContain('stop');
  });

  it('rejects an answer arriving at the viewer', async () => {
    const t = setup();
    t.emit({ kind: 'state', state: viewerState });
    t.emit({ kind: 'signal', sessionId: 'v1', part: splitSignal('answer', sdp())[0]! });
    await flush();
    expect(t.controller.view.error).toBe('signal');
  });
});

describe('RemoteSessionController teardown', () => {
  it('closes everything on an ended event without sending stop', async () => {
    const t = setup();
    const done = t.controller.share('s1');
    await flush();
    t.pcs[0]!.complete();
    await done;
    t.log.length = 0;
    t.emit({ kind: 'ended', sessionId: 's1', reason: 'remote' });
    expect(t.log).toEqual([]);
    expect(t.pcs[0]!.closed).toBe(true);
    expect(t.tracks[0]!.stopped).toBe(true);
    expect(t.controller.view.ended).toBe('remote');
    expect(t.controller.view.stream).toBeUndefined();
  });

  it('stop closes locally first, then sends stop and sets stopped', async () => {
    const t = setup();
    const done = t.controller.share('s1');
    await flush();
    t.pcs[0]!.complete();
    await done;
    t.controller.stop();
    expect(t.pcs[0]!.closed).toBe(true);
    expect(t.tracks[0]!.stopped).toBe(true);
    expect(t.log.at(-1)).toBe('stop');
    expect(t.controller.view.ended).toBe('stopped');
  });

  it('stops the tracks when the user ends the capture', async () => {
    const t = setup();
    const done = t.controller.share('s1');
    await flush();
    t.pcs[0]!.complete();
    await done;
    t.tracks[0]!.onended?.();
    await flush();
    expect(t.log.at(-1)).toBe('stop');
  });

  it('dispose unsubscribes and closes locally', async () => {
    const t = setup();
    const done = t.controller.share('s1');
    await flush();
    t.pcs[0]!.complete();
    await done;
    t.controller.dispose();
    expect(t.unsubscribe).toHaveBeenCalled();
    expect(t.pcs[0]!.closed).toBe(true);
    expect(t.tracks[0]!.stopped).toBe(true);
  });
  it('dispose is final: a rebuilt controller (StrictMode remount) receives events and updates', async () => {
    let listener: (e: RemoteLabEvent) => void = () => {};
    const api = {
      remoteLabAction: vi.fn(async (): Promise<RemoteLabReply> => ({ ok: true, state: idle })),
      onRemoteLabEvent: (l: (e: RemoteLabEvent) => void) => { listener = l; return () => {}; }
    };
    const build = () => new RemoteSessionController(api, 'c', { create: () => { throw new Error('unused'); } }, { capture: async () => streamOf([]) });
    const first = build();
    first.dispose();
    const second = build();
    const seen: RemoteView[] = [];
    second.subscribe(v => seen.push(v));
    listener({ kind: 'state', state: { phase: 'signedIn' } });
    expect(seen.at(-1)?.state.phase).toBe('signedIn');
    await second.act({ kind: 'goOffline' });
    expect(seen.at(-1)?.state.phase).toBe('online');
    first.dispose();
  });

  it('dispose during capture stops the tracks and declines instead of accepting', async () => {
    let resolve: (s: MediaStream) => void = () => {};
    const t = setup({ capture: () => new Promise<MediaStream>(r => { resolve = r; }) });
    const done = t.controller.share('s1');
    await flush();
    t.controller.dispose();
    resolve(streamOf(t.tracks));
    await done;
    expect(t.tracks[0]!.stopped).toBe(true);
    expect(t.log).toContain('decline');
    expect(t.log).not.toContain('accept');
    expect(t.pcs).toHaveLength(0);
  });

  it('remembers the device name of the last successful goOnline', async () => {
    const t = setup();
    expect(t.controller.deviceName).toBeUndefined();
    await t.controller.act({ kind: 'goOnline', deviceName: 'Laptop' });
    expect(t.controller.deviceName).toBe('Laptop');
  });
});
