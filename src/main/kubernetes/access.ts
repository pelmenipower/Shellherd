import { AppError } from '../../shared/errors';
import type { CodedError } from '../../shared/errors';
import type { ConnectionNode, KubernetesConnectionNode, SshConnectionNode } from '../../shared/vault/types';
import { ContainerInputError, shellJoin } from '../containers/commands';
import { SUDO_REJECTED } from '../containers/parsers';
import type { RunResult } from '../containers/parsers';
import { HostAccessError } from '../containers/runner';
import type { RemoteHost } from '../containers/runner';
import { runWithSudo } from '../containers/sudo-run';
import type { SudoRejections } from '../containers/sudo-rejections';
import { publicError } from '../ssh/session';
import { KubeInputError } from './kubeconfig';

/** Prints `src:<path>` then the file, or `src:sudo` when only admin.conf exists, or `src:none`. */
export const AUTO_SCRIPT = [
  'f="${KUBECONFIG%%:*}";',
  'if [ -n "$f" ] && [ -r "$f" ]; then printf "src:%s\\n" "$f"; cat -- "$f";',
  'elif [ -r "$HOME/.kube/config" ]; then printf "src:%s\\n" "$HOME/.kube/config"; cat -- "$HOME/.kube/config";',
  'elif [ -e /etc/kubernetes/admin.conf ]; then echo src:sudo;',
  'else echo src:none; fi',
].join(' ');
const ADMIN_CONF = '/etc/kubernetes/admin.conf';
const READ_TIMEOUT = 15_000;

export interface AccessDependencies {
  getConnection: (id: string) => ConnectionNode | undefined;
  openRemote: (connection: SshConnectionNode) => Promise<RemoteHost>;
  sudoRejections: SudoRejections;
}

export interface ClusterAccess { host: RemoteHost; connection: SshConnectionNode; kubeconfig: string; source: string }

/** Why a command failed, for the user; the sudo cases match the container tabs. The last stderr line is only a detail. */
function runFailure(result: RunResult): HostAccessError {
  if (result.sudoRejected) return new HostAccessError(SUDO_REJECTED);
  if (result.sudoBusy) return new HostAccessError('kubernetes.sudoBusy');
  if (result.timedOut) return new HostAccessError('kubernetes.hostTimeout');
  const last = result.stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop();
  return last
    ? new HostAccessError('kubernetes.hostCommandFailed', undefined, last.slice(0, 200))
    : new HostAccessError('kubernetes.hostCommandExit', { exit: result.code ?? '?' });
}

/** Reads the kubeconfig from the access host: auto-detected, or the configured path (`~/` means the home directory). */
export async function readKubeconfig(host: RemoteHost, connection: SshConnectionNode, source: KubernetesConnectionNode['kubeconfig'],
  rejections: SudoRejections): Promise<{ text: string; source: string }> {
  if (source.source === 'path') {
    const path = source.path;
    const command = path.startsWith('~/')
      ? shellJoin(['sh', '-c', `cat -- "$HOME"/${shellJoin([path.slice(2)])}`])
      : shellJoin(['cat', '--', path]);
    const result = await host.run(command, READ_TIMEOUT);
    if (result.code !== 0) throw new HostAccessError('kubernetes.kubeconfigPathUnreadable', { path, host: connection.name });
    return { text: result.stdout, source: path };
  }

  const probe = await host.run(shellJoin(['sh', '-lc', AUTO_SCRIPT]), READ_TIMEOUT);
  if (probe.timedOut || probe.code !== 0) throw runFailure(probe);
  const newline = probe.stdout.indexOf('\n');
  const header = (newline === -1 ? probe.stdout : probe.stdout.slice(0, newline)).replace(/\r$/, '');
  const body = newline === -1 ? '' : probe.stdout.slice(newline + 1);
  if (header === 'src:none') {
    throw new HostAccessError('kubernetes.kubeconfigNotFound', { host: connection.name });
  }
  if (header === 'src:sudo') {
    // admin.conf uses the SSH connection's own login for sudo (stored password, else sudo -n), independent of the container sudo flag.
    const login = { ...connection, containers: { ...connection.containers, sudo: true } };
    const result = await runWithSudo(host, login, ['cat', '--', ADMIN_CONF], READ_TIMEOUT, rejections);
    if (result.code !== 0 && /a password is required/i.test(result.stderr)) {
      throw new KubeInputError('kubernetes.adminConfNeedsPassword');
    }
    if (result.code !== 0 || result.timedOut || result.sudoRejected || result.sudoBusy) {
      throw runFailure(result);
    }
    return { text: result.stdout, source: `${ADMIN_CONF} (sudo)` };
  }
  if (!header.startsWith('src:')) throw new HostAccessError('kubernetes.kubeconfigSearchFailed', { host: connection.name });
  return { text: body, source: header.slice('src:'.length) };
}

/**
 * Tries the access hosts in order and returns the first one that opens and yields a kubeconfig.
 * Connection failures move on to the next host; configuration errors stop at once, because the
 * next host has the same setting.
 */
export async function openAccess(cluster: KubernetesConnectionNode, dependencies: AccessDependencies): Promise<ClusterAccess> {
  const failures: { name: string; error: CodedError }[] = [];
  let tried = 0;
  for (const id of cluster.accessHosts) {
    const connection = dependencies.getConnection(id);
    if (!connection || connection.protocol !== 'ssh' || connection.disabled || !connection.host.trim()) continue;
    tried++;
    let host: RemoteHost;
    try {
      host = await dependencies.openRemote(connection);
    } catch (error) {
      failures.push({ name: connection.name, error: publicError(error) });
      continue;
    }
    try {
      const { text, source } = await readKubeconfig(host, connection, cluster.kubeconfig, dependencies.sudoRejections);
      return { host, connection, kubeconfig: text, source };
    } catch (error) {
      host.close();
      if (error instanceof KubeInputError || error instanceof ContainerInputError) throw error;
      failures.push({ name: connection.name, error: publicError(error) });
    }
  }
  if (!tried) throw new AppError('kubernetes.noAccessHost');
  // The per-host reasons are codes; they are listed as a detail because params cannot carry a translated list.
  throw new AppError('kubernetes.accessHostsUnreachable', { hosts: failures.map(failure => failure.name).join(', ') },
    failures.map(failure => `${failure.name}: ${failure.error.code}`).join(', '));
}
