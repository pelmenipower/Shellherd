import { createHash } from 'node:crypto';
import type { SshConnectionNode } from '../../shared/vault/types';

/** Hash of the settings a connection authenticates with; never holds the stored password itself. */
export function connectionFingerprint(connection: SshConnectionNode): string {
  return createHash('sha256')
    .update(JSON.stringify([connection.host, connection.port, connection.username, connection.authentication])).digest('hex');
}

/**
 * Connections whose stored password sudo refused. Shared by container lists, actions and tabs so the
 * password is not tried again (account lockout) until the connection settings change.
 */
export class SudoRejections {
  private rejected = new Map<string, string>();
  private gates = new Map<string, Promise<void>>();

  /**
   * Waits until no other sudo authentication for this connection is running, so a wrong password
   * fails once instead of once per tab or command. The returned release is idempotent and must
   * always be called (readiness, rejection, error, close). With timeoutMs, resolves undefined when
   * the turn does not come in time; that turn is then given up as soon as it arrives.
   */
  acquire(connectionId: string): Promise<() => void>;
  acquire(connectionId: string, timeoutMs: number): Promise<(() => void) | undefined>;
  async acquire(connectionId: string, timeoutMs?: number): Promise<(() => void) | undefined> {
    const previous = this.gates.get(connectionId) ?? Promise.resolve();
    let open!: () => void;
    const turn = new Promise<void>(resolve => { open = resolve; });
    const tail = previous.then(() => turn);
    this.gates.set(connectionId, tail);
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      open();
      if (this.gates.get(connectionId) === tail) this.gates.delete(connectionId);
    };
    const granted = previous.then(() => release);
    if (timeoutMs === undefined) return granted;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), timeoutMs); });
    const winner = await Promise.race([granted, expired]);
    clearTimeout(timer);
    if (!winner) void granted.then(abandoned => abandoned());
    return winner;
  }

  isRejected(connectionId: string, fingerprint: string): boolean { return this.rejected.get(connectionId) === fingerprint; }
  markRejected(connectionId: string, fingerprint: string): void { this.rejected.set(connectionId, fingerprint); }
  clearAll(): void { this.rejected.clear(); }
}
