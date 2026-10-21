export interface AutoLockDeps {
  /** 0 = off; read on every check, so a changed setting applies without restart. */
  minutes: () => number;
  lock: (minutes: number) => void;
  /** powerMonitor.getSystemIdleTime (seconds); only consulted while an RDP session is connected. */
  systemIdleSeconds: () => number;
  rdpConnected: () => boolean;
  now?: () => number;
  tickMs?: number;
}

/** Locks the vault after N minutes without DOM activity in any Shellherd window. */
export class AutoLock {
  private lastActivity: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => number;

  constructor(private readonly deps: AutoLockDeps) {
    this.now = deps.now ?? Date.now;
    this.lastActivity = this.now();
  }

  start(): void {
    if (this.timer) return;
    this.lastActivity = this.now();
    this.timer = setInterval(() => this.check(), this.deps.tickMs ?? 30_000);
    this.timer.unref?.();
  }

  touch(): void { this.lastActivity = this.now(); }

  check(): void {
    const minutes = this.deps.minutes();
    if (!(minutes > 0)) return;
    const limit = minutes * 60_000;
    const now = this.now();
    if (now - this.lastActivity < limit) return;
    // An RDP session is not DOM activity: stay unlocked while the user works in it (system not idle).
    if (this.deps.rdpConnected() && this.deps.systemIdleSeconds() * 1000 < limit) return;
    this.lastActivity = now;
    this.deps.lock(minutes);
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
