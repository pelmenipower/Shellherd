/** Kubernetes cluster tab; see docs/superpowers/specs/2026-10-16-kubernetes-integration-design.md. */
import type { CodedError } from './errors';

/** DNS-1123 subdomain: namespaces, pods, workloads, containers and nodes. */
export const KUBE_NAME = /^[a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?$/;
/** Label key with optional prefix, and label value; no commas or operators. */
export const LABEL_KEY = /^([a-z0-9]([-a-z0-9.]{0,251}[a-z0-9])?\/)?[A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?$/;
export const LABEL_VALUE = /^([A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?)?$/;
export const MAX_REPLICAS = 1000;

export const KUBE_KINDS = ['pods', 'deployments', 'statefulsets', 'daemonsets', 'jobs', 'cronjobs', 'services', 'ingresses', 'nodes', 'events'] as const;
export type KubeKind = typeof KUBE_KINDS[number];

export interface KindInfo { label: string; apiVersion: string; kind: string; namespaced: boolean }
export const KIND_INFO: Record<KubeKind, KindInfo> = {
  pods: { label: 'Pods', apiVersion: 'v1', kind: 'Pod', namespaced: true },
  deployments: { label: 'Deployments', apiVersion: 'apps/v1', kind: 'Deployment', namespaced: true },
  statefulsets: { label: 'StatefulSets', apiVersion: 'apps/v1', kind: 'StatefulSet', namespaced: true },
  daemonsets: { label: 'DaemonSets', apiVersion: 'apps/v1', kind: 'DaemonSet', namespaced: true },
  jobs: { label: 'Jobs', apiVersion: 'batch/v1', kind: 'Job', namespaced: true },
  cronjobs: { label: 'CronJobs', apiVersion: 'batch/v1', kind: 'CronJob', namespaced: true },
  services: { label: 'Services', apiVersion: 'v1', kind: 'Service', namespaced: true },
  ingresses: { label: 'Ingress', apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', namespaced: true },
  nodes: { label: 'Nodes', apiVersion: 'v1', kind: 'Node', namespaced: false },
  events: { label: 'Events', apiVersion: 'v1', kind: 'Event', namespaced: true },
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
/** A TCP port of a pod container or a service, with its name when the manifest names it. */
export interface KubePort { port: number; name?: string }
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
  /** Pods: TCP ports of all containers; services: TCP service ports. Absent when there are none. */
  ports?: KubePort[];
}

/** Labels come from `columnLabel(key)` in renderer/kube-labels.ts. */
export interface ColumnInfo { key: string; numeric?: boolean; age?: boolean; usage?: 'cpu' | 'memory' }
export const KIND_COLUMNS: Record<KubeKind, ColumnInfo[]> = {
  pods: [{ key: 'name' }, { key: 'ready' }, { key: 'status' },
    { key: 'restarts', numeric: true }, { key: 'cpu', usage: 'cpu' }, { key: 'memory', usage: 'memory' },
    { key: 'node' }, { key: 'age', age: true }],
  deployments: [{ key: 'name' }, { key: 'ready' }, { key: 'upToDate', numeric: true },
    { key: 'image' }, { key: 'age', age: true }],
  statefulsets: [{ key: 'name' }, { key: 'ready' }, { key: 'upToDate', numeric: true },
    { key: 'image' }, { key: 'age', age: true }],
  daemonsets: [{ key: 'name' }, { key: 'ready' }, { key: 'upToDate', numeric: true },
    { key: 'image' }, { key: 'age', age: true }],
  jobs: [{ key: 'name' }, { key: 'completions' }, { key: 'status' },
    { key: 'lastRun', age: true }, { key: 'age', age: true }],
  cronjobs: [{ key: 'name' }, { key: 'schedule' }, { key: 'lastRun', age: true },
    { key: 'age', age: true }],
  services: [{ key: 'name' }, { key: 'type' }, { key: 'clusterIp' },
    { key: 'ports' }, { key: 'age', age: true }],
  ingresses: [{ key: 'name' }, { key: 'hosts' }, { key: 'address' }, { key: 'age', age: true }],
  nodes: [{ key: 'name' }, { key: 'status' }, { key: 'roles' },
    { key: 'cpu', usage: 'cpu' }, { key: 'memory', usage: 'memory' }, { key: 'pods', numeric: true },
    { key: 'version' }],
  events: [{ key: 'type' }, { key: 'reason' }, { key: 'object' },
    { key: 'message' }, { key: 'count', numeric: true }, { key: 'last', age: true }],
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
export interface KubeProblem { id: string; kind: ProblemKind; ref: KubeRef; error: CodedError }

export type ClusterState = 'connecting' | 'ready' | 'reconnecting' | 'error';
export interface ClusterStatus {
  state: ClusterState;
  name: string;
  production: boolean;
  readOnly: boolean;
  /** Name of the SSH connection carrying the tunnel. */
  host?: string;
  error?: CodedError;
  /** metrics.k8s.io answered. */
  metrics: boolean;
  /** Namespace a fresh view opens in: vault setting, else the kubeconfig context, else `default`. Absent until known. */
  namespace?: string;
  /** Number of the running or next reconnect attempt, 1-based; only with state 'reconnecting'. */
  attempt?: number;
  /** Name of the SSH connection the current attempt goes through; absent between attempts. */
  trying?: string;
}

export interface KubeOverview { nodes: NodeTile[]; problems: KubeProblem[]; namespaces: string[] }
/** Reply of `k8s:open`: the events sent before the reply are lost on the renderer side, so the current state comes along. */
export interface KubeOpenResult { viewId: string; status: ClusterStatus; overview?: KubeOverview }

export type KubeEvent =
  | { type: 'status'; viewId: string; status: ClusterStatus }
  | { type: 'rows'; viewId: string; query: KubeQuery; reset: boolean; upserts: KubeRow[]; deletes: string[] }
  | { type: 'overview'; viewId: string; nodes: NodeTile[]; problems: KubeProblem[]; namespaces: string[] }
  | { type: 'usage'; viewId: string; pods: UsageHistory }
  /** Why a table cannot load or stay live; `error` absent = trouble is over. */
  | { type: 'trouble'; viewId: string; query: KubeQuery; error?: CodedError }
  /** The port forwards of the view, complete; sent on every change. */
  | { type: 'forwards'; viewId: string; forwards: KubeForwardStatus[] }
  /** A batch of the logs of all pods of run `id`: sources complete, lines new since the last batch, dropped = lines skipped so far. */
  | { type: 'logs'; viewId: string; id: string; lines: KubeLogLine[]; sources: KubeLogSource[]; waiting: number; full: number; dropped: number; error?: CodedError };

export type KubeDetailMode = 'yaml' | 'describe' | 'events';
export type KubeDetail = { mode: 'yaml' | 'describe'; text: string } | { mode: 'events'; rows: KubeRow[] };
export type KubeAction = 'restart' | 'scale' | 'delete' | 'cordon' | 'uncordon' | 'suspend' | 'resume' | 'trigger';
export const ACTION_KINDS: Record<KubeAction, KubeKind[]> = {
  restart: ['deployments', 'statefulsets', 'daemonsets'], scale: ['deployments', 'statefulsets'], delete: ['pods', 'jobs'],
  cordon: ['nodes'], uncordon: ['nodes'], suspend: ['cronjobs'], resume: ['cronjobs'], trigger: ['cronjobs'],
};

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
/** Port-forward target: a pod port, or a service port that main resolves to a ready pod. */
export interface KubeForwardTarget { kind: 'pods' | 'services'; namespace: string; name: string; port: number }
/** localPort 0 = any free port; the listener is always 127.0.0.1. */
export interface KubeForwardStartRequest { viewId: string; target: KubeForwardTarget; localPort: number }
export interface KubeForwardStopRequest { viewId: string; forwardId: string }
/** One running port forward of a cluster view, as main reports it. */
export interface KubeForwardStatus {
  id: string;
  target: KubeForwardTarget;
  /** The port on 127.0.0.1. */
  localPort: number;
  /** Pod and port the last opened connection reached; for services where they resolved to. */
  pod?: string;
  podPort?: number;
  /** Connections open right now, including those still opening. */
  open: number;
  /** Why the last connection failed; cleared by the next one that opens. */
  error?: CodedError;
}

/** Kinds whose pods "Logs aller Pods" shows, found by the row's selector. */
export const LOGS_ALL_KINDS: readonly KubeKind[] = ['deployments', 'statefulsets', 'daemonsets', 'jobs', 'services'];
/** Log streams open at once per view, container sources kept per run, lines read back per container at the start. */
export const MAX_LOG_STREAMS = 20;
export const MAX_LOG_SOURCES = 100;
export const LOG_TAIL_LINES = 200;
/** One line of the logs of all pods. `source` indexes the sources of the run; `time` is the server timestamp with nine fraction digits, '' when unknown. */
export interface KubeLogLine { source: number; time: string; text: string }
/** One container of the logs of all pods. live: its stream is open; error: why its stream ended early. */
export interface KubeLogSource { pod: string; container: string; live: boolean; error?: CodedError }
/** `id` is chosen by the renderer (UUID), so events of an old run can be told apart. */
export interface KubeLogsStartRequest { viewId: string; id: string; namespace: string; selector: Record<string, string>; format: 'compact' | 'raw' }
export interface KubeLogsStopRequest { viewId: string; id: string }
export interface KubeAccessRequest { viewId: string; namespace: string }

export type KubeTerminalMode = 'logs' | 'previous' | 'shell';
export interface KubeTerminalTarget { namespace: string; pod: string; container: string; mode: KubeTerminalMode;
  /** Log rendering for the logs and previous modes; compact when absent. */
  format?: 'compact' | 'raw' }

export type DockMode = 'logs' | 'shell' | 'events' | 'yaml' | 'describe';
/** Group-by options of the cluster table; the per-kind subset is GROUP_OPTIONS in kube-columns.ts. */
export const GROUP_BY_IDS = ['namespace', 'node', 'status', 'owner', 'roles', 'type', 'reason', 'objectKind'] as const;
export type GroupBy = typeof GROUP_BY_IDS[number];
/** Limits of the saved view; the reducer keeps the state inside them so the vault schema never rejects a snapshot. */
export const MAX_COLUMN_FILTERS = 12;
export const MAX_COLUMN_FILTER_LENGTH = 100;
export const MAX_COLLAPSED = 50;
export const MAX_GROUP_KEY_LENGTH = 300;

/** Saved filter and grouping of one kind; every field optional, absent = empty / no grouping. */
export interface KubeFilterSnapshot {
  text?: string;
  chips?: string[];
  /** Column key -> filter text as typed. */
  columns?: Record<string, string>;
  groupBy?: GroupBy;
  /** Keys of collapsed groups ('' = "(ohne)"). */
  collapsed?: string[];
}
/** Saved state of a cluster tab in a workspace. */
export interface KubeViewSnapshot { query: KubeQuery; crumbs: string[]; selected?: string; dock: DockMode;
  filters?: Partial<Record<KubeKind, KubeFilterSnapshot>>; logFormat?: 'compact' | 'raw' }
