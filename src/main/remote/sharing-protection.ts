export interface ProtectionTimers {
  setTimeout(fn: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface SharingProtectionDeps {
  apply(protect: boolean): void
  /** Live count of agent windows that are not destroyed. */
  agentsAlive(): number
  destroyAgents(): void
  timers: ProtectionTimers
  capMs: number
}

/**
 * Decides whether Shellherd surfaces are excluded from screen capture.
 * Fail-closed: the protection outlives sharing until every agent window is really gone.
 */
export class SharingProtection {
  private locked = false
  private sharing = false
  private agents = 0
  private applied = false
  private cap: unknown = undefined

  constructor(private readonly deps: SharingProtectionDeps) {}

  /** locked || sharing || agents > 0 (a pending cap implies live agents). */
  get protect(): boolean {
    return this.locked || this.sharing || this.agents > 0
  }

  setLocked(locked: boolean): void {
    this.locked = locked
    this.update()
  }

  setSharing(sharing: boolean): void {
    this.sharing = sharing
    this.update()
  }

  setAgents(alive: number): void {
    this.agents = Math.max(0, alive)
    this.update()
  }

  dispose(): void {
    this.stopCap()
  }

  private update(): void {
    if (this.sharing || this.agents === 0) this.stopCap()
    else if (this.cap === undefined) this.startCap()
    const protect = this.protect
    if (protect === this.applied) return
    this.applied = protect
    this.deps.apply(protect)
  }

  private startCap(): void {
    this.cap = this.deps.timers.setTimeout(() => this.expire(), this.deps.capMs)
  }

  private stopCap(): void {
    if (this.cap === undefined) return
    this.deps.timers.clearTimeout(this.cap)
    this.cap = undefined
  }

  private expire(): void {
    this.cap = undefined
    if (this.sharing || this.agents === 0) return
    if (this.deps.agentsAlive() === 0) {
      this.agents = 0
      this.update()
      return
    }
    // A window outlived the cap: destroy again and stay protected (B6).
    this.deps.destroyAgents()
    this.startCap()
  }
}
