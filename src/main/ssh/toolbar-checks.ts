import type { ClientChannel } from 'ssh2';
import { parseToolbarOutput, type ToolbarItem, type ToolbarResult } from '../../shared/toolbar';

const OUTPUT_LIMIT = 32 * 1024;
const clean = (text: string): string => text.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '').slice(0, 2000);
type Exec = (command: string, callback: (error?: Error, stream?: ClientChannel) => void) => void;
interface Check { item: ToolbarItem; timer?: ReturnType<typeof setInterval>; cancel?: () => void; running: boolean; pending?: boolean; lastSuccess?: number }

/** Owns only independent exec channels; never writes into or subscribes to the interactive terminal. */
export class ToolbarChecks {
  private checks = new Map<string, Check>();
  private closed = false;
  constructor(private readonly exec: Exec, private readonly emit: (result: ToolbarResult) => void, private readonly allowed: () => boolean) {}

  configure(items: ToolbarItem[]): void {
    this.stop();
    this.closed = false;
    for (const item of items.filter(item => item.kind === 'status' && item.enabled)) {
      const check: Check = { item, running: false };
      this.checks.set(item.id, check);
      if (item.trigger !== 'click' && !item.confirm) {
        check.timer = setInterval(() => this.run(item.id), item.intervalMs);
        this.run(item.id);
      }
    }
  }

  run(id: string): void {
    const check = this.checks.get(id);
    if (!check || check.running || this.closed || !this.allowed()) return;
    // Bound simultaneous channels even when many indicators are configured.
    if ([...this.checks.values()].filter(item => item.running).length >= 4) {
      if (!check.pending) this.emit({ itemId: id, state: 'checking', lastSuccess: check.lastSuccess });
      check.pending = true;
      return;
    }
    check.pending = false;
    check.running = true;
    this.emit({ itemId: id, state: 'checking', lastSuccess: check.lastSuccess });
    let stream: ClientChannel | undefined;
    let stdout = '', stderr = '', bytes = 0, exitCode: number | undefined;
    let settled = false;
    const finish = (error?: ToolbarResult['error'], detail?: string): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      check.running = false;
      check.cancel = undefined;
      if (error) { try { stream?.signal('TERM'); stream?.close(); } catch { /* already closed */ } }
      if (this.closed || !this.allowed()) return;
      const result: ToolbarResult = { itemId: id, state: 'error', checkedAt: Date.now(), lastSuccess: check.lastSuccess };
      if (!error) {
        try {
          const payload = parseToolbarOutput(stdout);
          Object.assign(result, payload, { message: payload.message === undefined ? undefined : clean(payload.message), state: 'ok' });
          check.lastSuccess = result.checkedAt;
          result.lastSuccess = check.lastSuccess;
        } catch { error = 'invalid-json'; }
      }
      if (error) { result.error = error; if (detail) result.detail = clean(detail); }
      this.emit(result);
      queueMicrotask(() => this.drain());
    };
    const timeout = setTimeout(() => finish('timeout'), check.item.timeoutMs);
    check.cancel = () => finish('disconnected');
    try {
      this.exec(check.item.command, (error, channel) => {
        if (settled || this.closed) { try { channel?.signal('TERM'); channel?.close(); } catch { /* disconnected */ } return; }
        if (error || !channel) { finish('failed'); return; }
        stream = channel;
        const collect = (chunk: Buffer, output: boolean): void => {
          bytes += chunk.length;
          if (bytes > OUTPUT_LIMIT) { finish('output-limit'); return; }
          // Decode after collection to preserve UTF-8 across chunk boundaries.
          if (output) stdout += chunk.toString('latin1'); else stderr += chunk.toString('latin1');
        };
        channel.on('data', (chunk: Buffer) => collect(chunk, true));
        channel.stderr.on('data', (chunk: Buffer) => collect(chunk, false));
        channel.on('error', () => finish('failed'));
        channel.stderr.on('error', () => finish('failed'));
        channel.on('exit', (code: number) => { exitCode = code; });
        channel.on('close', () => {
          stdout = Buffer.from(stdout, 'latin1').toString('utf8');
          stderr = Buffer.from(stderr, 'latin1').toString('utf8');
          finish(exitCode === 0 ? undefined : 'exit', exitCode === 0 ? undefined : stderr);
        });
      });
    } catch { finish('failed'); }
  }

  private drain(): void {
    if (this.closed || !this.allowed()) return;
    for (const [id, check] of this.checks) if (check.pending && !check.running) this.run(id);
  }

  stop(): void {
    this.closed = true;
    for (const check of this.checks.values()) { clearInterval(check.timer); check.cancel?.(); }
    this.checks.clear();
  }
}
