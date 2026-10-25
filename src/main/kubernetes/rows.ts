import { KIND_INFO } from '../../shared/kubernetes';
import type { KubeKind, KubePort, KubeRef, KubeRow, NodeTile, RowTone } from '../../shared/kubernetes';
import { jobTone, podTone } from '../../shared/kube-status';
import type { JobStatus } from '../../shared/kube-status';
import type { KubeObject } from './api';

type Dict = Record<string, unknown>;

const rec = (v: unknown): Dict => (v && typeof v === 'object' && !Array.isArray(v) ? v as Dict : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined);
const count = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
/** TCP ports with their names, each port once: container ports of a pod, service ports of a service. */
function tcpPorts(entries: unknown[], key: 'containerPort' | 'port'): KubePort[] | undefined {
  const ports = entries.map(rec).flatMap((entry): KubePort[] => {
    const port = count(entry[key]);
    if (port === undefined || (text(entry.protocol) ?? 'TCP') !== 'TCP') return [];
    const name = text(entry.name);
    return [name ? { port, name } : { port }];
  });
  const unique = ports.filter((entry, index) => ports.findIndex(other => other.port === entry.port) === index);
  return unique.length > 0 ? unique : undefined;
}
const stamp = (v: unknown): string | undefined => {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString();
  return text(v);
};
const labelMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(rec(v))) if (typeof value === 'string') out[key] = value;
  return out;
};
const joinList = (items: (string | undefined)[]): string => items.filter((item): item is string => !!item).join(',');
const images = (podSpec: unknown): string => joinList(list(rec(podSpec).containers).map(c => text(rec(c).image)));

const nodeIp = (node: KubeObject): string | undefined => {
  const found = list(rec(node.status).addresses).map(rec).find(a => a.type === 'InternalIP' && text(a.address));
  return found ? text(found.address) : undefined;
};

const OWNER_KINDS: Record<string, KubeKind> = { StatefulSet: 'statefulsets', DaemonSet: 'daemonsets', Job: 'jobs' };

function ownerOf(kind: KubeKind, meta: Dict, namespace: string | undefined): KubeRef | undefined {
  if (kind !== 'pods' && kind !== 'jobs') return undefined;
  const controller = list(meta.ownerReferences).map(rec).find(o => o.controller === true);
  const ownerKind = text(controller?.kind);
  const name = text(controller?.name);
  if (!ownerKind || !name || !namespace) return undefined;
  if (kind === 'jobs') return ownerKind === 'CronJob' ? { kind: 'cronjobs', namespace, name } : undefined;
  if (ownerKind === 'ReplicaSet') {
    const hash = text(labelMap(meta.labels)['pod-template-hash']);
    if (!hash || !name.endsWith(`-${hash}`) || name.length === hash.length + 1) return undefined;
    return { kind: 'deployments', namespace, name: name.slice(0, -(hash.length + 1)) };
  }
  if (ownerKind === 'Node') return { kind: 'nodes', name };
  const mapped = OWNER_KINDS[ownerKind];
  return mapped ? { kind: mapped, namespace, name } : undefined;
}

const ROLE_PREFIX = 'node-role.kubernetes.io/';
const PRESSURE = ['MemoryPressure', 'DiskPressure', 'PIDPressure'];

export function podStatus(pod: KubeObject): { ready: string; status: string; restarts: number; tone: RowTone } {
  const containers = list(rec(pod.spec).containers);
  const status = rec(pod.status);
  const statuses = list(status.containerStatuses).map(rec);
  const phase = text(status.phase);
  const readyCount = statuses.filter(s => s.ready === true).length;
  const restarts = statuses.reduce((sum, s) => sum + (count(s.restartCount) ?? 0), 0);
  const firstReason = (key: 'waiting' | 'terminated'): string | undefined => {
    for (const s of statuses) {
      const reason = text(rec(rec(s.state)[key]).reason);
      if (reason) return reason;
    }
    return undefined;
  };

  const waiting = firstReason('waiting');
  const terminated = firstReason('terminated');
  const statusReason = text(status.reason);
  let reason: string;
  if (rec(pod.metadata).deletionTimestamp) reason = 'Terminating';
  else if (statusReason && phase !== 'Succeeded' && phase !== 'Running') reason = statusReason;
  else if (waiting) reason = waiting;
  else if (phase !== 'Succeeded' && terminated) reason = terminated;
  else if (phase === 'Succeeded') reason = 'Completed';
  else reason = phase ?? 'Unknown';

  const tone = podTone(reason, phase === 'Running' && readyCount < containers.length);

  return { ready: `${readyCount}/${containers.length}`, status: reason, restarts, tone };
}

function nodeFacts(node: KubeObject) {
  const conditions = list(rec(node.status).conditions).map(rec);
  const isTrue = (type: string) => conditions.some(c => c.type === type && c.status === 'True');
  const roles = Object.keys(labelMap(rec(node.metadata).labels))
    .filter(key => key.startsWith(ROLE_PREFIX))
    .map(key => key.slice(ROLE_PREFIX.length))
    .filter(role => role !== '');
  return {
    ready: isTrue('Ready'),
    roles,
    pressure: PRESSURE.filter(isTrue),
    unschedulable: rec(node.spec).unschedulable === true,
  };
}

const share = (used: number, total: number): number => (total > 0 ? Math.round((used / total) * 100) / 100 : 0);

export function toNodeTile(node: KubeObject, usage?: { cpuMilli: number; memoryBytes: number }): NodeTile {
  const facts = nodeFacts(node);
  const tile: NodeTile = {
    name: text(rec(node.metadata).name) ?? '',
    ready: facts.ready,
    roles: facts.roles,
    pressure: facts.pressure,
    unschedulable: facts.unschedulable,
  };
  const ip = nodeIp(node);
  if (ip) tile.ip = ip;
  if (usage) {
    const allocatable = rec(rec(node.status).allocatable);
    tile.cpu = share(usage.cpuMilli, parseCpu(text(allocatable.cpu)));
    tile.memory = share(usage.memoryBytes, parseMemory(text(allocatable.memory)));
  }
  return tile;
}

/** Quantity such as "250m", "2", "1500n" → millicores. Invalid or missing → 0. */
export function parseCpu(value: string | undefined): number {
  const match = /^(\d+(?:\.\d+)?)(n|u|m)?$/.exec(value ?? '');
  if (!match) return 0;
  const amount = Number(match[1]);
  switch (match[2]) {
    case 'n': return amount / 1e6;
    case 'u': return amount / 1e3;
    case 'm': return amount;
    default: return amount * 1000;
  }
}

const MEMORY_UNITS: Record<string, number> = {
  Ki: 1024, Mi: 1024 ** 2, Gi: 1024 ** 3, Ti: 1024 ** 4, Pi: 1024 ** 5,
  k: 1e3, M: 1e6, G: 1e9, T: 1e12, P: 1e15,
};

/** Quantity such as "128Mi", "1G", "1024" → bytes. Invalid or missing → 0. */
export function parseMemory(value: string | undefined): number {
  const match = /^(\d+(?:\.\d+)?)(Ki|Mi|Gi|Ti|Pi|k|M|G|T|P)?$/.exec(value ?? '');
  if (!match) return 0;
  return Math.round(Number(match[1]) * (match[2] ? MEMORY_UNITS[match[2]] : 1));
}

function jobStatus(spec: Dict, status: Dict, completions: number, succeeded: number): JobStatus {
  const conditions = list(status.conditions).map(rec);
  const isTrue = (type: string) => conditions.some(c => c.type === type && c.status === 'True');
  // FailureTarget / SuccessCriteriaMet (Kubernetes 1.31+) precede Failed / Complete.
  if (isTrue('Failed') || isTrue('FailureTarget')) return 'Failed';
  if (isTrue('Complete') || isTrue('SuccessCriteriaMet')) return 'Complete';
  if (spec.suspend === true) return 'Suspended';
  if ((count(status.active) ?? 0) > 0) return 'Running';
  if (conditions.length === 0 && succeeded >= completions) return 'Complete';
  return 'Pending';
}

function workloadCells(kind: KubeKind, object: KubeObject, row: KubeRow): void {
  const spec = rec(object.spec);
  const status = rec(object.status);
  const podSpec = rec(rec(spec.template).spec);
  row.cells.image = images(podSpec);
  row.selector = labelMap(rec(spec.selector).matchLabels);

  if (kind === 'daemonsets') {
    const desired = count(status.desiredNumberScheduled) ?? 0;
    const ready = count(status.numberReady) ?? 0;
    row.cells.ready = `${ready}/${desired}`;
    row.cells.upToDate = count(status.updatedNumberScheduled) ?? 0;
    row.tone = desired === 0 ? 'muted' : ready === desired ? 'ok' : 'warn';
    return;
  }
  const replicas = count(spec.replicas) ?? 1;
  const ready = count(status.readyReplicas) ?? 0;
  row.replicas = replicas;
  row.cells.ready = `${ready}/${replicas}`;
  row.cells.upToDate = count(status.updatedReplicas) ?? 0;
  row.tone = replicas === 0 ? 'muted' : ready === replicas ? 'ok' : 'warn';
}

export function toRow(kind: KubeKind, object: KubeObject): KubeRow | null {
  const meta = rec(object.metadata);
  const name = text(meta.name);
  const uid = text(meta.uid);
  if (!name || !uid) return null;
  const namespace = text(meta.namespace);
  const ref: KubeRef = namespace ? { kind, namespace, name } : { kind, name };
  const row: KubeRow = { uid, ref, cells: { name }, tone: 'ok', labels: labelMap(meta.labels) };
  const created = stamp(meta.creationTimestamp);
  if (created) row.cells.age = created;

  const spec = rec(object.spec);
  const status = rec(object.status);
  const owner = ownerOf(kind, meta, namespace);
  if (owner) row.owner = owner;
  switch (kind) {
    case 'pods': {
      const pod = podStatus(object);
      const nodeName = text(spec.nodeName);
      row.cells.ready = pod.ready;
      row.cells.status = pod.status;
      row.cells.restarts = pod.restarts;
      row.cells.node = nodeName ?? '—';
      row.tone = pod.tone;
      row.containers = list(spec.containers).map(c => text(rec(c).name)).filter((n): n is string => !!n);
      for (const container of list(spec.containers).map(rec)) {
        const containerName = text(container.name);
        const image = text(container.image);
        if (containerName && image) row.cells[`image:${containerName}`] = image;
      }
      if (nodeName) row.node = nodeName;
      const podIp = text(status.podIP);
      if (podIp) row.ip = podIp;
      const podPorts = tcpPorts(list(spec.containers).flatMap(container => list(rec(container).ports)), 'containerPort');
      if (podPorts) row.ports = podPorts;
      break;
    }
    case 'deployments':
    case 'statefulsets':
    case 'daemonsets':
      workloadCells(kind, object, row);
      break;
    case 'jobs': {
      const completions = count(spec.completions) ?? 1;
      const succeeded = count(status.succeeded) ?? 0;
      row.cells.completions = `${succeeded}/${completions}`;
      const matchLabels = labelMap(rec(spec.selector).matchLabels);
      if (Object.keys(matchLabels).length > 0) row.selector = matchLabels;
      const lastRun = stamp(status.completionTime) ?? stamp(status.startTime);
      if (lastRun) row.cells.lastRun = lastRun;
      const state = jobStatus(spec, status, completions, succeeded);
      row.cells.status = state;
      row.tone = jobTone(state);
      break;
    }
    case 'cronjobs': {
      row.cells.schedule = text(spec.schedule) ?? '';
      const lastRun = stamp(status.lastScheduleTime);
      if (lastRun) row.cells.lastRun = lastRun;
      row.suspended = spec.suspend === true;
      row.tone = row.suspended ? 'muted' : 'ok';
      break;
    }
    case 'services': {
      row.cells.type = text(spec.type) ?? 'ClusterIP';
      row.cells.clusterIp = text(spec.clusterIP) ?? '—';
      row.cells.ports = joinList(list(spec.ports).map(p => {
        const port = count(rec(p).port);
        return port === undefined ? undefined : `${port}/${text(rec(p).protocol) ?? 'TCP'}`;
      }));
      row.selector = labelMap(spec.selector);
      const servicePorts = tcpPorts(list(spec.ports), 'port');
      if (servicePorts) row.ports = servicePorts;
      break;
    }
    case 'ingresses': {
      row.cells.hosts = joinList(list(spec.rules).map(r => text(rec(r).host)));
      row.cells.address = joinList(list(rec(status.loadBalancer).ingress).map(i => text(rec(i).ip) ?? text(rec(i).hostname)));
      break;
    }
    case 'nodes': {
      const facts = nodeFacts(object);
      const unschedulable = facts.unschedulable;
      row.cells.status = `${facts.ready ? 'Ready' : 'NotReady'}${unschedulable ? ',SchedulingDisabled' : ''}`;
      row.cells.roles = facts.roles.length > 0 ? facts.roles.join(',') : '—';
      row.cells.version = text(rec(status.nodeInfo).kubeletVersion) ?? '—';
      row.unschedulable = unschedulable;
      row.pressure = facts.pressure;
      const ip = nodeIp(object);
      if (ip) row.ip = ip;
      row.tone = !facts.ready ? 'bad' : facts.pressure.length > 0 || unschedulable ? 'warn' : 'ok';
      break;
    }
    case 'events': {
      const involved = rec(object.involvedObject);
      const type = text(object.type) ?? 'Normal';
      const involvedKind = text(involved.kind);
      const involvedName = text(involved.name);
      if (involvedKind && involvedName) {
        row.involved = { kind: involvedKind, name: involvedName };
        const target = (Object.keys(KIND_INFO) as KubeKind[]).find(k => KIND_INFO[k].kind === involvedKind);
        if (target) {
          const ns = text(involved.namespace) ?? namespace;
          row.involved.ref = KIND_INFO[target].namespaced && ns ? { kind: target, namespace: ns, name: involvedName } : { kind: target, name: involvedName };
        }
      }
      row.cells.type = type;
      row.cells.reason = text(object.reason) ?? '';
      row.cells.object = text(involved.name) ? `${text(involved.kind) ?? ''}/${text(involved.name)}` : '';
      row.cells.message = text(object.message) ?? '';
      row.cells.count = count(object.count) ?? count(rec(object.series).count) ?? 1;
      const last = stamp(object.lastTimestamp) ?? stamp(object.eventTime) ?? created;
      if (last) row.cells.last = last;
      row.tone = type === 'Warning' ? 'warn' : 'muted';
      break;
    }
  }
  return row;
}
