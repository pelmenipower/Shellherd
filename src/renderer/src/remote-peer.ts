import type { DesktopApi } from '../../shared/ipc';
import { REMOTE_LAB_LIMITS } from '../../shared/remote-lab';
import type { RemoteEndReason, RemoteErrorCode, RemoteLabCommand, RemoteLabEvent, RemoteLabReply, RemoteLabState, RemoteSignalPart } from '../../shared/remote-lab';
import { SignalCollector, checkSdp, isSignalPart, splitSignal } from '../../shared/remote-signal';

export interface RemoteView { state: RemoteLabState; stream?: MediaStream; error?: RemoteErrorCode; ended?: RemoteEndReason }
export interface PeerFactory { create(config: RTCConfiguration): RTCPeerConnection }
export interface CaptureSource { capture(): Promise<MediaStream> }
export interface ControllerTimers { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void }

/** Lazily touches globals, so Node tests can import the module. */
export const browserPeers: PeerFactory = { create: config => new RTCPeerConnection(config) };
export const displayCapture: CaptureSource = {
  capture: () => navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
};

const defaultTimers: ControllerTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/** Agent session whose share() started; one 'stopped' receipt per entry (K12). */
interface ShareEntry { stream?: MediaStream; capturing: boolean; ended: boolean }

interface Local {
  sessionId: string;
  role: 'agent' | 'viewer';
  pc?: RTCPeerConnection;
  stream?: MediaStream;
  collector: SignalCollector;
}

export class RemoteSessionController {
  private current: RemoteView = { state: { phase: 'idle' } };
  private readonly listeners = new Set<(view: RemoteView) => void>();
  private local: Local | null = null;
  private readonly shares = new Map<string, ShareEntry>();
  private readonly unsubscribe: () => void;
  private disposed = false;
  /** Device name of the last successful goOnline, so a reopened dialog can show it. */
  deviceName?: string;

  constructor(
    private readonly api: Pick<DesktopApi, 'remoteLabAction' | 'onRemoteLabEvent'>,
    private readonly clientId: string,
    private readonly peers: PeerFactory,
    private readonly capture: CaptureSource,
    private readonly timers: ControllerTimers = defaultTimers
  ) {
    this.unsubscribe = api.onRemoteLabEvent(event => this.onEvent(event));
  }

  get view(): RemoteView { return this.current; }

  subscribe(listener: (view: RemoteView) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => { this.listeners.delete(listener); };
  }

  async act(command: RemoteLabCommand): Promise<RemoteLabReply> {
    const reply = await this.send(command);
    if (reply.ok && command.kind === 'goOnline') this.deviceName = command.deviceName;
    if (reply.ok) this.update({ state: reply.state, error: undefined });
    else this.update({ error: reply.code });
    return reply;
  }

  async share(sessionId: string, verification: string | null): Promise<void> {
    const entry: ShareEntry = { capturing: true, ended: false };
    this.shares.set(sessionId, entry);
    // Exactly one await before capture(): the user activation must survive until getDisplayMedia.
    const armed = await this.act({ kind: 'armCapture', sessionId, verification });
    if (!armed.ok) { this.shares.delete(sessionId); return; }
    let stream: MediaStream | undefined;
    if (!entry.ended) {
      try {
        stream = await this.capture.capture();
      } catch {
        // No stream (e.g. declined in the native dialog): still acknowledge below.
      }
    }
    if (stream) entry.stream = stream;
    const stopStream = (): void => { if (stream) for (const track of stream.getTracks()) track.stop(); };
    if (!stream) {
      if (!entry.ended) {
        await this.act({ kind: 'decline', sessionId });
        this.update({ error: 'media' });
      }
      this.release(sessionId, entry);
      return;
    }
    if (entry.ended) { stopStream(); this.release(sessionId, entry); return; }
    if (this.disposed) { stopStream(); await this.act({ kind: 'decline', sessionId }); this.release(sessionId, entry); return; }
    const accepted = await this.act({ kind: 'accept', sessionId });
    if (!accepted.ok || this.disposed || entry.ended) { stopStream(); this.release(sessionId, entry); return; }
    const local: Local = { sessionId, role: 'agent', stream, collector: new SignalCollector() };
    this.closeLocal();
    this.local = local;
    entry.capturing = false;
    try {
      const pc = this.peers.create({ iceServers: [] });
      local.pc = pc;
      pc.onconnectionstatechange = () => this.onConnectionState(local);
      for (const track of stream.getTracks()) {
        track.onended = () => { if (this.local === local) this.stop(); };
        pc.addTrack(track, stream);
      }
      await pc.setLocalDescription(await pc.createOffer());
      await this.gather(pc);
      if (this.local !== local) return;
      await this.sendDescription(local, pc, 'offer');
    } catch {
      this.fail(local, 'signal');
    }
  }

  stop(): void {
    const sessionId = this.local?.sessionId ?? this.current.state.session?.id;
    this.closeLocal(false);
    this.update({ stream: undefined });
    if (sessionId) void this.stopRemote(sessionId).then(() => this.acknowledge(sessionId));
    this.update({ ended: 'stopped' });
  }

  clearError(): void { this.update({ error: undefined }); }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.closeLocal();
    this.listeners.clear();
  }

  private async send(command: RemoteLabCommand): Promise<RemoteLabReply> {
    try {
      return await this.api.remoteLabAction({ ...command, clientId: this.clientId });
    } catch {
      return { ok: false, code: 'connection' };
    }
  }

  /** Internal stop: applies the new state but keeps an already recorded error. */
  private async stopRemote(sessionId: string): Promise<void> {
    const reply = await this.send({ kind: 'stop', sessionId });
    if (reply.ok) this.update({ state: reply.state });
  }

  private update(patch: Partial<RemoteView>): void {
    if (this.disposed) return;
    const next: RemoteView = { ...this.current };
    for (const key of Object.keys(patch) as (keyof RemoteView)[]) {
      if (patch[key] === undefined) delete next[key];
      else (next as unknown as Record<string, unknown>)[key] = patch[key];
    }
    // A new request or session starts a fresh outcome.
    if ('error' in patch && patch.error !== undefined) delete next.ended;
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  /** Stops tracks and the connection, then (unless the caller sends stop first) acknowledges to the host. */
  private closeLocal(ack = true): void {
    const local = this.local;
    this.local = null;
    if (!local) return;
    local.collector.reset();
    if (local.stream) for (const track of local.stream.getTracks()) track.stop();
    local.pc?.close();
    if (this.current.stream) this.update({ stream: undefined });
    if (ack) this.acknowledge(local.sessionId);
  }

  /** Sends the single 'stopped' receipt; while capture() is pending the share() flow does it later. */
  private acknowledge(sessionId: string): void {
    const entry = this.shares.get(sessionId);
    if (!entry) return;
    if (entry.capturing) { entry.ended = true; return; }
    this.shares.delete(sessionId);
    void this.send({ kind: 'stopped', sessionId });
  }

  /** share() finished without handing the stream to a connection. */
  private release(sessionId: string, entry: ShareEntry): void {
    entry.capturing = false;
    this.acknowledge(sessionId);
  }

  private fail(local: Local, code: RemoteErrorCode): void {
    if (this.local !== local) return;
    this.update({ error: code });
    this.stop();
    // stop() marks the session as stopped; the error stays the headline.
    this.update({ ended: undefined });
  }

  private onConnectionState(local: Local): void {
    if (this.local === local && local.pc?.connectionState === 'failed') this.fail(local, 'peer');
  }

  private onEvent(event: RemoteLabEvent): void {
    if (this.disposed) return;
    if (event.kind === 'state') this.update({ state: event.state });
    else if (event.kind === 'error') this.update({ error: event.code });
    else if (event.kind === 'ended') {
      this.closeLocal();
      this.acknowledge(event.sessionId);
      this.update({ stream: undefined, ended: event.reason });
    } else void this.onSignal(event.sessionId, event.part);
  }

  private async onSignal(sessionId: string, part: RemoteSignalPart): Promise<void> {
    let local = this.local;
    const wanted = local ? (local.role === 'agent' ? 'answer' : 'offer') : 'offer';
    if (!local) {
      if (this.current.state.session?.role !== 'viewer') return;
      local = { sessionId, role: 'viewer', collector: new SignalCollector() };
      this.local = local;
    }
    if (local.sessionId !== sessionId) return;
    try {
      if (part.kind !== wanted) throw new Error('signal');
      const message = local.collector.push(part);
      if (!message) return;
      checkSdp(message.data, wanted);
      if (local.role === 'agent') {
        await local.pc?.setRemoteDescription({ type: 'answer', sdp: message.data });
        return;
      }
      await this.answer(local, message.data);
    } catch {
      this.fail(local, 'signal');
    }
  }

  private async answer(local: Local, offer: string): Promise<void> {
    const pc = this.peers.create({ iceServers: [] });
    local.pc = pc;
    pc.onconnectionstatechange = () => this.onConnectionState(local);
    pc.ontrack = event => {
      if (this.local !== local) return;
      this.update({ stream: event.streams[0] ?? new MediaStream([event.track]) });
    };
    await pc.setRemoteDescription({ type: 'offer', sdp: offer });
    await pc.setLocalDescription(await pc.createAnswer());
    await this.gather(pc);
    if (this.local !== local) return;
    await this.sendDescription(local, pc, 'answer');
  }

  private async sendDescription(local: Local, pc: RTCPeerConnection, kind: 'offer' | 'answer'): Promise<void> {
    const sdp = pc.localDescription?.sdp ?? '';
    checkSdp(sdp, kind);
    for (const part of splitSignal(kind, sdp)) {
      if (this.local !== local) return;
      const reply = await this.act({ kind: 'signal', sessionId: local.sessionId, part });
      if (!reply.ok) { this.fail(local, reply.code); return; }
    }
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
