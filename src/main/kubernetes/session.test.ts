import { describe as suite, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { KubeConfig } from '@kubernetes/client-node';
import type { KubernetesConnectionNode } from '../../shared/vault/types';
import type { KubeEvent, KubeKind, KubeQuery, KubeRef, KubeTerminalTarget } from '../../shared/kubernetes';
import { HostAccessError } from '../containers/runner';
import { KubeApiError } from './api';
import type { KubeApi, KubeObject, KubeStream, ListResult, MetricsSample, TerminalIo, WatchHandle, WatchType } from './api';
import type { ClusterAccess } from './access';
import { describe as describeText, toYaml } from './describe';
import { toRow } from './rows';
import { KubeSessions, HEALTH_MS, userError } from './session';
import type { KubeSessionDependencies } from './session';

const POD_QUERY: KubeQuery = { kind: 'pods', namespace: 'shop' };
const NODE_QUERY: KubeQuery = { kind: 'nodes', namespace: null };
const NOT_AVAILABLE = 'kubernetes.viewUnavailable';
const codeOf = (code: string) => expect.objectContaining({ code });
const KUBECONFIG = `apiVersion: v1
kind: Config
clusters:
- name: k8s
  cluster:
    server: https://k8s-cp1:6443
    certificate-authority-data: Y2E=
contexts:
- name: admin@k8s
  context:
    cluster: k8s
    user: admin
    namespace: shop
users:
- name: admin
  user:
    token: secret-token
current-context: admin@k8s
`;

const settle = () => new Promise(resolve => setImmediate(resolve));

/** Fake timers: nothing runs until the test asks for it. */
class Clock {
  private next = 1;
  readonly tasks = new Map<number, { fn: () => void; ms: number }>();
  readonly schedule = (fn: () => void, ms: number): unknown => {
    const id = this.next++;
    this.tasks.set(id, { fn, ms });
    return id;
  };
  readonly cancel = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };
  delays(): number[] {
    return [...this.tasks.values()].map(task => task.ms);
  }
  /** Runs the oldest pending task with this delay. */
  run(ms: number): void {
    const entry = [...this.tasks.entries()].find(([, task]) => task.ms === ms);
    if (!entry) throw new Error(`no pending task with ${ms} ms`);
    this.tasks.delete(entry[0]);
    entry[1].fn();
  }
}

interface WatchRecord { kind: KubeKind; namespace: string | null; stop: Mock; end: (error?: KubeApiError) => void }

class FakeApi implements KubeApi {
  pods: KubeObject[] = [];
  nodes: KubeObject[] = [];
  object: KubeObject = { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'api', namespace: 'shop', uid: 'd1' }, spec: { replicas: 2 }, status: {} };
  eventObjects: KubeObject[] = [];
  lists: { kind: KubeKind; namespace: string | null }[] = [];
  listErrors: Error[] = [];
  watches: WatchRecord[] = [];
  patches: object[] = [];
  removed: KubeRef[] = [];
  created: { cron: KubeRef; jobName: string }[] = [];
  terminals: { target: KubeTerminalTarget; size: { cols: number; rows: number } }[] = [];
  streams: { close: Mock }[] = [];

  async list(kind: KubeKind, namespace: string | null): Promise<ListResult> {
    this.lists.push({ kind, namespace });
    const error = this.listErrors.shift();
    if (error) throw error;
    const items = kind === 'pods' ? this.pods : kind === 'nodes' ? this.nodes : [];
    return { items, resourceVersion: '1' };
  }

  async watch(kind: KubeKind, namespace: string | null, _selector: unknown, _resourceVersion: string,
    _onEvent: (type: WatchType, object: KubeObject) => void, onEnd: (error?: KubeApiError) => void): Promise<WatchHandle> {
    const record: WatchRecord = { kind, namespace, stop: vi.fn(), end: onEnd };
    this.watches.push(record);
    return { stop: record.stop };
  }

  async read(_ref: KubeRef): Promise<KubeObject> {
    return this.object;
  }

  async eventsFor(_ref: KubeRef): Promise<KubeObject[]> {
    return this.eventObjects;
  }

  async mergePatch(_ref: KubeRef, body: object): Promise<void> {
    this.patches.push(body);
  }

  async remove(ref: KubeRef): Promise<void> {
    this.removed.push(ref);
  }

  async createJobFrom(cron: KubeRef, jobName: string): Promise<void> {
    this.created.push({ cron, jobName });
  }

  async nodeMetrics(): Promise<MetricsSample[] | null> {
    return null;
  }

  async podMetrics(): Promise<MetricsSample[] | null> {
    return null;
  }

  async openTerminal(target: KubeTerminalTarget, size: { cols: number; rows: number }, _io: TerminalIo): Promise<KubeStream> {
    this.terminals.push({ target, size });
    const close = vi.fn();
    this.streams.push({ close });
    return { write: vi.fn(), resize: vi.fn(), pause: vi.fn(), resume: vi.fn(), close };
  }
}

interface FakeAccess { access: ClusterAccess; closeHost: Mock; drop: () => void }

function fakeAccess(): FakeAccess {
  let closed = false;
  const closeHost = vi.fn(() => { closed = true; });
  const host = { get closed() { return closed; }, run: vi.fn(), forward: vi.fn(), close: closeHost };
  const access = {
    host,
    connection: { id: 'h1', type: 'connection', name: 'k8s-cp1', protocol: 'ssh', host: '10.0.0.10', port: 22, tags: [] },
    kubeconfig: KUBECONFIG,
    source: 'auto',
  } as unknown as ClusterAccess;
  return { access, closeHost, drop: () => { closed = true; } };
}

const pod = (name: string, node = 'n1'): KubeObject => ({
  metadata: { name, namespace: 'shop', uid: `pod-${name}`, creationTimestamp: '2026-10-01T00:00:00Z' },
  spec: { nodeName: node, containers: [{ name: 'app' }] },
  status: { phase: 'Running', containerStatuses: [{ name: 'app', ready: true, restartCount: 0, state: { running: {} } }] },
});

const node = (name: string): KubeObject => ({
  metadata: { name, uid: `node-${name}`, creationTimestamp: '2026-09-01T00:00:00Z', labels: { 'node-role.kubernetes.io/control-plane': '' } },
  spec: {},
  status: { conditions: [{ type: 'Ready', status: 'True' }], allocatable: { cpu: '2', memory: '4Gi' }, nodeInfo: { kubeletVersion: 'v1.30.0' } },
});

function setup(overrides: Partial<KubeSessionDependencies> = {}) {
  const clock = new Clock();
  const cluster = {
    id: 'c1', type: 'connection', name: 'Prod-Cluster', tags: [], protocol: 'kubernetes', accessHosts: ['h1'],
    kubeconfig: { source: 'auto' }, production: true, readOnly: false,
  } as KubernetesConnectionNode;
  const api = new FakeApi();
  const accesses: FakeAccess[] = [];
  const tunnels: { port: number; close: Mock }[] = [];
  const events: { ownerId: number; event: KubeEvent }[] = [];
  const deps: KubeSessionDependencies = {
    getCluster: vi.fn(() => cluster),
    openAccess: vi.fn(async () => {
      const next = fakeAccess();
      accesses.push(next);
      return next.access;
    }),
    openTunnel: vi.fn(async () => {
      const tunnel = { port: 40001, close: vi.fn() };
      tunnels.push(tunnel);
      return tunnel;
    }),
    createApi: vi.fn((_config: KubeConfig) => api),
    emit: (ownerId, event) => { events.push({ ownerId, event }); },
    idleMs: 1000,
    backoffMs: [10, 20, 40],
    schedule: clock.schedule,
    cancel: clock.cancel,
    ...overrides,
  };
  const sessions = new KubeSessions(deps);
  return { sessions, deps, api, clock, cluster, accesses, tunnels, events };
}

type World = ReturnType<typeof setup>;

function statusesOf(world: World, viewId: string) {
  return world.events
    .map(entry => entry.event)
    .filter((event): event is Extract<KubeEvent, { type: 'status' }> => event.type === 'status' && event.viewId === viewId)
    .map(event => event.status);
}

function eventsOf<T extends KubeEvent['type']>(world: World, type: T, viewId: string): Extract<KubeEvent, { type: T }>[] {
  return world.events
    .map(entry => entry.event)
    .filter((event): event is Extract<KubeEvent, { type: T }> => event.type === type && event.viewId === viewId);
}

const terminalIo = (): TerminalIo => ({ data: () => undefined, end: () => undefined });

suite('KubeSessions', () => {
  it('shares one access and tunnel between views and reports the status to each', async () => {
    const world = setup();
    const first = world.sessions.open(1, 'c1');
    const second = world.sessions.open(2, 'c1');
    await settle();

    expect(world.deps.openAccess).toHaveBeenCalledTimes(1);
    expect(world.deps.openTunnel).toHaveBeenCalledTimes(1);
    expect(statusesOf(world, first.viewId).map(status => status.state)).toEqual(['connecting', 'connecting', 'ready']);
    expect(statusesOf(world, second.viewId).map(status => status.state)).toEqual(['connecting', 'ready']);
    expect(statusesOf(world, second.viewId).at(-1)).toMatchObject({ state: 'ready', host: 'k8s-cp1', production: true, readOnly: false, name: 'Prod-Cluster', metrics: false });
    expect(world.events.filter(entry => entry.event.type === 'status' && entry.event.viewId === second.viewId).every(entry => entry.ownerId === 2)).toBe(true);
    expect(JSON.stringify(world.events)).not.toContain('secret-token');
  });

  it('hands a view that opens on a running session the status, the overview and the namespace in the open result', async () => {
    const world = setup();
    world.api.nodes = [node('n1')];
    world.api.pods = [pod('p1', 'n1')];
    world.sessions.open(1, 'c1');
    await settle();

    // Events sent while open() runs reach the renderer before it listens; only the result is reliable.
    const before = world.events.length;
    const second = world.sessions.open(2, 'c1');
    expect(world.events.length).toBe(before);
    expect(second.status).toMatchObject({ state: 'ready', production: true, readOnly: false, name: 'Prod-Cluster', namespace: 'shop' });
    expect(second.overview?.nodes.map(tile => tile.name)).toEqual(['n1']);
    expect(second.overview?.namespaces).toContain('shop');
  });

  it('sends status and overview again with the first subscription of a view', async () => {
    const world = setup();
    world.api.nodes = [node('n1')];
    world.sessions.open(1, 'c1');
    await settle();
    const late = world.sessions.open(2, 'c1').viewId;

    await world.sessions.subscribe(2, late, POD_QUERY);

    expect(statusesOf(world, late).at(-1)).toMatchObject({ state: 'ready', production: true });
    expect(eventsOf(world, 'overview', late)[0].nodes.map(tile => tile.name)).toEqual(['n1']);
  });

  it('opens in the vault namespace, else the kubeconfig context namespace, else all namespaces', async () => {
    const withVault = setup();
    withVault.cluster.namespace = 'ops';
    const a = withVault.sessions.open(1, 'c1');
    expect(a.status.namespace).toBe('ops');
    await settle();
    expect(statusesOf(withVault, a.viewId).at(-1)?.namespace).toBe('ops');

    const fromContext = setup();
    const b = fromContext.sessions.open(1, 'c1');
    expect(b.status.namespace).toBeUndefined();
    await settle();
    expect(statusesOf(fromContext, b.viewId).at(-1)?.namespace).toBe('shop');

    const plain = setup({ openAccess: vi.fn(async () => {
      const next = fakeAccess();
      return { ...next.access, kubeconfig: KUBECONFIG.replace('    namespace: shop\n', '') } as ClusterAccess;
    }) });
    const c = plain.sessions.open(1, 'c1');
    await settle();
    // No namespace configured anywhere: the tab shows all namespaces instead of only "default".
    expect(statusesOf(plain, c.viewId).at(-1)?.state).toBe('ready');
    expect(statusesOf(plain, c.viewId).at(-1)?.namespace).toBeUndefined();
  });

  it('reports a forbidden table at once and a generic failure after three, never with raw error text', async () => {
    const world = setup();
    const view = world.sessions.open(1, 'c1').viewId;
    await settle();
    world.api.listErrors = [Object.assign(new Error('Body: {"secret":"x"} Headers: {}'), { code: 403 })];
    await world.sessions.subscribe(1, view, { kind: 'ingresses', namespace: 'shop' });
    await settle();

    const first = eventsOf(world, 'trouble', view);
    expect(first).toHaveLength(1);
    expect(first[0].error).toEqual({ code: 'kubernetes.forbidden' });
    expect(JSON.stringify(first)).not.toContain('secret');
    // 403 is retried slowly.
    expect(world.clock.delays()).toContain(30_000);
    world.clock.run(30_000);
    await settle();
    expect(eventsOf(world, 'trouble', view).at(-1)).toEqual({ type: 'trouble', viewId: view, query: { kind: 'ingresses', namespace: 'shop' } });

    world.api.listErrors = [new Error('boom'), new Error('boom'), new Error('boom')];
    await world.sessions.subscribe(1, view, { kind: 'services', namespace: 'shop' });
    await settle();
    expect(eventsOf(world, 'trouble', view).filter(event => event.query.kind === 'services')).toHaveLength(0);
    world.clock.run(1000);
    await settle();
    world.clock.run(2000);
    await settle();
    const services = eventsOf(world, 'trouble', view).filter(event => event.query.kind === 'services');
    expect(services).toHaveLength(1);
    expect(services[0].error).toEqual({ code: 'kubernetes.liveUpdateFailed' });
    expect(JSON.stringify(services)).not.toContain('boom');
  });

  it('lets a terminal wait for a reconnect and gives up after 30 s', async () => {
    const world = setup();
    const view = world.sessions.open(1, 'c1').viewId;
    await settle();
    await world.sessions.subscribe(1, view, POD_QUERY);
    world.accesses[0].drop();
    world.clock.run(HEALTH_MS);
    expect(statusesOf(world, view).at(-1)?.state).toBe('reconnecting');

    const logs: KubeTerminalTarget = { namespace: 'shop', pod: 'p1', container: 'app', mode: 'logs' };
    const waiting = world.sessions.openTerminal('c1', logs, { cols: 80, rows: 24 }, terminalIo());
    await settle();
    expect(world.api.terminals).toEqual([]);
    world.clock.run(10);
    await settle();
    await waiting;
    expect(world.api.terminals).toHaveLength(1);

    world.accesses[1].drop();
    world.clock.run(HEALTH_MS);
    const giveUp = world.sessions.openTerminal('c1', logs, { cols: 80, rows: 24 }, terminalIo());
    const outcome = expect(giveUp).rejects.toMatchObject({ code: 'kubernetes.reconnecting' });
    world.clock.run(30_000);
    await outcome;
  });

  it('refuses disabled clusters and counts open views per window', async () => {
    const world = setup();
    world.cluster.disabled = true;
    expect(() => world.sessions.open(1, 'c1')).toThrowError(codeOf('kubernetes.disabled'));
    await expect(world.sessions.openTerminal('c1', { namespace: 'shop', pod: 'p1', container: 'app', mode: 'logs' }, { cols: 80, rows: 24 }, terminalIo()))
      .rejects.toMatchObject({ code: 'kubernetes.disabled' });

    world.cluster.disabled = false;
    expect(world.sessions.hasOwner(1)).toBe(false);
    const view = world.sessions.open(1, 'c1').viewId;
    expect(world.sessions.hasOwner(1)).toBe(true);
    expect(world.sessions.hasOwner(2)).toBe(false);
    world.sessions.close(1, view);
    expect(world.sessions.hasOwner(1)).toBe(false);
    await settle();
  });

  it('starts one watcher per distinct query and sends a late subscriber the current rows', async () => {
    const world = setup();
    world.api.pods = [pod('p1'), pod('p2')];
    const a = world.sessions.open(1, 'c1').viewId;
    const b = world.sessions.open(2, 'c1').viewId;
    await settle();
    await world.sessions.subscribe(1, a, POD_QUERY);
    await world.sessions.subscribe(2, b, POD_QUERY);
    await settle();

    const shopLists = () => world.api.lists.filter(call => call.kind === 'pods' && call.namespace === 'shop');
    expect(shopLists()).toHaveLength(1);
    expect(eventsOf(world, 'rows', b)[0]).toMatchObject({ reset: true, query: POD_QUERY });

    const late = world.sessions.open(3, 'c1').viewId;
    await settle();
    await world.sessions.subscribe(3, late, POD_QUERY);
    expect(shopLists()).toHaveLength(1);
    const lateRows = eventsOf(world, 'rows', late);
    expect(lateRows).toHaveLength(1);
    expect(lateRows[0]).toMatchObject({ reset: true, deletes: [] });
    expect(lateRows[0].upserts.map(row => row.ref.name)).toEqual(['p1', 'p2']);
    await world.sessions.subscribe(3, late, { kind: 'pods', namespace: 'other' });

    // a moves to another query while b still needs the shop watcher: it stays.
    await world.sessions.subscribe(1, a, { kind: 'pods', namespace: 'other' });
    await settle();
    const shopWatches = world.api.watches.filter(watch => watch.kind === 'pods' && watch.namespace === 'shop');
    expect(shopWatches.every(watch => !watch.stop.mock.calls.length)).toBe(true);

    // b moves too: nobody needs the shop watcher, so it stops.
    await world.sessions.subscribe(2, b, { kind: 'pods', namespace: 'other' });
    await settle();
    expect(shopWatches[0].stop).toHaveBeenCalled();
    expect(world.api.lists.filter(call => call.namespace === 'other')).toHaveLength(1);
  });

  it('puts the current pod counts into the nodes rows', async () => {
    const world = setup();
    world.api.nodes = [node('n1')];
    world.api.pods = [pod('p1', 'n1'), pod('p2', 'n1'), pod('p3', 'n2')];
    const view = world.sessions.open(1, 'c1').viewId;
    await settle();
    await world.sessions.subscribe(1, view, NODE_QUERY);
    await settle();

    const rows = eventsOf(world, 'rows', view);
    expect(rows.length).toBeGreaterThan(0);
    const cells = rows[0].upserts.map(row => row.cells);
    expect(cells).toEqual([expect.objectContaining({ name: 'n1', pods: 2 })]);
  });

  it('closes the session after the last view leaves, unless a new view comes back in time', async () => {
    const world = setup();
    const first = world.sessions.open(1, 'c1').viewId;
    await settle();
    world.sessions.close(1, first);
    expect(world.clock.delays()).toContain(1000);

    const again = world.sessions.open(1, 'c1').viewId;
    expect(world.clock.delays()).not.toContain(1000);
    world.sessions.close(1, again);
    world.clock.run(1000);

    expect(world.tunnels[0].close).toHaveBeenCalled();
    expect(world.accesses[0].closeHost).toHaveBeenCalled();
    expect(world.deps.openAccess).toHaveBeenCalledTimes(1);
  });

  it('closes only the views of the owner that closes', async () => {
    const world = setup();
    const own = world.sessions.open(1, 'c1').viewId;
    const secondView = world.sessions.open(1, 'c1').viewId;
    const kept = world.sessions.open(2, 'c1').viewId;
    await settle();
    world.sessions.closeOwner(1);

    expect(() => world.sessions.subscribe(1, own, POD_QUERY)).toThrowError(codeOf(NOT_AVAILABLE));
    expect(() => world.sessions.subscribe(1, secondView, POD_QUERY)).toThrowError(codeOf(NOT_AVAILABLE));
    expect(() => world.sessions.subscribe(2, kept, POD_QUERY)).not.toThrow();
    await settle();
    expect(world.accesses[0].closeHost).not.toHaveBeenCalled();
  });

  it('checks the access host every 5 s and reconnects when it has dropped', async () => {
    const world = setup();
    const view = world.sessions.open(1, 'c1').viewId;
    await settle();
    await world.sessions.subscribe(1, view, POD_QUERY);
    await settle();
    expect(eventsOf(world, 'rows', view)).toHaveLength(1);

    world.clock.run(HEALTH_MS);
    expect(statusesOf(world, view).at(-1)?.state).toBe('ready');
    expect(world.deps.openAccess).toHaveBeenCalledTimes(1);

    world.accesses[0].drop();
    world.clock.run(HEALTH_MS);
    expect(statusesOf(world, view).at(-1)?.state).toBe('reconnecting');
    expect(world.deps.openAccess).toHaveBeenCalledTimes(1);

    world.clock.run(10);
    await settle();
    expect(world.deps.openAccess).toHaveBeenCalledTimes(2);
    expect(statusesOf(world, view).at(-1)?.state).toBe('ready');
    const resets = eventsOf(world, 'rows', view).filter(event => event.reset);
    expect(resets).toHaveLength(2);
  });

  it('reports the attempt number and the host in trial while reconnecting, and neither once ready', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const made: FakeAccess[] = [];
    const world = setup({
      openAccess: vi.fn(async (_cluster, onTry) => {
        calls++;
        if (calls > 1) onTry?.('k8s-cp2');
        if (calls === 2) throw new Error('Keiner der Zugangs-Hosts erreichbar.');
        if (calls > 2) await new Promise<void>(resolve => { release = resolve; });
        made.push(fakeAccess());
        return made[made.length - 1].access;
      }),
    });
    const view = world.sessions.open(1, 'c1').viewId;
    await settle();
    expect(statusesOf(world, view).at(-1)?.trying).toBeUndefined();

    made[0].drop();
    world.clock.run(HEALTH_MS);
    expect(statusesOf(world, view).at(-1)).toMatchObject({ state: 'reconnecting', attempt: 1 });
    expect(statusesOf(world, view).at(-1)?.trying).toBeUndefined();

    world.clock.run(10);
    await settle();
    // First retry failed: the next one is attempt 2 and no host is in trial between the attempts.
    expect(statusesOf(world, view).filter(status => status.trying === 'k8s-cp2').at(0)).toMatchObject({ state: 'reconnecting', attempt: 1, trying: 'k8s-cp2' });
    expect(statusesOf(world, view).at(-1)).toMatchObject({ state: 'reconnecting', attempt: 2 });
    expect(statusesOf(world, view).at(-1)?.trying).toBeUndefined();

    world.clock.run(20);
    await settle();
    expect(statusesOf(world, view).at(-1)).toMatchObject({ state: 'reconnecting', attempt: 2, trying: 'k8s-cp2' });
    release();
    await settle();
    const ready = statusesOf(world, view).at(-1);
    expect(ready?.state).toBe('ready');
    expect(ready?.attempt).toBeUndefined();
    expect(ready?.trying).toBeUndefined();
  });

  it('checks the access host at once when a watcher fails three times in a row', async () => {
    const world = setup();
    const view = world.sessions.open(1, 'c1').viewId;
    await settle();
    await world.sessions.subscribe(1, view, POD_QUERY);
    await settle();

    world.accesses[0].drop();
    world.api.listErrors = [new KubeApiError('Der API-Server antwortet nicht.'), new KubeApiError('Der API-Server antwortet nicht.')];
    const watch = world.api.watches.find(record => record.kind === 'pods' && record.namespace === 'shop');
    watch?.end(new KubeApiError('Die Verbindung zum API-Server ist abgebrochen.'));
    world.clock.run(1000);
    await settle();
    expect(statusesOf(world, view).at(-1)?.state).toBe('ready');
    world.clock.run(2000);
    await settle();
    expect(statusesOf(world, view).at(-1)?.state).toBe('reconnecting');
  });

  it('answers detail requests with YAML, describe text and the events of an object', async () => {
    const world = setup();
    const view = world.sessions.open(1, 'c1').viewId;
    await settle();
    const ref: KubeRef = { kind: 'deployments', namespace: 'shop', name: 'api' };
    const event = { apiVersion: 'v1', kind: 'Event', metadata: { name: 'e1', uid: 'ev1', namespace: 'shop' }, type: 'Normal', reason: 'Scaled', message: 'ok', count: 1, lastTimestamp: '2026-10-16T08:00:00Z', involvedObject: { kind: 'Deployment', name: 'api' } };
    world.api.eventObjects = [event];

    expect(await world.sessions.detail(1, view, ref, 'yaml')).toEqual({ mode: 'yaml', text: toYaml(world.api.object) });
    expect(await world.sessions.detail(1, view, ref, 'describe')).toEqual({ mode: 'describe', text: describeText(world.api.object, [event]) });
    expect(await world.sessions.detail(1, view, ref, 'events')).toEqual({ mode: 'events', rows: [toRow('events', event)] });
  });

  it('refuses actions on a read-only cluster and reads read-only at each call', async () => {
    const world = setup();
    const view = world.sessions.open(1, 'c1').viewId;
    await settle();
    const request = { ref: { kind: 'deployments' as const, namespace: 'shop', name: 'api' }, action: 'restart' as const };

    world.cluster.readOnly = true;
    await expect(world.sessions.action(1, view, request)).rejects.toMatchObject({ code: 'kubernetes.readOnly' });
    expect(world.api.patches).toEqual([]);

    world.cluster.readOnly = false;
    await world.sessions.action(1, view, request);
    expect(world.api.patches).toHaveLength(1);
  });

  it('opens logs without a view and keeps the session while the terminal lives', async () => {
    const world = setup();
    world.cluster.readOnly = true;
    const shell: KubeTerminalTarget = { namespace: 'shop', pod: 'p1', container: 'app', mode: 'shell' };
    const logs: KubeTerminalTarget = { namespace: 'shop', pod: 'p1', container: 'app', mode: 'logs' };
    await expect(world.sessions.openTerminal('c1', shell, { cols: 80, rows: 24 }, terminalIo())).rejects.toMatchObject({ code: 'kubernetes.readOnly' });
    expect(world.api.terminals).toEqual([]);

    world.cluster.readOnly = false;
    const opened = world.sessions.openTerminal('c1', logs, { cols: 80, rows: 24 }, terminalIo());
    await settle();
    const stream = await opened;
    expect(world.api.terminals).toEqual([{ target: logs, size: { cols: 80, rows: 24 } }]);
    expect(world.clock.delays()).not.toContain(1000);

    stream.close();
    world.clock.run(1000);
    expect(world.tunnels[0].close).toHaveBeenCalled();
  });

  it('refuses views that belong to another owner', async () => {
    const world = setup();
    const view = world.sessions.open(1, 'c1').viewId;
    await settle();
    const ref: KubeRef = { kind: 'pods', namespace: 'shop', name: 'p1' };

    expect(() => world.sessions.subscribe(2, view, POD_QUERY)).toThrowError(codeOf(NOT_AVAILABLE));
    await expect(world.sessions.detail(2, view, ref, 'yaml')).rejects.toMatchObject({ code: NOT_AVAILABLE });
    await expect(world.sessions.action(2, view, { ref, action: 'delete' })).rejects.toMatchObject({ code: NOT_AVAILABLE });
    expect(() => world.sessions.close(2, view)).toThrowError(codeOf(NOT_AVAILABLE));
  });

  it('retries with the name kubernetes once when the certificate does not match the server name', async () => {
    const world = setup();
    world.api.listErrors = [new KubeApiError('TLS: certificate does not match the server name', undefined, { code: 'kubernetes.tlsAltname' })];
    const view = world.sessions.open(1, 'c1').viewId;
    await settle();

    expect(statusesOf(world, view).at(-1)?.state).toBe('ready');
    const configs = vi.mocked(world.deps.createApi).mock.calls.map(call => call[0]);
    expect(configs).toHaveLength(2);
    expect(configs[0].getCurrentCluster()?.tlsServerName).toBe('k8s-cp1');
    expect(configs[1].getCurrentCluster()?.tlsServerName).toBe('kubernetes');
  });

  it('reports a failed first start as an error without retrying, and a new open starts afresh', async () => {
    const world = setup({
      openAccess: vi.fn(async () => { throw new HostAccessError('kubernetes.accessHostsUnreachable', { hosts: 'k8s-cp1' }); }),
    });
    const view = world.sessions.open(1, 'c1').viewId;
    await settle();

    expect(statusesOf(world, view).at(-1)).toMatchObject({ state: 'error', error: { code: 'kubernetes.accessHostsUnreachable', params: { hosts: 'k8s-cp1' } } });
    expect(world.clock.delays()).not.toContain(10);
    expect(world.deps.openAccess).toHaveBeenCalledTimes(1);

    world.sessions.open(1, 'c1');
    await settle();
    expect(world.deps.openAccess).toHaveBeenCalledTimes(2);
  });
});

suite('userError', () => {
  it('passes coded and API errors and hides everything else', () => {
    expect(userError(new HostAccessError('kubernetes.hostTimeout'))).toEqual({ code: 'kubernetes.hostTimeout' });
    expect(userError(new KubeApiError('raw', 403, { code: 'kubernetes.forbidden' }))).toEqual({ code: 'kubernetes.forbidden' });
    expect(userError(Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:22'), { code: 'ECONNREFUSED' }))).toBeUndefined();
    expect(userError(new Error('plain'))).toBeUndefined();
  });

  it('shows an unknown first-start failure as the generic connect error', async () => {
    const world = setup({ openAccess: vi.fn(async () => { throw new Error('ssh2 internal text'); }) });
    const view = world.sessions.open(1, 'c1').viewId;
    await settle();
    expect(statusesOf(world, view).at(-1)).toMatchObject({ state: 'error', error: { code: 'kubernetes.connectFailed' } });
  });
});
