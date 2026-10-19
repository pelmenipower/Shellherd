/** Pure builders for kubectl commands and copy texts; `null` means a name is not valid. */
import { KIND_INFO, KUBE_NAME, LABEL_KEY, LABEL_VALUE, MAX_REPLICAS, manualJobName, type KubeKind } from '../../shared/kubernetes';

const ok = (...names: (string | undefined)[]): boolean => names.every(n => n !== undefined && KUBE_NAME.test(n));
const singular = (kind: KubeKind): string => KIND_INFO[kind].kind.toLowerCase();

/** `-n <ns> ` for namespaced kinds, empty for cluster-wide ones; null when the namespace is missing or invalid. */
function scope(kind: KubeKind, ns: string | undefined): string | null {
  if (!KIND_INFO[kind].namespaced) return '';
  return ok(ns) ? `-n ${ns} ` : null;
}

export function logs(ns: string, pod: string, container?: string, previous = false): string | null {
  if (!ok(ns, pod) || (container !== undefined && !ok(container))) return null;
  return `kubectl -n ${ns} logs ${previous ? '--previous' : '-f'} ${pod}${container ? ` -c ${container}` : ''}`;
}

export function exec(ns: string, pod: string, container?: string): string | null {
  if (!ok(ns, pod) || (container !== undefined && !ok(container))) return null;
  return `kubectl -n ${ns} exec -it ${pod}${container ? ` -c ${container}` : ''} -- sh`;
}

function verb(prefix: string, kind: KubeKind, ns: string | undefined, name: string, suffix = ''): string | null {
  const s = scope(kind, ns);
  if (s === null || !ok(name)) return null;
  return `kubectl ${s}${prefix} ${singular(kind)} ${name}${suffix}`;
}

export const describe = (kind: KubeKind, ns: string | undefined, name: string): string | null => verb('describe', kind, ns, name);
export const getYaml = (kind: KubeKind, ns: string | undefined, name: string): string | null => verb('get', kind, ns, name, ' -o yaml');
export const rolloutRestart = (kind: KubeKind, ns: string | undefined, name: string): string | null => verb('rollout restart', kind, ns, name);
export const rolloutStatus = (kind: KubeKind, ns: string | undefined, name: string): string | null => verb('rollout status', kind, ns, name);

export function scale(kind: KubeKind, ns: string | undefined, name: string, replicas: number): string | null {
  if (!Number.isInteger(replicas) || replicas < 0 || replicas > MAX_REPLICAS) return null;
  return verb('scale', kind, ns, name, ` --replicas=${replicas}`);
}

export function logsJob(ns: string, name: string): string | null {
  return ok(ns, name) ? `kubectl -n ${ns} logs job/${name}` : null;
}

export function createJobFromCron(ns: string, cron: string, unix: number): string | null {
  if (!ok(ns, cron) || !Number.isInteger(unix) || unix < 0) return null;
  return `kubectl -n ${ns} create job --from=cronjob/${cron} ${manualJobName(cron, unix)}`;
}

export function patchSuspend(ns: string, cron: string, suspend: boolean): string | null {
  if (!ok(ns, cron)) return null;
  return `kubectl -n ${ns} patch cronjob ${cron} -p '{"spec":{"suspend":${suspend ? 'true' : 'false'}}}'`;
}

export const cordon = (node: string): string | null => (ok(node) ? `kubectl cordon ${node}` : null);
export const uncordon = (node: string): string | null => (ok(node) ? `kubectl uncordon ${node}` : null);
export const drain = (node: string): string | null => (ok(node) ? `kubectl drain ${node} --ignore-daemonsets --delete-emptydir-data` : null);

export function portForward(ns: string, service: string, port: number): string | null {
  if (!ok(ns, service) || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  return `kubectl -n ${ns} port-forward svc/${service} ${port}:${port}`;
}

export const serviceDns = (ns: string, service: string): string | null => (ok(ns, service) ? `${service}.${ns}.svc.cluster.local` : null);

function pairs(labels: Record<string, string>): string[] | null {
  const out: string[] = [];
  for (const [key, value] of Object.entries(labels).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (!LABEL_KEY.test(key) || !LABEL_VALUE.test(value)) return null;
    out.push(`${key}=${value}`);
  }
  return out;
}

export function labelsText(labels: Record<string, string>): string | null {
  return pairs(labels)?.join('\n') ?? null;
}

export function selectorText(selector: Record<string, string>): string | null {
  return pairs(selector)?.join(',') ?? null;
}
