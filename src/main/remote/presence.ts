// Presence loop for the remote lab: lease, device/session poll and token refresh as three independent
// setTimeout chains. No Electron dependency, timers are injected.

export interface PresenceTransport {
  register(name: string): Promise<unknown>;
  sessions(): Promise<unknown[]>;
  devices(): Promise<unknown[]>;
  refresh(): Promise<{ expiresAt: number }>;
  unregister(): Promise<unknown>;
}
export interface PresenceTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}
export interface PresenceHandlers {
  onSessions(list: unknown[]): void;
  onDevices(list: unknown[]): void;
  onValidUntil(ms: number): void;
  onOffline(code: 'authentication' | 'connection'): void;
}

export const PRESENCE_TIMING = { leaseMs: 30000, pollMs: 5000, refreshMs: 300000, backoffMs: [5000, 10000, 20000], offlineMs: 60000 } as const;

const isUnauthorized = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401;

export class PresenceLoop {
  private stopped = false;
  private stopping: Promise<void> | undefined;
  private handles = new Set<unknown>();
  private lastLeaseOk = 0;
  private leaseFailures = 0;
  private refreshFailures = 0;

  constructor(
    private readonly transport: PresenceTransport,
    private readonly name: string,
    private readonly timers: PresenceTimers,
    private readonly handlers: PresenceHandlers
  ) {}

  async start(): Promise<void> {
    await this.transport.register(this.name);
    this.lastLeaseOk = this.timers.now();
    this.schedule(PRESENCE_TIMING.leaseMs, () => this.lease());
    this.schedule(PRESENCE_TIMING.refreshMs, () => this.refresh());
    await this.poll();
  }

  stop(): Promise<void> {
    if (!this.stopping) {
      this.stopped = true;
      for (const handle of this.handles) this.timers.clearTimeout(handle);
      this.handles.clear();
      this.stopping = this.transport.unregister().then(
        () => undefined,
        () => undefined
      );
    }
    return this.stopping;
  }

  private schedule(ms: number, fn: () => Promise<void>): void {
    if (this.stopped) return;
    const handle = this.timers.setTimeout(() => {
      this.handles.delete(handle);
      void fn();
    }, ms);
    this.handles.add(handle);
  }

  /** Returns true when the loop was stopped by a 401 (or already stopped). */
  private unauthorized(error: unknown): boolean {
    if (this.stopped) return true;
    if (!isUnauthorized(error)) return false;
    this.handlers.onOffline('authentication');
    void this.stop();
    return true;
  }

  private async poll(): Promise<void> {
    try {
      const sessions = await this.transport.sessions();
      const devices = await this.transport.devices();
      if (this.stopped) return;
      this.handlers.onSessions(sessions);
      this.handlers.onDevices(devices);
    } catch (error) {
      if (this.unauthorized(error)) return;
    }
    this.schedule(PRESENCE_TIMING.pollMs, () => this.poll());
  }

  private async lease(): Promise<void> {
    try {
      await this.transport.register(this.name);
      if (this.stopped) return;
      this.lastLeaseOk = this.timers.now();
      this.leaseFailures = 0;
      this.schedule(PRESENCE_TIMING.leaseMs, () => this.lease());
    } catch (error) {
      if (this.unauthorized(error)) return;
      if (this.timers.now() - this.lastLeaseOk >= PRESENCE_TIMING.offlineMs) {
        this.handlers.onOffline('connection');
        void this.stop();
        return;
      }
      const backoff = PRESENCE_TIMING.backoffMs;
      const delay = backoff[Math.min(this.leaseFailures, backoff.length - 1)];
      this.leaseFailures++;
      this.schedule(delay, () => this.lease());
    }
  }

  private async refresh(): Promise<void> {
    let delay: number = PRESENCE_TIMING.refreshMs;
    try {
      const { expiresAt } = await this.transport.refresh();
      if (this.stopped) return;
      this.refreshFailures = 0;
      this.handlers.onValidUntil(expiresAt);
    } catch (error) {
      if (this.unauthorized(error)) return;
      const backoff = PRESENCE_TIMING.backoffMs;
      if (this.refreshFailures < backoff.length) delay = backoff[this.refreshFailures];
      this.refreshFailures = delay === PRESENCE_TIMING.refreshMs ? 0 : this.refreshFailures + 1;
    }
    this.schedule(delay, () => this.refresh());
  }
}
