import type { KubeProbeResult } from '../../shared/kubernetes';
import { PROTOCOLS } from '../../shared/vault/connections';
import type { ConnectionNode, KubernetesConnectionNode, SshConnectionNode, VaultNode } from '../../shared/vault/types';
import { t } from './i18n';

export function noAccessMessage(): string { return t('connection:cluster.validation.noAccess'); }

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
  if (!trimmed) return t('connection:cluster.validation.kubeconfigEmpty');
  return trimmed.startsWith('/') || trimmed.startsWith('~/') ? null : t('connection:cluster.validation.kubeconfigPath');
}

/** Localized message for the first problem with the cluster, or null. */
export function validateCluster(node: KubernetesConnectionNode, nodes: VaultNode[]): string | null {
  if (node.accessHosts.length === 0) return noAccessMessage();
  const connections = flattenConnections(nodes);
  for (const id of node.accessHosts) {
    const access = connections.find(candidate => candidate.id === id);
    if (!access) return t('connection:cluster.validation.accessGone', { id });
    if (access.protocol !== 'ssh') return t('connection:cluster.validation.accessNotSsh', { name: access.name });
    if (access.disabled) return t('connection:cluster.validation.accessDisabled', { name: access.name });
  }
  if (!node.name.trim()) return t('connection:cluster.validation.nameMissing');
  if (node.kubeconfig.source === 'path') return kubeconfigPathError(node.kubeconfig.path);
  return null;
}

/** First access host of the cluster that resolves to an enabled SSH connection, or null. */
export function firstActiveAccessHost(nodes: VaultNode[], cluster: KubernetesConnectionNode): SshConnectionNode | null {
  const connections = flattenConnections(nodes);
  for (const id of cluster.accessHosts) {
    const access = connections.find(candidate => candidate.id === id);
    if (access && access.protocol === 'ssh' && !access.disabled) return access;
  }
  return null;
}
