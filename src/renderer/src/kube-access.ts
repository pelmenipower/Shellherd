import { ACCESS_TTL_MS, type KubeAccessEntry, type KubeAccessId } from '../../shared/kube-access';
import { KIND_INFO, type ClusterStatus, type KubeRef } from '../../shared/kubernetes';
import { t } from './i18n';

/** Answers of the RBAC pre-check per namespace, as kept in KubeViewState.access. */
export type KubeAccessMap = Record<string, KubeAccessEntry>;

/** Namespace whose rules apply: the object's own; cluster-scoped kinds use the cluster's default namespace (ClusterRoleBindings show in every namespace). */
export function accessNamespace(ref: KubeRef, status: ClusterStatus | null): string {
  return KIND_INFO[ref.kind].namespaced && ref.namespace ? ref.namespace : status?.namespace ?? 'default';
}

/** True when the namespace has no answer yet or one older than ACCESS_TTL_MS. */
export function accessStale(access: KubeAccessMap, namespace: string, now: number): boolean {
  const entry = access[namespace];
  return entry === undefined || now - entry.at > ACCESS_TTL_MS;
}

/** Why the account may not use `id` on `ref`; undefined when it may or when nothing is known. */
export function refAccessReason(access: KubeAccessMap, status: ClusterStatus | null, ref: KubeRef, id: KubeAccessId): string | undefined {
  const namespace = accessNamespace(ref, status);
  const denied = access[namespace]?.denied?.find(item => item.id === id);
  if (!denied) return undefined;
  return KIND_INFO[ref.kind].namespaced
    ? t('kubeActions:reasons.forbidden', { verb: denied.verb, resource: denied.resource, namespace })
    : t('kubeActions:reasons.forbiddenClusterWide', { verb: denied.verb, resource: denied.resource });
}
