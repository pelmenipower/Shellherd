/** Kubernetes cluster tab; see docs/superpowers/specs/2026-10-16-kubernetes-integration-design.md. */

/** DNS-1123 subdomain: namespaces, pods, workloads, containers and nodes. */
export const KUBE_NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
/** Label key with optional prefix, and label value; no commas or operators. */
export const LABEL_KEY = /^([a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?\/)?[A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?$/;
export const LABEL_VALUE = /^([A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?)?$/;
export const MAX_REPLICAS = 1000;
export const READ_ONLY_MESSAGE = 'Dieser Cluster ist schreibgeschützt.';

export const KUBE_KINDS = ['pods', 'deployments', 'statefulsets', 'daemonsets', 'jobs', 'cronjobs', 'services', 'ingresses', 'nodes', 'events'] as const;
export type KubeKind = typeof KUBE_KINDS[number];

export interface KindInfo { label: string; apiVersion: string; kind: string; namespaced: boolean; command: string }
export const KIND_INFO: Record<KubeKind, KindInfo> = {
  pods: { label: 'Pods', apiVersion: 'v1', kind: 'Pod', namespaced: true, command: 'pods' },
  deployments: { label: 'Deployments', apiVersion: 'apps/v1', kind: 'Deployment', namespaced: true, command: 'deploy' },
  statefulsets: { label: 'StatefulSets', apiVersion: 'apps/v1', kind: 'StatefulSet', namespaced: true, command: 'sts' },
  daemonsets: { label: 'DaemonSets', apiVersion: 'apps/v1', kind: 'DaemonSet', namespaced: true, command: 'ds' },
  jobs: { label: 'Jobs', apiVersion: 'batch/v1', kind: 'Job', namespaced: true, command: 'jobs' },
  cronjobs: { label: 'CronJobs', apiVersion: 'batch/v1', kind: 'CronJob', namespaced: true, command: 'cronjobs' },
  services: { label: 'Services', apiVersion: 'v1', kind: 'Service', namespaced: true, command: 'svc' },
  ingresses: { label: 'Ingress', apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', namespaced: true, command: 'ing' },
  nodes: { label: 'Nodes', apiVersion: 'v1', kind: 'Node', namespaced: false, command: 'nodes' },
  events: { label: 'Events', apiVersion: 'v1', kind: 'Event', namespaced: true, command: 'events' },
};

export interface KubeRef { kind: KubeKind; namespace?: string; name: string }
export const refKey = (ref: KubeRef): string => `${ref.kind}/${ref.namespace ?? ''}/${ref.name}`;

/** Drill-down narrowing: pods matching labels, or pods on a node. */
export interface KubeSelector { labels?: Record<string, string>; node?: string }
/** One table: a kind in a namespace (null = all namespaces), optionally narrowed. */
export interface KubeQuery { kind: KubeKind; namespace: string | null; selector?: KubeSelector }
export const queryKey = (query: KubeQuery): string => JSON.stringify([query.kind, query.namespace,
  Object.entries(query.selector?.labels ?? {}).sort(), query.selector?.node ?? null]);

export type RowTone = 'ok' | 'warn' | 'bad' | 'muted';
export interface KubeRow {
  uid: string;
  ref: KubeRef;
  /** Column key → value; keys from KIND_COLUMNS. Columns with `age` hold an ISO timestamp. */
  cells: Record<string, string | number>;
  tone: RowTone;
  labels: Record<string, string>;
  /** Pods: container names in spec order (no init containers). */
  containers?: string[];
  /** Workloads, jobs and services: the pod selector used for drill-down. */
  selector?: Record<string, string>;
  /** Pods: the node they run on. */
  node?: string;
  /** Deployments and StatefulSets: desired replicas, for scale. */
  replicas?: number;
  /** Pods: Deployment (via ReplicaSet), StatefulSet, DaemonSet or Job; jobs: CronJob. */
  owner?: KubeRef;
  /** Pods: status.podIP; nodes: InternalIP. */
  ip?: string;
  /** CronJobs. */
  suspended?: boolean;
  /** Nodes. */
  unschedulable?: boolean;
  /** Nodes: MemoryPressure / DiskPressure / PIDPressure conditions that are True; always set on node rows. */
  pressure?: string[];
  /** Events: the object concerned; `ref` only when its kind maps to a KubeKind. */
  involved?: { kind: string; name: string; ref?: KubeRef };
}

export interface ColumnInfo { key: string; label: string; numeric?: boolean; age?: boolean; usage?: 'cpu' | 'memory' }
export const KIND_COLUMNS: Record<KubeKind, ColumnInfo[]> = {
  pods: [{ key: 'name', label: 'Name' }, { key: 'ready', label: 'Ready' }, { key: 'status', label: 'Status' },
    { key: 'restarts', label: 'Restarts', numeric: true }, { key: 'cpu', label: 'CPU', usage: 'cpu' }, { key: 'memory', label: 'RAM', usage: 'memory' },
    { key: 'node', label: 'Node' }, { key: 'age', label: 'Alter', age: true }],
  deployments: [{ key: 'name', label: 'Name' }, { key: 'ready', label: 'Ready' }, { key: 'upToDate', label: 'Aktuell', numeric: true },
    { key: 'image', label: 'Image' }, { key: 'age', label: 'Alter', age: true }],
  statefulsets: [{ key: 'name', label: 'Name' }, { key: 'ready', label: 'Ready' }, { key: 'upToDate', label: 'Aktuell', numeric: true },
    { key: 'image', label: 'Image' }, { key: 'age', label: 'Alter', age: true }],
  daemonsets: [{ key: 'name', label: 'Name' }, { key: 'ready', label: 'Ready' }, { key: 'upToDate', label: 'Aktuell', numeric: true },
    { key: 'image', label: 'Image' }, { key: 'age', label: 'Alter', age: true }],
  jobs: [{ key: 'name', label: 'Name' }, { key: 'completions', label: 'Abgeschlossen' }, { key: 'status', label: 'Status' },
    { key: 'lastRun', label: 'Letzter Lauf', age: true }, { key: 'age', label: 'Alter', age: true }],
  cronjobs: [{ key: 'name', label: 'Name' }, { key: 'schedule', label: 'Zeitplan' }, { key: 'lastRun', label: 'Letzter Lauf', age: true },
    { key: 'age', label: 'Alter', age: true }],
  services: [{ key: 'name', label: 'Name' }, { key: 'type', label: 'Typ' }, { key: 'clusterIp', label: 'Cluster-IP' },
    { key: 'ports', label: 'Ports' }, { key: 'age', label: 'Alter', age: true }],
  ingresses: [{ key: 'name', label: 'Name' }, { key: 'hosts', label: 'Hosts' }, { key: 'address', label: 'Adresse' }, { key: 'age', label: 'Alter', age: true }],
  nodes: [{ key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'roles', label: 'Rollen' },
    { key: 'cpu', label: 'CPU', usage: 'cpu' }, { key: 'memory', label: 'RAM', usage: 'memory' }, { key: 'pods', label: 'Pods', numeric: true },
    { key: 'version', label: 'Kubelet' }],
  events: [{ key: 'type', label: 'Typ' }, { key: 'reason', label: 'Grund' }, { key: 'object', label: 'Objekt' },
    { key: 'message', label: 'Meldung' }, { key: 'count', label: 'Anzahl', numeric: true }, { key: 'last', label: 'Zuletzt', age: true }],
};

export interface NodeTile {
  name: string;
  ready: boolean;
  roles: string[];
  /** Conditions MemoryPressure / DiskPressure / PIDPressure that are True. */
  pressure: string[];
  unschedulable: boolean;
  ip?: string;
  /** Share of allocatable, 0..1; absent without metrics. */
  cpu?: number;
  memory?: number;
}

export interface Usage { cpuMilli: number; memoryBytes: number }
/** Samples per pod refKey, oldest first, at most 20. */
export type UsageHistory = Record<string, Usage[]>;

export type ProblemKind = 'crashloop' | 'oomkilled' | 'image' | 'pending' | 'node';
export interface KubeProblem { id: string; kind: ProblemKind; ref: KubeRef; message: string }

export type ClusterState = 'connecting' | 'ready' | 'reconnecting' | 'error';
export interface ClusterStatus {
  state: ClusterState;
  name: string;
  production: boolean;
  readOnly: boolean;
  /** Name of the SSH connection carrying the tunnel. */
  host?: string;
  message?: string;
  /** metrics.k8s.io answered. */
  metrics: boolean;
  /** Namespace a fresh view opens in: vault setting, else the kubeconfig context, else `default`. Absent until known. */
  namespace?: string;
}

export interface KubeOverview { nodes: NodeTile[]; problems: KubeProblem[]; namespaces: string[] }
/** Reply of `k8s:open`: the events sent before the reply are lost on the renderer side, so the current state comes along. */
export interface KubeOpenResult { viewId: string; status: ClusterStatus; overview?: KubeOverview }

export type KubeEvent =
  | { type: 'status'; viewId: string; status: ClusterStatus }
  | { type: 'rows'; viewId: string; query: KubeQuery; reset: boolean; upserts: KubeRow[]; deletes: string[] }
  | { type: 'overview'; viewId: string; nodes: NodeTile[]; problems: KubeProblem[]; namespaces: string[] }
  | { type: 'usage'; viewId: string; pods: UsageHistory }
  /** Why a table cannot load or stay live; `message` absent = trouble is over. */
  | { type: 'trouble'; viewId: string; query: KubeQuery; message?: string };

export type KubeDetailMode = 'yaml' | 'describe' | 'events';
export type KubeDetail = { mode: 'yaml' | 'describe'; text: string } | { mode: 'events'; rows: KubeRow[] };
export type KubeAction = 'restart' | 'scale' | 'delete' | 'cordon' | 'uncordon' | 'suspend' | 'resume' | 'trigger';
export const ACTION_KINDS: Record<KubeAction, KubeKind[]> = {
  restart: ['deployments', 'statefulsets', 'daemonsets'], scale: ['deployments', 'statefulsets'], delete: ['pods', 'jobs'],
  cordon: ['nodes'], uncordon: ['nodes'], suspend: ['cronjobs'], resume: ['cronjobs'], trigger: ['cronjobs'],
};
export const NOT_CONNECTED_MESSAGE = 'Der Cluster ist gerade nicht verbunden.';

/** Name of a job started by hand from a CronJob: `<cron>-manual-<unix>`, cut to 63 chars, DNS-1123, never ending in '-'. The suffix always stays whole. */
export function manualJobName(cron: string, unix: number): string {
  const suffix = `-manual-${unix}`;
  return cron.slice(0, 63 - suffix.length).replace(/[-.]+$/, '') + suffix;
}

export interface KubeOpenRequest { clusterId: string }
export interface KubeViewRequest { viewId: string }
export interface KubeSubscribeRequest { viewId: string; query: KubeQuery }
export interface KubeDetailRequest { viewId: string; ref: KubeRef; mode: KubeDetailMode }
export interface KubeActionRequest { viewId: string; ref: KubeRef; action: KubeAction; replicas?: number }
export interface KubeProbeRequest { connectionId: string }
export interface KubeProbeResult { source: string; contexts: string[]; currentContext?: string; clusterName?: string }

export type KubeTerminalMode = 'logs' | 'previous' | 'shell';
export interface KubeTerminalTarget { namespace: string; pod: string; container: string; mode: KubeTerminalMode }

export type DockMode = 'logs' | 'shell' | 'events' | 'yaml' | 'describe';
/** Saved state of a cluster tab in a workspace. */
/** Saved filter of one kind; both fields optional, absent = empty. */
export interface KubeFilterSnapshot { text?: string; chips?: string[] }
export interface KubeViewSnapshot { query: KubeQuery; crumbs: string[]; selected?: string; dock: DockMode;
  filters?: Partial<Record<KubeKind, KubeFilterSnapshot>> }
