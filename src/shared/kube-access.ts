/** RBAC pre-check: which functions of the cluster tab the account may use; see .superpowers/sdd/k8s-logs-rbac-research.md. */
import type { KubeAction, KubeKind } from './kubernetes';

/** One rule of a SelfSubjectRulesReview. RBAC only grants: a missing rule means "not allowed". */
export interface KubeResourceRule { verbs: string[]; apiGroups: string[]; resources: string[]; resourceNames?: string[] }
/** One request the API server would authorize; a subresource is written `pods/log`. */
export interface KubeAccessCheck { verb: string; group: string; resource: string }

export const KUBE_ACCESS_IDS = ['logs', 'logsAll', 'shell', 'forward', 'patchDeployments', 'patchStatefulSets', 'patchDaemonSets',
  'patchCronJobs', 'patchNodes', 'deletePods', 'deleteJobs', 'trigger'] as const;
export type KubeAccessId = typeof KUBE_ACCESS_IDS[number];
/** A function the account may not use, with the first missing check (for the reason text). */
export interface KubeDenied { id: KubeAccessId; verb: string; resource: string }
/** Answer for one namespace. denied null = unknown (review forbidden, not served, incomplete or slow): nothing is greyed out. at = Date.now(). */
export interface KubeAccessEntry { at: number; denied: KubeDenied[] | null }
/** An answer older than this is fetched again on the next need. */
export const ACCESS_TTL_MS = 60_000;

const check = (verb: string, group: string, resource: string): KubeAccessCheck => ({ verb, group, resource });
/**
 * Alternatives per function; one alternative is allowed when all of its checks are.
 * Exec and port forward need `create` since Kubernetes 1.31 (WebSocket) and `get` before.
 */
export const ACCESS_CHECKS: Record<KubeAccessId, KubeAccessCheck[][]> = {
  logs: [[check('get', '', 'pods/log')]],
  logsAll: [[check('get', '', 'pods/log'), check('list', '', 'pods'), check('watch', '', 'pods')]],
  shell: [[check('create', '', 'pods/exec')], [check('get', '', 'pods/exec')]],
  forward: [[check('create', '', 'pods/portforward')], [check('get', '', 'pods/portforward')]],
  patchDeployments: [[check('patch', 'apps', 'deployments')]],
  patchStatefulSets: [[check('patch', 'apps', 'statefulsets')]],
  patchDaemonSets: [[check('patch', 'apps', 'daemonsets')]],
  patchCronJobs: [[check('patch', 'batch', 'cronjobs')]],
  patchNodes: [[check('patch', '', 'nodes')]],
  deletePods: [[check('delete', '', 'pods')]],
  deleteJobs: [[check('delete', 'batch', 'jobs')]],
  trigger: [[check('create', 'batch', 'jobs'), check('get', 'batch', 'cronjobs')]],
};

const has = (values: string[], value: string): boolean => values.includes('*') || values.includes(value);

// RBAC resource matching: `*`, the exact resource, or `*/<subresource>`. `pods/*` is no RBAC pattern.
function resourceMatches(resources: string[], resource: string): boolean {
  if (resources.includes('*') || resources.includes(resource)) return true;
  const slash = resource.indexOf('/');
  return slash > 0 && resources.includes(`*${resource.slice(slash)}`);
}

/** True when the rule grants the check. resourceNames are ignored: a rule for named objects counts as allowed, so nothing is greyed out that might work. */
export function ruleAllows(rule: KubeResourceRule, wanted: KubeAccessCheck): boolean {
  return has(rule.verbs, wanted.verb) && has(rule.apiGroups, wanted.group) && resourceMatches(rule.resources, wanted.resource);
}

export function allows(rules: KubeResourceRule[], wanted: KubeAccessCheck): boolean {
  return rules.some(rule => ruleAllows(rule, wanted));
}

/** Functions the complete rules of a namespace do not allow, each with the first missing check of its first alternative. */
export function deniedAccess(rules: KubeResourceRule[]): KubeDenied[] {
  return KUBE_ACCESS_IDS.flatMap(id => {
    const alternatives = ACCESS_CHECKS[id];
    if (alternatives.some(all => all.every(wanted => allows(rules, wanted)))) return [];
    const missing = alternatives[0].find(wanted => !allows(rules, wanted)) ?? alternatives[0][0];
    return [{ id, verb: missing.verb, resource: missing.resource }];
  });
}

/** The function a cluster action needs on a kind; undefined for pairs ACTION_KINDS does not allow. */
export function actionAccess(action: KubeAction, kind: KubeKind): KubeAccessId | undefined {
  switch (action) {
    case 'restart':
    case 'scale':
      return kind === 'deployments' ? 'patchDeployments' : kind === 'statefulsets' ? 'patchStatefulSets' : kind === 'daemonsets' ? 'patchDaemonSets' : undefined;
    case 'delete': return kind === 'pods' ? 'deletePods' : kind === 'jobs' ? 'deleteJobs' : undefined;
    case 'cordon':
    case 'uncordon': return kind === 'nodes' ? 'patchNodes' : undefined;
    case 'suspend':
    case 'resume': return kind === 'cronjobs' ? 'patchCronJobs' : undefined;
    case 'trigger': return kind === 'cronjobs' ? 'trigger' : undefined;
  }
}
