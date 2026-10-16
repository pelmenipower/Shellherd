import type { KubeProblem, NodeTile, Usage, UsageHistory } from '../../shared/kubernetes';
import { refKey } from '../../shared/kubernetes';
import type { KubeApi, KubeObject, MetricsSample } from './api';
import { detectProblems } from './problems';
import { toNodeTile } from './rows';
import { BATCH_MS, ResourceWatcher, defaultCancel, defaultSchedule } from './watch';

export const METRICS_MS = 15_000;
const HISTORY_MAX = 20;

export interface OverviewState { nodes: NodeTile[]; problems: KubeProblem[]; namespaces: string[] }

export interface OverviewOptions {
  now?: () => number;
  metricsMs?: number;
  batchMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

interface Timer { handle: unknown }

/**
 * Cluster overview: node tiles, problems, namespaces, and CPU/RAM usage from metrics.k8s.io.
 * Pods and nodes are watched; metrics are polled every 15 s.
 */
export class Overview {
  private pods: KubeObject[] = [];
  private nodes: KubeObject[] = [];
  private nodeUsage = new Map<string, Usage>();
  private history: UsageHistory = {};
  private usageNamespace: string | null = null;
  private readonly now: () => number;
  private readonly metricsMs: number;
  private readonly batchMs: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly podWatcher: ResourceWatcher;
  private readonly nodeWatcher: ResourceWatcher;
  private emitTimer: Timer | undefined;
  private metricsTimer: Timer | undefined;
  private stopped = false;

  constructor(private readonly api: KubeApi,
    private readonly emit: (overview: OverviewState) => void,
    private readonly emitUsage: (pods: UsageHistory) => void,
    private readonly onMetrics: (available: boolean) => void, options: OverviewOptions = {}) {
    this.now = options.now ?? Date.now;
    this.metricsMs = options.metricsMs ?? METRICS_MS;
    this.batchMs = options.batchMs ?? BATCH_MS;
    this.schedule = options.schedule ?? defaultSchedule;
    this.cancel = options.cancel ?? defaultCancel;
    const watchOptions = {
      batchMs: this.batchMs, schedule: this.schedule, cancel: this.cancel,
    };
    const ignore = () => undefined;
    this.podWatcher = new ResourceWatcher(api, { kind: 'pods', namespace: null }, ignore, ignore,
      { ...watchOptions, onObjects: objects => { this.pods = objects; this.scheduleEmit(); } });
    this.nodeWatcher = new ResourceWatcher(api, { kind: 'nodes', namespace: null }, ignore, ignore,
      { ...watchOptions, onObjects: objects => { this.nodes = objects; this.scheduleEmit(); } });
  }

  async start(): Promise<void> {
    this.stopped = false;
    await Promise.all([this.podWatcher.start(), this.nodeWatcher.start()]);
    if (this.stopped) return;
    void this.pollMetrics();
  }

  stop(): void {
    this.stopped = true;
    this.podWatcher.stop();
    this.nodeWatcher.stop();
    if (this.emitTimer) this.cancel(this.emitTimer.handle);
    if (this.metricsTimer) this.cancel(this.metricsTimer.handle);
    this.emitTimer = undefined;
    this.metricsTimer = undefined;
  }

  /** Pod refKeys of the visible namespace for usage; null = all. */
  setUsageNamespace(namespace: string | null): void {
    this.usageNamespace = namespace;
  }

  current(): OverviewState {
    const nodes = [...this.nodes]
      .sort((a, b) => compareNames(a, b))
      .map(node => toNodeTile(node, this.nodeUsage.get(node.metadata?.name ?? '')));
    const problems = detectProblems(this.pods, this.nodes, this.now());
    const namespaces = [...new Set(['default', ...this.pods.map(pod => pod.metadata?.namespace)
      .filter((ns): ns is string => typeof ns === 'string' && ns !== '')])].sort();
    return { nodes, problems, namespaces };
  }

  /** Running pods per node name (for the Nodes table's `pods` cell). */
  podCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const pod of this.pods) {
      const node = (pod.spec as { nodeName?: string } | undefined)?.nodeName;
      const phase = (pod.status as { phase?: string } | undefined)?.phase;
      if (!node || phase === 'Succeeded' || phase === 'Failed') continue;
      counts[node] = (counts[node] ?? 0) + 1;
    }
    return counts;
  }

  private async pollMetrics(): Promise<void> {
    this.metricsTimer = undefined;
    if (this.stopped) return;
    let nodeSamples: MetricsSample[] | null;
    let podSamples: MetricsSample[] | null;
    try {
      [nodeSamples, podSamples] = await Promise.all([this.api.nodeMetrics(), this.api.podMetrics(this.usageNamespace)]);
    } catch {
      this.scheduleMetrics();
      return;
    }
    if (this.stopped) return;

    if (nodeSamples !== null && podSamples !== null) {
      this.onMetrics(true);
      this.nodeUsage = new Map(nodeSamples.map(sample => [sample.name, toUsage(sample)]));
      const next: UsageHistory = {};
      for (const sample of podSamples) {
        const key = refKey({ kind: 'pods', namespace: sample.namespace, name: sample.name });
        next[key] = [...(this.history[key] ?? []), toUsage(sample)].slice(-HISTORY_MAX);
      }
      this.history = next;
      this.emitUsage(next);
    } else {
      this.onMetrics(false);
      this.nodeUsage = new Map();
      this.history = {};
    }
    this.emitState();
    this.scheduleMetrics();
  }

  private scheduleMetrics(): void {
    if (this.stopped) return;
    this.metricsTimer = { handle: this.schedule(() => { void this.pollMetrics(); }, this.metricsMs) };
  }

  private scheduleEmit(): void {
    if (this.stopped || this.emitTimer) return;
    this.emitTimer = {
      handle: this.schedule(() => {
        this.emitTimer = undefined;
        this.emitState();
      }, this.batchMs),
    };
  }

  private emitState(): void {
    if (!this.stopped) this.emit(this.current());
  }
}

const toUsage = (sample: MetricsSample): Usage => ({ cpuMilli: sample.cpuMilli, memoryBytes: sample.memoryBytes });

const compareNames = (a: KubeObject, b: KubeObject): number => {
  const x = a.metadata?.name ?? '';
  const y = b.metadata?.name ?? '';
  return x < y ? -1 : x > y ? 1 : 0;
};
