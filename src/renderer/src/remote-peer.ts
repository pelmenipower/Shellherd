import type { DesktopApi } from '../../shared/ipc';
import type { RemoteEndReason, RemoteErrorCode, RemoteLabCommand, RemoteLabEvent, RemoteLabReply, RemoteLabState } from '../../shared/remote-lab';

export interface RemoteView { state: RemoteLabState; error?: RemoteErrorCode; ended?: RemoteEndReason }

/**
 * Main-window view of a remote session. Capture and WebRTC live in the isolated media window,
 * so this controller only sends commands and mirrors host state.
 */
export class RemoteSessionController {
  private current: RemoteView = { state: { phase: 'idle' } };
  private readonly listeners = new Set<(view: RemoteView) => void>();
  private readonly unsubscribe: () => void;
  private disposed = false;
  /** Device name of the last successful goOnline, so a reopened dialog can show it. */
  deviceName?: string;

  constructor(
    private readonly api: Pick<DesktopApi, 'remoteLabAction' | 'onRemoteLabEvent'>,
    private readonly clientId: string
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
    let reply: RemoteLabReply;
    try {
      reply = await this.api.remoteLabAction({ ...command, clientId: this.clientId });
    } catch {
      reply = { ok: false, code: 'connection' };
    }
    if (reply.ok && command.kind === 'goOnline') this.deviceName = command.deviceName;
    if (reply.ok) this.update({ state: reply.state, error: undefined });
    else this.update({ error: reply.code });
    return reply;
  }

  /** Agent consent: only arms the capture; the host opens the media window and the system dialog follows. */
  async share(sessionId: string, verification: string | null): Promise<void> {
    await this.act({ kind: 'armCapture', sessionId, verification });
  }

  stop(): void {
    const sessionId = this.current.state.session?.id;
    // Internal stop: applies the new state but never records an error over the "stopped" outcome.
    if (sessionId) {
      void this.api.remoteLabAction({ kind: 'stop', sessionId, clientId: this.clientId })
        .then(reply => { if (reply.ok) this.update({ state: reply.state }); }, () => {});
    }
    this.update({ ended: 'stopped' });
  }

  clearError(): void { this.update({ error: undefined }); }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.listeners.clear();
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

  private onEvent(event: RemoteLabEvent): void {
    if (this.disposed) return;
    if (event.kind === 'state') this.update({ state: event.state });
    else if (event.kind === 'error') this.update({ error: event.code });
    else if (event.kind === 'ended') this.update({ ended: event.reason });
  }
}
