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

/** Why a command failed, for the user; the sudo cases match the container tabs. */
function runFailure(result: RunResult): string {
  if (result.sudoRejected) return SUDO_REJECTED;
  if (result.sudoBusy) return 'Ein anderer Tab meldet sich gerade per sudo an. Bitte später erneut versuchen.';
  if (result.timedOut) return 'Der Host hat nicht rechtzeitig geantwortet.';
  const last = result.stderr.split(/\r?\n/).map(line => line.trim()).filter(Boolean).pop();
  return last ? last.slice(0, 200) : `Befehl fehlgeschlagen (Exit-Code ${result.code ?? '?'}).`;
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
    if (result.code !== 0) throw new HostAccessError(`Die kubeconfig „${path}“ auf ${connection.name} konnte nicht gelesen werden.`);
    return { text: result.stdout, source: path };
  }

  const probe = await host.run(shellJoin(['sh', '-lc', AUTO_SCRIPT]), READ_TIMEOUT);
  if (probe.timedOut || probe.code !== 0) throw new HostAccessError(runFailure(probe));
  const newline = probe.stdout.indexOf('\n');
  const header = (newline === -1 ? probe.stdout : probe.stdout.slice(0, newline)).replace(/\r$/, '');
  const body = newline === -1 ? '' : probe.stdout.slice(newline + 1);
  if (header === 'src:none') {
    throw new HostAccessError(`Keine kubeconfig auf ${connection.name} gefunden (geprüft: $KUBECONFIG, ~/.kube/config, /etc/kubernetes/admin.conf).`);
  }
  if (header === 'src:sudo') {
    // admin.conf uses the SSH connection's own login for sudo (stored password, else sudo -n), independent of the container sudo flag.
    const login = { ...connection, containers: { ...connection.containers, sudo: true } };
    const result = await runWithSudo(host, login, ['cat', '--', ADMIN_CONF], READ_TIMEOUT, rejections);
    if (result.code !== 0 && /a password is required/i.test(result.stderr)) {
      throw new KubeInputError(`${ADMIN_CONF} braucht sudo, und sudo verlangt ein Passwort. Speichere das Passwort an der SSH-Verbindung, richte NOPASSWD ein oder lege die kubeconfig unter ~/.kube/config ab.`);
    }
    if (result.code !== 0 || result.timedOut || result.sudoRejected || result.sudoBusy) {
      throw new HostAccessError(runFailure(result));
    }
    return { text: result.stdout, source: `${ADMIN_CONF} (sudo)` };
  }
  if (!header.startsWith('src:')) throw new HostAccessError(`Die kubeconfig auf ${connection.name} konnte nicht gesucht werden.`);
  return { text: body, source: header.slice('src:'.length) };
}

/**
 * Tries the access hosts in order and returns the first one that opens and yields a kubeconfig.
 * Connection failures move on to the next host; configuration errors stop at once, because the
 * next host has the same setting.
 */
export async function openAccess(cluster: KubernetesConnectionNode, dependencies: AccessDependencies,
  onTry?: (name: string) => void): Promise<ClusterAccess> {
  const failures: string[] = [];
  let tried = 0;
  for (const id of cluster.accessHosts) {
    const connection = dependencies.getConnection(id);
    if (!connection || connection.protocol !== 'ssh' || connection.disabled || !connection.host.trim()) continue;
    tried++;
    onTry?.(connection.name);
    let host: RemoteHost;
    try {
      host = await dependencies.openRemote(connection);
    } catch (error) {
      failures.push(`${connection.name}: ${reason(error)}`);
      continue;
    }
    try {
      const { text, source } = await readKubeconfig(host, connection, cluster.kubeconfig, dependencies.sudoRejections);
      return { host, connection, kubeconfig: text, source };
    } catch (error) {
      host.close();
      if (error instanceof KubeInputError || error instanceof ContainerInputError) throw error;
      failures.push(`${connection.name}: ${reason(error)}`);
    }
  }
  if (!tried) throw new Error('Der Cluster hat keine gültige SSH-Verbindung als Zugang.');
  throw new Error(`Keiner der Zugangs-Hosts erreichbar (${failures.join(', ')}).`);
}

function reason(error: unknown): string {
  return error instanceof HostAccessError || error instanceof KubeInputError ? error.message : publicError(error);
}
