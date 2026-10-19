import { AppError } from '../../shared/errors';
import { ACTION_KINDS, KIND_INFO, MAX_REPLICAS, manualJobName } from '../../shared/kubernetes';
import type { KubeAction, KubeRef } from '../../shared/kubernetes';
import type { KubeApi } from './api';

const RESTART_ANNOTATION = 'kubectl.kubernetes.io/restartedAt';

/** Runs a cluster action after the read-only, kind, namespace and replica checks. */
export async function runAction(
  api: KubeApi,
  request: { ref: KubeRef; action: KubeAction; replicas?: number },
  options: { readOnly: boolean; now?: () => Date },
): Promise<void> {
  if (options.readOnly) throw new AppError('kubernetes.readOnly');
  const { ref, action } = request;
  // The namespace is required exactly for namespaced kinds and refused for cluster-scoped ones.
  const scopeOk = KIND_INFO[ref.kind]?.namespaced ? !!ref.namespace : !ref.namespace;
  if (!(ACTION_KINDS[action] as readonly string[] | undefined)?.includes(ref.kind) || !scopeOk) {
    throw new AppError('kubernetes.actionUnavailable');
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
        throw new AppError('kubernetes.replicasMissing');
      }
      await api.mergePatch(ref, { spec: { replicas } });
      return;
    }
    case 'delete':
      if (ref.kind === 'jobs') await api.remove(ref, { propagationPolicy: 'Background' });
      else await api.remove(ref);
      return;
    case 'cordon':
    case 'uncordon':
      await api.mergePatch(ref, { spec: { unschedulable: action === 'cordon' } });
      return;
    case 'suspend':
    case 'resume':
      await api.mergePatch(ref, { spec: { suspend: action === 'suspend' } });
      return;
    case 'trigger':
      await api.createJobFrom(ref, manualJobName(ref.name, Math.floor((options.now ?? (() => new Date()))().getTime() / 1000)));
      return;
    default: {
      const unknown: never = action;
      void unknown;
      throw new AppError('kubernetes.actionUnavailable');
    }
  }
}
