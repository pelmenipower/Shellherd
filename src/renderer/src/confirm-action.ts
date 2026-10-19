import { KIND_INFO, type KubeAction, type KubeRef } from '../../shared/kubernetes';

export interface ActionRequest { ref: KubeRef; action: KubeAction; replicas?: number; currentReplicas?: number }
export interface Confirmation { title: string; body: string; requireTyping: string | null; confirmLabel: string }

const TITLES: Record<KubeAction, string> = { restart: 'Rollout neu starten?', scale: 'Skalieren?', delete: 'Pod löschen?' };
const LABELS: Record<KubeAction, string> = { restart: 'Neu starten', scale: 'Skalieren', delete: 'Löschen' };

/**
 * Text and confirmation rules for a kube action. Production clusters and scaling to zero
 * require typing the resource name; everything else needs only a click.
 */
export function confirmationFor(request: ActionRequest, cluster: { name: string; production: boolean }): Confirmation {
  const { ref, action, replicas, currentReplicas } = request;
  const where = `${KIND_INFO[ref.kind].kind} ${ref.name} im Namespace ${ref.namespace ?? '-'} auf ${cluster.name}`;
  const requireTyping = cluster.production || (action === 'scale' && replicas === 0) ? ref.name : null;
  let body: string;
  if (action === 'restart') body = `${where} wird neu gestartet.`;
  else if (action === 'delete') body = `${where} wird gelöscht.`;
  else if (currentReplicas !== undefined) body = `${where}: ${currentReplicas} → ${replicas} Replicas.`;
  else body = `${where} wird auf ${replicas} Replicas skaliert.`;
  return { title: TITLES[action], body, requireTyping, confirmLabel: LABELS[action] };
}
