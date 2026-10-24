import type { Duplex } from 'node:stream';
import { AppError } from '../../shared/errors';
import type { CodedError } from '../../shared/errors';
import type { ConnectionNode, SftpConnectionNode, SshConnectionNode } from '../../shared/vault/types';
import type { RemoteHost } from '../containers/runner';

export interface Jump { readonly name: string; readonly sock: Duplex; close(): void }
export interface JumpDependencies {
  getConnection(id: string): ConnectionNode | undefined;
  /** openRemote with the jump connection's own timeouts, host-key check and keyboard prompts. */
  openRemote(connection: SshConnectionNode, ownerId?: number, isActive?: () => boolean): Promise<RemoteHost>;
}

/** Same classification as publicError in session.ts; a copy avoids an import cycle once session.ts uses this module. */
function causeOf(error: unknown): CodedError {
  if (error instanceof AppError) return error.toCoded();
  return (error as { level?: string })?.level === 'client-authentication' ? { code: 'ssh.authFailed' } : { code: 'ssh.failed' };
}

/** Opens one hop through `connection.jumpHost`; undefined without one (spec 4.1 and 4.2). */
export async function openJump(connection: SshConnectionNode | SftpConnectionNode, dependencies: JumpDependencies,
  ownerId?: number, isActive?: () => boolean): Promise<Jump | undefined> {
  const id = connection.jumpHost;
  if (!id) return undefined;
  const jump = dependencies.getConnection(id);
  if (!jump) throw new AppError('ssh.jumpHostMissing', { id });
  // One hop only: no chains, no loops, no disabled or non-SSH hosts.
  if (jump.protocol !== 'ssh' || jump.disabled || jump.jumpHost !== undefined || jump.id === connection.id) {
    throw new AppError('ssh.jumpHostUnusable', { name: jump.name });
  }
  let host: RemoteHost;
  try {
    host = await dependencies.openRemote(jump, ownerId, isActive);
  } catch (error) {
    throw new AppError('ssh.jumpHostFailed', { name: jump.name }, undefined, [{ label: jump.name, error: causeOf(error) }]);
  }
  // The session may have closed during the jump host login: no forward for nobody.
  if (isActive && !isActive()) {
    host.close();
    throw new AppError('ssh.jumpHostFailed', { name: jump.name }, undefined, [{ label: jump.name, error: { code: 'ssh.promptCancelled' } }]);
  }
  let channel: Duplex;
  try {
    channel = await host.forward(connection.host, connection.port);
  } catch {
    host.close();
    throw new AppError('ssh.jumpTargetUnreachable', { host: connection.host, port: connection.port });
  }
  let closed = false;
  return {
    name: jump.name,
    sock: channel,
    close() {
      if (closed) return;
      closed = true;
      channel.destroy();
      host.close();
    },
  };
}
