import { REMOTE_LAB_LIMITS } from '../../../shared/remote-lab';
import type { RemoteMediaAction, RemoteMediaApi, RemoteMediaEvent, RemoteMediaFailure, RemoteMediaReply, RemoteMediaRole } from '../../../shared/remote-media';
import { SignalCollector, checkSdp, splitSignal } from '../../../shared/remote-signal';

export interface PeerFactory { create(config: RTCConfiguration): RTCPeerConnection }
/** sourceId is only set on fallback path B (getUserMedia with chromeMediaSourceId). */
export interface CaptureSource { capture(sourceId?: string): Promise<MediaStream> }
export interface PeerTimers { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }
export type MediaPeerApi = Pick<RemoteMediaApi, 'action' | 'onEvent'>;
export interface MediaView { role?: RemoteMediaRole; peerName?: string; expiresAt?: number; stream?: MediaStream }

/** Lazily touches globals, so Node tests can import the module. */
export const browserPeers: PeerFactory = { create: config => new RTCPeerConnection(config) };
export const realCapture: CaptureSource = {
  capture: sourceId => sourceId === undefined
    ? navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
    : navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } } } as MediaStreamConstraints)
};

const defaultTimers: PeerTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/** One connection per media window; the main process owns session, consent and limits. */
export class MediaPeer {
  private current: MediaView = {};
  private readonly listeners = new Set<(view: MediaView) => void>();
  private readonly collector = new SignalCollector();
  private readonly unsubscribe: () => void;
  private pc?: RTCPeerConnection;
  private captured?: MediaStream;
  private offered = false;
  private accepted = false;
  private done = false;

  constructor(
    private readonly api: MediaPeerApi,
    private readonly peers: PeerFactory,
    private readonly source: CaptureSource,
    private readonly timers: PeerTimers = defaultTimers
  ) {
    this.unsubscribe = api.onEvent(event => this.onEvent(event));
  }

  get view(): MediaView { return this.current; }

  subscribe(listener: (view: MediaView) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => { this.listeners.delete(listener); };
  }

  /** Page hook for main (userGesture evaluation): true when a stream was captured. */
  async capture(sourceId?: string): Promise<boolean> {
    if (this.done || this.captured) return false;
    try {
      this.captured = await this.source.capture(sourceId);
      return true;
    } catch {
      return false;
    }
  }

  /** Stop button. */
  stop(): void { this.end({ kind: 'stop' }); }

  dispose(): void {
    this.unsubscribe();
    this.close();
    this.listeners.clear();
  }

  private onEvent(event: RemoteMediaEvent): void {
    if (this.done) return;
    if (event.kind === 'hello') this.update({ role: event.role, peerName: event.peerName, expiresAt: event.expiresAt });
    else if (event.kind === 'accepted') void this.offer();
    else void this.onSignal(event.part);
  }

  private async offer(): Promise<void> {
    if (this.accepted || this.current.role === 'viewer') return;
    this.accepted = true;
    const stream = this.captured;
    if (!stream) { this.end({ kind: 'failed', code: 'media' }); return; }
    try {
      const pc = this.peers.create({ iceServers: [] });
      this.pc = pc;
      pc.onconnectionstatechange = () => this.onConnectionState(pc);
      for (const track of stream.getTracks()) {
        track.onended = () => this.stop();
        pc.addTransceiver(track, { direction: 'sendonly', streams: [stream] });
      }
      await pc.setLocalDescription(await pc.createOffer());
      await this.gather(pc);
      if (this.pc !== pc) return;
      await this.sendDescription(pc, 'offer');
    } catch {
      this.fail('signal');
    }
  }

  private async onSignal(part: Parameters<SignalCollector['push']>[0]): Promise<void> {
    const role = this.current.role;
    if (!role) return;
    const wanted = role === 'agent' ? 'answer' : 'offer';
    try {
      if (part.kind !== wanted) throw new Error('signal');
      const message = this.collector.push(part);
      if (!message) return;
      checkSdp(message.data, wanted);
      if (role === 'agent') {
        if (!this.pc) throw new Error('signal');
        await this.pc.setRemoteDescription({ type: 'answer', sdp: message.data });
        return;
      }
      // Viewer takes exactly one complete offer; a second one fails the session.
      if (this.offered) throw new Error('signal');
      this.offered = true;
      await this.answer(message.data);
    } catch {
      this.fail('signal');
    }
  }

  private async answer(offer: string): Promise<void> {
    const pc = this.peers.create({ iceServers: [] });
    this.pc = pc;
    pc.onconnectionstatechange = () => this.onConnectionState(pc);
    pc.ontrack = event => {
      if (this.pc !== pc) return;
      this.update({ stream: event.streams[0] ?? new MediaStream([event.track]) });
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: offer });
    // View-only: never send media back. Set after SRD, so the offer's transceiver is the one that is changed.
    for (const transceiver of pc.getTransceivers()) transceiver.direction = 'recvonly';
    await pc.setLocalDescription(await pc.createAnswer());
    await this.gather(pc);
    if (this.pc !== pc) return;
    await this.sendDescription(pc, 'answer');
  }

  /** Checks the own description locally before anything leaves the page. */
  private async sendDescription(pc: RTCPeerConnection, kind: 'offer' | 'answer'): Promise<void> {
    const sdp = pc.localDescription?.sdp ?? '';
    checkSdp(sdp, kind);
    for (const part of splitSignal(kind, sdp)) {
      if (this.pc !== pc || this.done) return;
      const reply: RemoteMediaReply = await this.api.action({ kind: 'signal', part });
      if (!reply.ok) { this.fail('signal'); return; }
    }
  }

  private onConnectionState(pc: RTCPeerConnection): void {
    if (this.pc === pc && pc.connectionState === 'failed') this.fail('peer');
  }

  private fail(code: RemoteMediaFailure): void { this.end({ kind: 'failed', code }); }

  /** Reports once, then releases tracks and connection; main closes the window. */
  private end(action: RemoteMediaAction): void {
    if (this.done) return;
    this.close();
    void this.api.action(action).catch(() => undefined);
  }

  private close(): void {
    this.done = true;
    this.collector.reset();
    const stream = this.captured;
    this.captured = undefined;
    if (stream) for (const track of stream.getTracks()) track.stop();
    const pc = this.pc;
    this.pc = undefined;
    pc?.close();
    if (this.current.stream) this.update({ stream: undefined });
  }

  private update(patch: Partial<MediaView>): void {
    const next: MediaView = { ...this.current };
    for (const key of Object.keys(patch) as (keyof MediaView)[]) {
      if (patch[key] === undefined) delete next[key];
      else (next as Record<string, unknown>)[key] = patch[key];
    }
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  private gather(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
      const done = (): void => {
        this.timers.clearTimeout(handle);
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      };
      const onChange = (): void => { if (pc.iceGatheringState === 'complete') done(); };
      const handle = this.timers.setTimeout(done, REMOTE_LAB_LIMITS.gatherMs);
      pc.addEventListener('icegatheringstatechange', onChange);
    });
  }
}
