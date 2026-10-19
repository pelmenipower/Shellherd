import { KIND_INFO, type KubeAction, type KubeRef } from '../../shared/kubernetes';
import { t } from './i18n';

export interface ActionRequest { ref: KubeRef; action: KubeAction; replicas?: number; currentReplicas?: number }
export interface Confirmation { title: string; body: string; requireTyping: string | null; confirmLabel: string }

const TITLE_KEYS = {
  restart: 'kubeActions:confirm.title.restart', scale: 'kubeActions:confirm.title.scale', delete: 'kubeActions:confirm.title.delete',
  cordon: 'kubeActions:confirm.title.cordon', uncordon: 'kubeActions:confirm.title.uncordon', suspend: 'kubeActions:confirm.title.suspend',
  resume: 'kubeActions:confirm.title.resume', trigger: 'kubeActions:confirm.title.trigger',
} as const satisfies Record<KubeAction, string>;
const LABEL_KEYS = {
  restart: 'kubeActions:confirm.label.restart', scale: 'kubeActions:confirm.label.scale', delete: 'kubeActions:confirm.label.delete',
  cordon: 'kubeActions:confirm.label.cordon', uncordon: 'kubeActions:confirm.label.uncordon', suspend: 'kubeActions:confirm.label.suspend',
  resume: 'kubeActions:confirm.label.resume', trigger: 'kubeActions:confirm.label.trigger',
} as const satisfies Record<KubeAction, string>;

/**
 * Text and confirmation rules for a kube action. Production clusters and scaling to zero
 * require typing the resource name; everything else needs only a click.
 */
export function confirmationFor(request: ActionRequest, cluster: { name: string; production: boolean }): Confirmation {
  const { ref, action, replicas, currentReplicas } = request;
  const kind = KIND_INFO[ref.kind].kind;
  const name = ref.name;
  const where = t('kubeActions:confirm.where', { kind, name, namespace: ref.namespace ?? '-', cluster: cluster.name });
  const requireTyping = cluster.production || (action === 'scale' && replicas === 0) ? ref.name : null;
  let title = t(TITLE_KEYS[action]);
  let body: string;
  switch (action) {
    case 'restart': body = t('kubeActions:confirm.body.restart', { where }); break;
    case 'delete':
      if (ref.kind === 'jobs') { title = t('kubeActions:confirm.title.deleteJob'); body = t('kubeActions:confirm.body.deleteJob', { where }); }
      else body = t('kubeActions:confirm.body.delete', { where });
      break;
    case 'scale':
      body = currentReplicas !== undefined
        ? t('kubeActions:confirm.body.scaleFromTo', { where, current: currentReplicas, replicas: replicas ?? '' })
        : t('kubeActions:confirm.body.scaleTo', { where, replicas: replicas ?? '' });
      break;
    case 'cordon': body = t('kubeActions:confirm.body.cordon', { name, cluster: cluster.name }); break;
    case 'uncordon': body = t('kubeActions:confirm.body.uncordon', { name, cluster: cluster.name }); break;
    case 'suspend': body = t('kubeActions:confirm.body.suspend', { where }); break;
    case 'resume': body = t('kubeActions:confirm.body.resume', { where }); break;
    case 'trigger': body = t('kubeActions:confirm.body.trigger', { where }); break;
  }
  return { title, body, requireTyping, confirmLabel: t(LABEL_KEYS[action]) };
}
