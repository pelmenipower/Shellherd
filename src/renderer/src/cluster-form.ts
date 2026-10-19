import type { KubeProbeResult } from '../../shared/kubernetes';
import { PROTOCOLS } from '../../shared/vault/connections';
import type { ConnectionNode, KubernetesConnectionNode, SshConnectionNode, VaultNode } from '../../shared/vault/types';

export const NO_ACCESS_MESSAGE = 'Wähle mindestens eine SSH-Verbindung als Zugang.';
export const KUBECONFIG_EMPTY_MESSAGE = 'Bitte gib den Pfad zur Kubeconfig an.';
export const KUBECONFIG_PATH_MESSAGE = 'Der Pfad muss mit / oder ~/ beginnen.';

/** Host split into prefix, the last number and the rest: "k8s-cp2.example.local" → "k8s-cp", 2, ".example.local". */
const HOST_PATTERN = /^(.*\D)?(\d+)(\D.*)?$/;

export function flattenConnections(nodes: VaultNode[]): ConnectionNode[] {
  return nodes.flatMap(node => node.type === 'folder' ? flattenConnections(node.children) : [node]);
}

function splitHost(host: string): { prefix: string; number: number; rest: string } | null {
  const match = HOST_PATTERN.exec(host);
  if (!match) return null;
  return { prefix: match[1] ?? '', number: Number(match[2]), rest: match[3] ?? '' };
}

/** Source SSH connection first, then active SSH connections with the same host pattern, ordered by their number. */
export function suggestAccessHosts(nodes: VaultNode[], sshId: string): string[] {
  const connections = flattenConnections(nodes);
  const source = connections.find(node => node.id === sshId);
  const parts = source?.protocol === 'ssh' ? splitHost(source.host) : null;
  if (!parts) return [sshId];
  const siblings = connections.flatMap(node => {
    if (node.protocol !== 'ssh' || node.disabled || node.id === sshId) return [];
    const other = splitHost(node.host);
    return other && other.prefix === parts.prefix && other.rest === parts.rest ? [{ id: node.id, number: other.number }] : [];
  });
  siblings.sort((a, b) => a.number - b.number);
  return [sshId, ...siblings.map(sibling => sibling.id)];
}

export function newClusterFromSsh(ssh: SshConnectionNode, nodes: VaultNode[], probe: KubeProbeResult, id: string): KubernetesConnectionNode {
  return { ...emptyCluster(id), name: probe.clusterName?.trim() || ssh.name, accessHosts: suggestAccessHosts(nodes, ssh.id),
    ...(probe.currentContext ? { context: probe.currentContext } : {}) };
}

export function emptyCluster(id: string): KubernetesConnectionNode {
  return {
    id, type: 'connection', name: '', tags: [], protocol: 'kubernetes', icon: PROTOCOLS.kubernetes.defaultIcon,
    accessHosts: [], kubeconfig: { source: 'auto' }, production: true, readOnly: false,
  };
}

/** Message for an unusable kubeconfig path, or null. Shared by the form and validation. */
export function kubeconfigPathError(path: string): string | null {
  const trimmed = path.trim();
  if (!trimmed) return KUBECONFIG_EMPTY_MESSAGE;
  return trimmed.startsWith('/') || trimmed.startsWith('~/') ? null : KUBECONFIG_PATH_MESSAGE;
}

/** German message for the first problem with the cluster, or null. */
export function validateCluster(node: KubernetesConnectionNode, nodes: VaultNode[]): string | null {
  if (node.accessHosts.length === 0) return NO_ACCESS_MESSAGE;
  const connections = flattenConnections(nodes);
  for (const id of node.accessHosts) {
    const access = connections.find(candidate => candidate.id === id);
    if (!access) return `Die Zugangs-Verbindung „${id}“ gibt es nicht mehr.`;
    if (access.protocol !== 'ssh') return `Die Zugangs-Verbindung „${access.name}“ ist keine SSH-Verbindung.`;
    if (access.disabled) return `Die Zugangs-Verbindung „${access.name}“ ist deaktiviert.`;
  }
  if (!node.name.trim()) return 'Bitte gib einen Namen an.';
  if (node.kubeconfig.source === 'path') return kubeconfigPathError(node.kubeconfig.path);
  return null;
}
