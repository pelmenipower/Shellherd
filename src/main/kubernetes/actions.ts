import { ACTION_KINDS, MAX_REPLICAS, READ_ONLY_MESSAGE } from '../../shared/kubernetes';
import type { KubeAction, KubeRef } from '../../shared/kubernetes';
import type { KubeApi } from './api';

const RESTART_ANNOTATION = 'kubectl.kubernetes.io/restartedAt';

/** Runs a restart, scale or delete action after the read-only, kind, namespace and replica checks. */
export async function runAction(
  api: KubeApi,
  request: { ref: KubeRef; action: KubeAction; replicas?: number },
  options: { readOnly: boolean; now?: () => Date },
): Promise<void> {
  if (options.readOnly) throw new Error(READ_ONLY_MESSAGE);
  const { ref, action } = request;
  if (!(ACTION_KINDS[action] as readonly string[]).includes(ref.kind) || !ref.namespace) {
    throw new Error('Diese Aktion ist hier nicht möglich.');
  }
  switch (action) {
    case 'restart': {
      const restartedAt = (options.now ?? (() => new Date()))().toISOString();
      await api.mergePatch(ref, { spec: { template: { metadata: { annotations: { [RESTART_ANNOTATION]: restartedAt } } } } });
      return;
    }
    case 'scale': {
      const replicas = request.replicas;
      if (typeof replicas !== 'number' || !Number.isInteger(replicas) || replicas < 0 || replicas > MAX_REPLICAS) {
        throw new Error('Bitte gib die Anzahl der Replicas an.');
      }
      await api.mergePatch(ref, { spec: { replicas } });
      return;
    }
    case 'delete':
      await api.remove(ref);
      return;
  }
}
