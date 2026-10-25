import { describe, expect, it } from 'vitest';
import type { KubeKind, KubeRef, KubeSelector, NodeTile, UsageHistory } from '../../shared/kubernetes';
import type { KubeApi, KubeApiError, KubeObject, ListResult, MetricsSample, WatchHandle, WatchType } from './api';
import { Overview, type OverviewState } from './overview';

const settle = () => new Promise(resolve => setImmediate(resolve));
const NOW = Date.parse('2026-10-16T10:00:00Z');
const GI = 1024 ** 3;

class FakeClock {
  now = 0;
  private timers: { id: number; at: number; fn: () => void }[] = [];
  private nextId = 1;

  schedule = (fn: () => void, ms: number): unknown => {
    const id = this.nextId++;
    this.timers.push({ id, at: this.now + ms, fn });
    return id;
  };

  cancel = (handle: unknown): void => {
    this.timers = this.timers.filter(timer => timer.id !== handle);
  };

  advance(ms: number): void {
    const target = this.now + ms;
    for (;;) {
      const due = this.timers.filter(timer => timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.timers = this.timers.filter(timer => timer !== due);
      this.now = due.at;
      due.fn();
    }
    this.now = target;
  }
}

class FakeApi implements KubeApi {
  lists: Partial<Record<KubeKind, KubeObject[]>> = {};
  listKinds: KubeKind[] = [];
  watchKinds: KubeKind[] = [];
  nodeSamples: MetricsSample[] | null = [];
  podSamples: MetricsSample[] | null = [];
  metricsCalls: (string | null)[] = [];
  async list(kind: KubeKind): Promise<ListResult> {
    this.listKinds.push(kind);
    return { items: this.lists[kind] ?? [], resourceVersion: '1' };
  }
  async watch(kind: KubeKind, _namespace: string | null, _selector: KubeSelector | undefined, _rv: string,
    _onEvent: (type: WatchType, object: KubeObject) => void, _onEnd: (error?: KubeApiError) => void): Promise<WatchHandle> {
    this.watchKinds.push(kind);
    return { stop: () => undefined };
  }
  async nodeMetrics(): Promise<MetricsSample[] | null> { return this.nodeSamples; }
  async podMetrics(namespace: string | null): Promise<MetricsSample[] | null> {
    this.metricsCalls.push(namespace);
    return this.podSamples;
  }
  read(_ref: KubeRef): never { throw new Error('unused'); }
  eventsFor(): never { throw new Error('unused'); }
  mergePatch(): never { throw new Error('unused'); }
  remove(): never { throw new Error('unused'); }
  createJobFrom(): never { throw new Error('unused'); }
  openTerminal(): never { throw new Error('unused'); }
  portForward(): never { throw new Error('unused'); }
  followLog(): never { throw new Error('unused'); }
  readLog(): never { throw new Error('unused'); }
  rulesReview(): never { throw new Error('unused'); }
  readArgoApp(): never { throw new Error('unused'); }
}

function pod(name: string, namespace: string, extra: Record<string, unknown> = {}): KubeObject {
  return {
    apiVersion: 'v1', kind: 'Pod',
    metadata: { uid: `uid-${namespace}-${name}`, name, namespace, creationTimestamp: new Date(NOW - 60_000).toISOString() },
    status: { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 0, state: { running: {} } }] },
    ...extra,
  };
}

function node(name: string, ready = true): KubeObject {
  return {
    apiVersion: 'v1', kind: 'Node',
    metadata: { uid: `node-${name}`, name, labels: { 'node-role.kubernetes.io/worker': '' } },
    status: {
      conditions: [{ type: 'Ready', status: ready ? 'True' : 'False' }],
      allocatable: { cpu: '2', memory: '4Gi' },
    },
  };
}

function setup(api = new FakeApi()) {
  const clock = new FakeClock();
  const states: OverviewState[] = [];
  const usage: UsageHistory[] = [];
  const metrics: boolean[] = [];
  const overview = new Overview(api, state => states.push(state), history => usage.push(history),
    available => metrics.push(available), { now: () => NOW, schedule: clock.schedule, cancel: clock.cancel });
  return { api, clock, states, usage, metrics, overview };
}

describe('Overview', () => {
  it('starts pods and nodes watches and derives namespaces from pods plus default', async () => {
    const api = new FakeApi();
    api.lists.pods = [pod('a', 'shop'), pod('b', 'shop'), pod('c', 'monitoring')];
    const { overview } = setup(api);

    await overview.start();

    expect([...api.listKinds].sort()).toEqual(['nodes', 'pods']);
    expect([...api.watchKinds].sort()).toEqual(['nodes', 'pods']);
    expect(overview.current().namespaces).toEqual(['default', 'monitoring', 'shop']);
    overview.stop();
  });

  it('emits nodes with usage and problems in one batch', async () => {
    const api = new FakeApi();
    api.lists.nodes = [node('n1'), node('n2', false)];
    api.lists.pods = [pod('crash', 'shop', {
      status: { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 4, state: { waiting: { reason: 'CrashLoopBackOff' } } }] },
    })];
    api.nodeSamples = [{ name: 'n1', cpuMilli: 500, memoryBytes: GI }];
    api.podSamples = [];
    const { clock, states, overview } = setup(api);

    await overview.start();
    await settle();
    clock.advance(250);

    const last = states[states.length - 1];
    const n1 = last.nodes.find(tile => tile.name === 'n1') as NodeTile;
    expect(n1.cpu).toBe(0.25);
    expect(n1.memory).toBe(0.25);
    expect(last.nodes.find(tile => tile.name === 'n2')?.ready).toBe(false);
    expect(last.problems.map(problem => problem.kind)).toEqual(['node', 'crashloop']);
    overview.stop();
  });

  it('gives the nodes table CPU and RAM shares as text, and nothing without metrics', async () => {
    const api = new FakeApi();
    api.lists.nodes = [node('n1')];
    api.nodeSamples = [{ name: 'n1', cpuMilli: 500, memoryBytes: GI }];
    api.podSamples = [];
    const { overview } = setup(api);
    await overview.start();
    await settle();
    expect(overview.nodeUsageCells()).toEqual({ n1: { cpu: '25%', memory: '25%' } });
    overview.stop();

    const bare = setup(new FakeApi());
    expect(bare.overview.nodeUsageCells()).toEqual({});
  });

  it('reports metrics availability and keeps at most 20 usage samples per pod', async () => {
    const api = new FakeApi();
    api.lists.pods = [pod('p1', 'shop')];
    api.lists.nodes = [node('n1')];
    const { clock, usage, metrics, overview } = setup(api);

    api.podSamples = [{ namespace: 'shop', name: 'p1', cpuMilli: 1, memoryBytes: 1 }];
    await overview.start();
    await settle();
    expect(metrics).toEqual([true]);
    expect(usage[0]['pods/shop/p1']).toEqual([{ cpuMilli: 1, memoryBytes: 1 }]);

    for (let i = 2; i <= 21; i++) {
      api.podSamples = [{ namespace: 'shop', name: 'p1', cpuMilli: i, memoryBytes: 1 }];
      clock.advance(15_000);
      await settle();
    }
    const history = usage[usage.length - 1]['pods/shop/p1'];
    expect(history).toHaveLength(20);
    expect(history[0].cpuMilli).toBe(2);
    expect(history[19].cpuMilli).toBe(21);
    overview.stop();
  });

  it('reports unavailable metrics and leaves tiles without cpu and memory', async () => {
    const api = new FakeApi();
    api.lists.nodes = [node('n1')];
    api.nodeSamples = null;
    api.podSamples = null;
    const { states, metrics, usage, overview } = setup(api);

    await overview.start();
    await settle();

    expect(metrics).toEqual([false]);
    expect(usage).toEqual([]);
    expect(overview.current().nodes[0]).not.toHaveProperty('cpu');
    expect(overview.current().nodes[0]).not.toHaveProperty('memory');
    expect(states[states.length - 1].nodes[0]).not.toHaveProperty('cpu');
    overview.stop();
  });

  it('polls metrics for the chosen usage namespace every 15 s', async () => {
    const api = new FakeApi();
    const { clock, overview } = setup(api);

    await overview.start();
    await settle();
    overview.setUsageNamespace('shop');
    clock.advance(15_000);
    await settle();

    expect(api.metricsCalls).toEqual([null, 'shop']);
    overview.stop();
  });

  it('counts running pods per node', async () => {
    const api = new FakeApi();
    api.lists.pods = [
      pod('a', 'shop', { spec: { nodeName: 'n1' } }),
      pod('b', 'shop', { spec: { nodeName: 'n1' } }),
      pod('done', 'shop', { spec: { nodeName: 'n1' }, status: { phase: 'Succeeded' } }),
      pod('failed', 'shop', { spec: { nodeName: 'n2' }, status: { phase: 'Failed' } }),
      pod('unscheduled', 'shop', { spec: {} }),
    ];
    const { overview } = setup(api);

    await overview.start();

    expect(overview.podCounts()).toEqual({ n1: 2 });
    overview.stop();
  });

  it('stop ends the watchers and the metrics timer', async () => {
    const api = new FakeApi();
    const { clock, states, overview } = setup(api);
    await overview.start();
    await settle();
    const calls = api.metricsCalls.length;
    const emitted = states.length;

    overview.stop();
    clock.advance(60_000);
    await settle();

    expect(api.metricsCalls).toHaveLength(calls);
    expect(states).toHaveLength(emitted);
  });
});
