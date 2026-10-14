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
   * always be called (readiness, rejection, error, close).
   */
  async acquire(connectionId: string): Promise<() => void> {
    const previous = this.gates.get(connectionId) ?? Promise.resolve();
    let open!: () => void;
    const turn = new Promise<void>(resolve => { open = resolve; });
    const tail = previous.then(() => turn);
    this.gates.set(connectionId, tail);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      open();
      if (this.gates.get(connectionId) === tail) this.gates.delete(connectionId);
    };
  }

  isRejected(connectionId: string, fingerprint: string): boolean { return this.rejected.get(connectionId) === fingerprint; }
  markRejected(connectionId: string, fingerprint: string): void { this.rejected.set(connectionId, fingerprint); }
  clear(connectionId: string): void { this.rejected.delete(connectionId); }
  clearAll(): void { this.rejected.clear(); }
}
