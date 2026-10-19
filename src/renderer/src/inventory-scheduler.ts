import type { ContainerInventory, ContainerRuntime } from '../../shared/containers';
import { ipcMessage } from './container-tree';
import type { ContainerViewAction } from './container-view';

/** Pause between the end of one request and the start of the next while the tab is visible. */
export const POLL_MS = 10_000;
export interface InventoryInput { hostId: string; runtime: ContainerRuntime | null }
export interface InventorySchedulerHooks {
  request: (input: InventoryInput) => Promise<ContainerInventory>;
  dispatch: (action: ContainerViewAction) => void;
  /** Default POLL_MS. */
  pollMs?: number;
}

export class InventoryScheduler {
  private alive = false;
  private inFlight = false;
  /** One follow-up request is remembered while another one runs. */
  private again = false;
  private sequence = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private key: string | null = null;
  private input: InventoryInput | null = null;
  private visible = false;
  constructor(private readonly hooks: InventorySchedulerHooks) {}
  start(): void { this.alive = true; }
  stop(): void { this.alive = false; clearTimeout(this.timer); }
  update(input: InventoryInput, visible: boolean): void {
    const key = `${input.hostId}|${input.runtime ?? ''}`;
    // Host or runtime change: whatever is in flight is outdated.
    if (this.key !== null && this.key !== key) this.sequence++;
    this.key = key;
    this.input = input;
    this.visible = visible;
    if (!visible) { clearTimeout(this.timer); return; }
    // An in-flight request schedules the next one itself (or repeats, when it is outdated).
    if (!this.inFlight) this.load(false);
  }
  reload(): void { this.load(false); }
  private load(quiet: boolean): void {
    clearTimeout(this.timer);
    if (this.inFlight) { this.again = true; return; }
    const input = this.input;
    if (!input) return;
    this.inFlight = true;
    const id = ++this.sequence;
    this.hooks.dispatch(quiet ? { type: 'loading', quiet: true } : { type: 'loading' });
    this.hooks.request(input).then(
      inventory => { if (this.alive && id === this.sequence) this.hooks.dispatch({ type: 'setInventory', inventory }); },
      error => { if (this.alive && id === this.sequence) this.hooks.dispatch({ type: 'fail', message: ipcMessage(error, 'Die Container konnten nicht geladen werden.') }); },
    ).finally(() => {
      this.inFlight = false;
      if (!this.alive) return;
      // A request that was overtaken by a newer wish (runtime change) is repeated at once.
      const stale = id !== this.sequence;
      if ((this.again || stale) && this.visible) { this.again = false; this.load(false); return; }
      this.again = false;
      if (this.visible) this.timer = setTimeout(() => this.load(true), this.hooks.pollMs ?? POLL_MS);
    });
  }
}
