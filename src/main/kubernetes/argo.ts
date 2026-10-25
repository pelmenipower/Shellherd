/** Argo CD application of a tracked object: where it lives and what the confirmation says about it. Reading only. */
import { ARGO_HEALTH, ARGO_SYNC, type KubeArgoState } from '../../shared/kubernetes';
import { argoAppParts } from '../../shared/kube-links';
import type { KubeObject } from './api';

/** Namespace of Argo CD's own applications when the name is not qualified (`namespace_name`). */
export const ARGO_NAMESPACE = 'argocd';
/** The confirmation never waits longer for the Self-Heal state. */
export const ARGO_TIMEOUT_MS = 5_000;

type Dict = Record<string, unknown>;
const rec = (value: unknown): Dict => (value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {});

export function argoAppLocation(app: string): { namespace: string; name: string } | null {
  const parts = argoAppParts(app);
  return parts ? { namespace: parts.namespace ?? ARGO_NAMESPACE, name: parts.name } : null;
}

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | undefined =>
  (values as readonly unknown[]).includes(value) ? value as T : undefined;

/** Automated sync is on when `syncPolicy.automated` is an object and not `enabled: false` (Argo CD 3); Self-Heal needs it. */
export function argoStateOf(object: KubeObject): KubeArgoState {
  const automated = rec(rec(object.spec).syncPolicy).automated;
  const on = Boolean(automated) && typeof automated === 'object' && !Array.isArray(automated) && rec(automated).enabled !== false;
  const status = rec(object.status);
  const sync = oneOf(ARGO_SYNC, rec(status.sync).status);
  const health = oneOf(ARGO_HEALTH, rec(status.health).status);
  return { automated: on, selfHeal: on && rec(automated).selfHeal === true, ...(sync ? { sync } : {}), ...(health ? { health } : {}) };
}
