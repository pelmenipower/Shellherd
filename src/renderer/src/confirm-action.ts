import { KIND_INFO, type KubeAction, type KubeRef } from '../../shared/kubernetes';

export interface ActionRequest { ref: KubeRef; action: KubeAction; replicas?: number; currentReplicas?: number }
export interface Confirmation { title: string; body: string; requireTyping: string | null; confirmLabel: string }

const TITLES: Record<KubeAction, string> = {
  restart: 'Rollout neu starten?', scale: 'Skalieren?', delete: 'Pod löschen?', cordon: 'Node sperren?', uncordon: 'Node freigeben?',
  suspend: 'CronJob anhalten?', resume: 'CronJob fortsetzen?', trigger: 'CronJob jetzt ausführen?',
};
const LABELS: Record<KubeAction, string> = {
  restart: 'Neu starten', scale: 'Skalieren', delete: 'Löschen', cordon: 'Sperren', uncordon: 'Freigeben',
  suspend: 'Anhalten', resume: 'Fortsetzen', trigger: 'Ausführen',
};

/**
 * Text and confirmation rules for a kube action. Production clusters and scaling to zero
 * require typing the resource name; everything else needs only a click.
 */
export function confirmationFor(request: ActionRequest, cluster: { name: string; production: boolean }): Confirmation {
  const { ref, action, replicas, currentReplicas } = request;
  const kind = KIND_INFO[ref.kind].kind;
  const where = `${kind} ${ref.name} im Namespace ${ref.namespace ?? '-'} auf ${cluster.name}`;
  const requireTyping = cluster.production || (action === 'scale' && replicas === 0) ? ref.name : null;
  let title = TITLES[action];
  let body: string;
  switch (action) {
    case 'restart': body = `${where} wird neu gestartet.`; break;
    case 'delete':
      if (ref.kind === 'jobs') { title = 'Job löschen?'; body = `${where} und seine Pods werden gelöscht.`; }
      else body = `${where} wird gelöscht.`;
      break;
    case 'scale':
      body = currentReplicas !== undefined ? `${where}: ${currentReplicas} → ${replicas} Replicas.` : `${where} wird auf ${replicas} Replicas skaliert.`;
      break;
    case 'cordon': body = `Auf Node ${ref.name} auf ${cluster.name} werden keine neuen Pods mehr geplant. Laufende Pods bleiben.`; break;
    case 'uncordon': body = `Node ${ref.name} auf ${cluster.name} nimmt wieder neue Pods an.`; break;
    case 'suspend': body = `${where} startet keine neuen Jobs mehr.`; break;
    case 'resume': body = `${where} startet wieder nach Zeitplan.`; break;
    case 'trigger': body = `Aus ${where} wird sofort ein Job gestartet.`; break;
  }
  return { title, body, requireTyping, confirmLabel: LABELS[action] };
}
