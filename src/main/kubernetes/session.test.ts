import { connect } from 'node:net';
import type { Duplex } from 'node:stream';
import { describe as suite, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { KubeConfig } from '@kubernetes/client-node';
import { AppError } from '../../shared/errors';
import type { KubernetesConnectionNode } from '../../shared/vault/types';
import type { KubeEvent, KubeKind, KubeQuery, KubeRef, KubeTerminalTarget } from '../../shared/kubernetes';
import { HostAccessError } from '../containers/runner';
import { KubeApiError } from './api';
import type { KubeApi, KubeObject, KubeRulesReview, KubeStream, ListResult, LogFollowOptions, MetricsSample, TerminalIo, WatchHandle, WatchType } from './api';
import type { ClusterAccess } from './access';
import { describe as describeText, toYaml } from './describe';
import { toRow } from './rows';
import { KubeSessions, HEALTH_MS, openableHref, userError } from './session';
import { ARGO_TIMEOUT_MS } from './argo';
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
  forwards: { namespace: string; pod: string; port: number }[] = [];
  logReads: string[] = [];

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

  async portForward(namespace: string, pod: string, port: number, socket: Duplex): Promise<void> {
    this.forwards.push({ namespace, pod, port });
    socket.on('data', chunk => socket.write(chunk));
    socket.resume();
  }

  rules: KubeRulesReview | Error = { incomplete: false, rules: [] };
  logStreams: { target: KubeTerminalTarget; options: LogFollowOptions; io: TerminalIo; close: Mock }[] = [];
  followLog(target: KubeTerminalTarget, options: LogFollowOptions, io: TerminalIo): KubeStream {
    const close = vi.fn();
    this.logStreams.push({ target, options, io, close });
    return { write() {}, resize() {}, pause() {}, resume() {}, close };
  }
  async rulesReview(): Promise<KubeRulesReview> {
    if (this.rules instanceof Error) throw this.rules;
    return this.rules;
  }
  async readLog(target: { pod: string; container: string }, options: { previous: boolean }): Promise<string> {
    this.logReads.push(`${target.pod}/${target.container}/${options.previous}`);
    return 'line 1\nline 2\n';
  }
  argo: KubeObject | Error = { metadata: { name: 'shop', namespace: 'argocd' }, spec: { syncPolicy: { automated: { selfHeal: true } } }, status: { sync: { status: 'Synced' }, health: { status: 'Healthy' } } };
  argoReads: string[] = [];
  async readArgoApp(namespace: string, name: string): Promise<KubeObject> {
    this.argoReads.push(`${namespace}/${name}`);
    if (this.argo instanceof Error) throw this.argo;
    return this.argo;
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

suite('port forwards of a view', () => {
  const target = { kind: 'pods' as const, namespace: 'shop', name: 'p1', port: 8080 };
  const forwardsOf = (world: World, viewId: string) => world.events
    .filter(entry => entry.ownerId === 1)
    .map(entry => entry.event)
    .filter((event): event is Extract<KubeEvent, { type: 'forwards' }> => event.type === 'forwards' && event.viewId === viewId)
    .map(event => event.forwards);
  const echo = (port: number, text: string) => new Promise<string>((resolve, reject) => {
    const socket = connect(port, '127.0.0.1', () => socket.write(text));
    socket.once('data', data => { resolve(data.toString()); socket.end(); });
    socket.once('error', reject);
  });

  it('forwards through the session of the view, also on a read-only cluster', async () => {
    const world = setup();
    world.cluster.readOnly = true;
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    const status = await world.sessions.startForward(1, viewId, target, 0);
    expect(await echo(status.localPort, 'ping')).toBe('ping');
    expect(world.api.forwards).toEqual([{ namespace: 'shop', pod: 'p1', port: 8080 }]);
    expect(forwardsOf(world, viewId).at(-1)?.[0]).toMatchObject({ id: status.id, pod: 'p1', podPort: 8080 });
    world.sessions.stopForward(1, viewId, status.id);
    expect(forwardsOf(world, viewId).at(-1)).toEqual([]);
  });

  it('refuses a session that is not ready, other owners, a locked vault and disabled clusters', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await expect(world.sessions.startForward(1, viewId, target, 0)).rejects.toMatchObject({ code: 'kubernetes.notConnected' });
    await settle();
    await expect(world.sessions.startForward(2, viewId, target, 0)).rejects.toMatchObject({ code: 'kubernetes.viewUnavailable' });
    vi.mocked(world.deps.getCluster).mockImplementationOnce(() => { throw new AppError('core.vaultLocked'); });
    await expect(world.sessions.startForward(1, viewId, target, 0)).rejects.toMatchObject({ code: 'core.vaultLocked' });
    world.cluster.disabled = true;
    await expect(world.sessions.startForward(1, viewId, target, 0)).rejects.toMatchObject({ code: 'kubernetes.disabled' });
    expect(world.api.forwards).toEqual([]);
  });

  it('ends the forwards of a view with the view, silently, and all of them with closeAll', async () => {
    const world = setup();
    const first = world.sessions.open(1, 'c1').viewId;
    const second = world.sessions.open(1, 'c1').viewId;
    await settle();
    const a = await world.sessions.startForward(1, first, target, 0);
    const b = await world.sessions.startForward(1, second, target, 0);
    const before = forwardsOf(world, first).length;
    world.sessions.close(1, first);
    expect(forwardsOf(world, first)).toHaveLength(before);
    expect(await echo(b.localPort, 'still')).toBe('still');
    // A closed listener frees its port: the next forward can take it.
    expect((await world.sessions.startForward(1, second, target, a.localPort)).localPort).toBe(a.localPort);
    world.sessions.closeAll();
    const third = world.sessions.open(1, 'c1').viewId;
    await settle();
    expect((await world.sessions.startForward(1, third, target, b.localPort)).localPort).toBe(b.localPort);
    world.sessions.closeAll();
  });

  it('drops a forward whose view closed while it started', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    const starting = world.sessions.startForward(1, viewId, target, 0);
    world.sessions.close(1, viewId);
    await expect(starting).rejects.toMatchObject({ code: 'kubernetes.viewUnavailable' });
  });
});

suite('logs of all pods and the rights pre-check of a view', () => {
  const request = { id: '1b4e28ba-2fa1-41d2-883f-0016d3cca427', namespace: 'shop', selector: { app: 'api' }, format: 'raw' as const };
  const logsOf = (world: World, viewId: string) => eventsOf(world, 'logs', viewId);

  it('answers the denied functions, and null when the review is incomplete, fails or hangs', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    expect((await world.sessions.access(1, viewId, 'shop'))?.map(item => item.id)).toContain('patchDeployments');
    world.api.rules = { incomplete: false, rules: [{ verbs: ['*'], apiGroups: ['*'], resources: ['*'] }] };
    expect(await world.sessions.access(1, viewId, 'shop')).toEqual([]);
    world.api.rules = { incomplete: true, rules: [] };
    expect(await world.sessions.access(1, viewId, 'shop')).toBeNull();
    world.api.rules = new KubeApiError('Forbidden', 403, { code: 'kubernetes.forbidden' });
    expect(await world.sessions.access(1, viewId, 'shop')).toBeNull();
    world.api.rulesReview = () => new Promise(() => {});
    const hanging = world.sessions.access(1, viewId, 'shop');
    world.clock.run(10_000);
    expect(await hanging).toBeNull();
    await expect(world.sessions.access(2, viewId, 'shop')).rejects.toMatchObject({ code: 'kubernetes.viewUnavailable' });
  });

  it('refuses the pre-check on a disabled cluster or a locked vault without asking the cluster', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    const review = vi.spyOn(world.api, 'rulesReview');
    world.cluster.disabled = true;
    await expect(world.sessions.access(1, viewId, 'shop')).rejects.toMatchObject({ code: 'kubernetes.disabled' });
    world.cluster.disabled = false;
    vi.mocked(world.deps.getCluster).mockImplementationOnce(() => { throw new AppError('core.vaultLocked'); });
    await expect(world.sessions.access(1, viewId, 'shop')).rejects.toMatchObject({ code: 'core.vaultLocked' });
    expect(review).not.toHaveBeenCalled();
  });

  it('refuses the pre-check while the cluster is not ready', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await expect(world.sessions.access(1, viewId, 'shop')).rejects.toMatchObject({ code: 'kubernetes.notConnected' });
  });

  it('starts on a read-only cluster, refuses a disabled one and sends the batches as logs events of the view', async () => {
    const world = setup();
    world.cluster.readOnly = true;
    world.api.pods = [pod('p1')];
    world.api.pods[0].status = { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 0, state: { running: { startedAt: '2026-10-25T08:00:00Z' } } }] };
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    await world.sessions.startLogs(1, viewId, request);
    await settle();
    expect(world.api.logStreams.map(stream => stream.target)).toEqual([{ namespace: 'shop', pod: 'p1', container: 'app', mode: 'logs' }]);
    world.api.logStreams[0].io.data(Buffer.from('2026-10-25T08:10:00Z hello\n'));
    world.clock.run(250);
    world.clock.run(250);
    expect(logsOf(world, viewId).at(-1)).toMatchObject({ type: 'logs', viewId, id: request.id, lines: [{ source: 0, text: 'hello' }], sources: [{ pod: 'p1', container: 'app', live: true }] });
    world.cluster.disabled = true;
    await expect(world.sessions.startLogs(1, viewId, request)).rejects.toMatchObject({ code: 'kubernetes.disabled' });
  });

  it('ends the run with stopLogs of its id only, with the view, with closeAll and when the connection drops', async () => {
    const world = setup();
    world.api.pods = [pod('p1')];
    world.api.pods[0].status = { phase: 'Running', containerStatuses: [{ name: 'app', restartCount: 0, state: { running: { startedAt: '2026-10-25T08:00:00Z' } } }] };
    const first = world.sessions.open(1, 'c1').viewId;
    await settle();
    await world.sessions.startLogs(1, first, request);
    await settle();
    world.sessions.stopLogs(1, first, '2c5ea4c0-4067-11e9-8bad-9b1deb4d3b7d');
    expect(world.api.logStreams[0].close).not.toHaveBeenCalled();
    world.sessions.stopLogs(1, first, request.id);
    expect(world.api.logStreams[0].close).toHaveBeenCalledTimes(1);

    await world.sessions.startLogs(1, first, request);
    await settle();
    world.sessions.close(1, first);
    expect(world.api.logStreams[1].close).toHaveBeenCalledTimes(1);

    const second = world.sessions.open(1, 'c1').viewId;
    await world.sessions.startLogs(1, second, request);
    await settle();
    world.accesses[0].drop();
    world.clock.run(HEALTH_MS);
    // The old API client must not be used after a reconnect: the run ends with the live connection.
    expect(world.api.logStreams[2].close).toHaveBeenCalledTimes(1);

    const third = world.sessions.open(1, 'c1').viewId;
    world.clock.run(10);
    await settle();
    await world.sessions.startLogs(1, third, request);
    await settle();
    world.sessions.closeAll();
    expect(world.api.logStreams.at(-1)?.close).toHaveBeenCalledTimes(1);
  });
});

suite('KubeSessions.diagnose', () => {
  const deployment = { kind: 'deployments' as const, namespace: 'shop', name: 'api' };

  it('reads the object on a read-only cluster and answers the context as text', async () => {
    const world = setup();
    world.cluster.readOnly = true;
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    const result = await world.sessions.diagnose(1, viewId, deployment);
    expect(result.text).toContain('Kind: Deployment');
    expect(result.parts.map(part => part.id)).toEqual(['object', 'events', 'pods']);
    expect(world.api.patches).toEqual([]);
    expect(world.api.removed).toEqual([]);
  });

  it('refuses a disabled cluster, a locked vault, another window and a cluster that is not ready, without reading', async () => {
    const world = setup();
    const notReady = world.sessions.open(1, 'c1').viewId;
    await expect(world.sessions.diagnose(1, notReady, deployment)).rejects.toMatchObject({ code: 'kubernetes.notConnected' });
    await settle();
    const read = vi.spyOn(world.api, 'read');
    world.cluster.disabled = true;
    await expect(world.sessions.diagnose(1, notReady, deployment)).rejects.toMatchObject({ code: 'kubernetes.disabled' });
    world.cluster.disabled = false;
    vi.mocked(world.deps.getCluster).mockImplementationOnce(() => { throw new AppError('core.vaultLocked'); });
    await expect(world.sessions.diagnose(1, notReady, deployment)).rejects.toMatchObject({ code: 'core.vaultLocked' });
    await expect(world.sessions.diagnose(2, notReady, deployment)).rejects.toMatchObject({ code: 'kubernetes.viewUnavailable' });
    expect(read).not.toHaveBeenCalled();
  });
});

suite('KubeSessions Argo CD and Harbor', () => {
  /** HEALTH_MS has the same delay, so the newest task with ARGO_TIMEOUT_MS is the one of argoApp. */
  const fireArgoTimeout = (world: World) => {
    const entry = [...world.clock.tasks.entries()].filter(([, task]) => task.ms === ARGO_TIMEOUT_MS).at(-1);
    if (!entry) throw new Error('no Argo CD timeout pending');
    world.clock.tasks.delete(entry[0]);
    entry[1].fn();
  };

  it('reads the application once by get and returns its Self-Heal state, null when it cannot be read', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    expect(await world.sessions.argoApp(1, viewId, 'shop')).toEqual({ automated: true, selfHeal: true, sync: 'Synced', health: 'Healthy' });
    expect(await world.sessions.argoApp(1, viewId, 'team-a_shop')).not.toBeNull();
    expect(world.api.argoReads).toEqual(['argocd/shop', 'team-a/shop']);
    world.api.argo = new KubeApiError('Forbidden', 403, { code: 'kubernetes.forbidden' });
    expect(await world.sessions.argoApp(1, viewId, 'shop')).toBeNull();
    world.api.argo = new KubeApiError('Not Found', 404, { code: 'kubernetes.notFound' });
    expect(await world.sessions.argoApp(1, viewId, 'shop')).toBeNull();
    expect(await world.sessions.argoApp(1, viewId, 'evil.example.test/x')).toBeNull();
    expect(world.api.argoReads).toHaveLength(4);
    // Every finished read cancels its timer; only the health check may still wait with the same delay.
    expect(world.clock.delays().filter(ms => ms === ARGO_TIMEOUT_MS).length).toBeLessThanOrEqual(1);
  });

  it('gives up after the timeout and without a connection, never blocking the dialog', async () => {
    const world = setup();
    const notReady = world.sessions.open(1, 'c1').viewId;
    expect(await world.sessions.argoApp(1, notReady, 'shop')).toBeNull();
    expect(world.api.argoReads).toEqual([]);
    await settle();
    world.api.readArgoApp = () => new Promise(() => {});
    const hanging = world.sessions.argoApp(1, notReady, 'shop');
    fireArgoTimeout(world);
    expect(await hanging).toBeNull();
  });

  it('refuses other owners, a disabled cluster and a locked vault', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    await expect(world.sessions.argoApp(2, viewId, 'shop')).rejects.toMatchObject({ code: 'kubernetes.viewUnavailable' });
    vi.mocked(world.deps.getCluster).mockImplementationOnce(() => { throw new AppError('core.vaultLocked'); });
    await expect(world.sessions.argoApp(1, viewId, 'shop')).rejects.toMatchObject({ code: 'core.vaultLocked' });
    world.cluster.disabled = true;
    await expect(world.sessions.argoApp(1, viewId, 'shop')).rejects.toMatchObject({ code: 'kubernetes.disabled' });
    expect(() => world.sessions.linkFor(1, viewId, { type: 'argo', app: 'shop' })).toThrow(expect.objectContaining({ code: 'kubernetes.disabled' }));
    expect(world.api.argoReads).toEqual([]);
  });

  it('builds links only from the addresses of the vault entry', async () => {
    const world = setup();
    const { viewId } = world.sessions.open(1, 'c1');
    await settle();
    const digest = `sha256:${'c'.repeat(64)}`;
    expect(() => world.sessions.linkFor(1, viewId, { type: 'argo', app: 'shop' })).toThrow(expect.objectContaining({ code: 'kubernetes.noArgoUrl' }));
    expect(() => world.sessions.linkFor(1, viewId, { type: 'harbor', image: 'harbor.example.test/shop/api:1' })).toThrow(expect.objectContaining({ code: 'kubernetes.noHarborUrl' }));
    world.cluster.argoUrl = 'https://argocd.example.test';
    world.cluster.harborUrl = 'https://harbor.example.test';
    expect(world.sessions.linkFor(1, viewId, { type: 'argo', app: 'team-a_shop' })).toBe('https://argocd.example.test/applications/team-a/shop');
    expect(world.sessions.linkFor(1, viewId, { type: 'harbor', image: 'harbor.example.test/shop/api:1', digest }))
      .toBe(`https://harbor.example.test/harbor/projects/shop/repositories/api/artifacts-tab/artifacts/${digest}`);
    expect(() => world.sessions.linkFor(1, viewId, { type: 'harbor', image: 'registry.local/shop/api:1' })).toThrow(expect.objectContaining({ code: 'kubernetes.linkRefused' }));
    expect(() => world.sessions.linkFor(1, viewId, { type: 'argo', app: 'evil.example.test/x' })).toThrow(expect.objectContaining({ code: 'kubernetes.linkRefused' }));
    for (const app of ['evil.com', 'a.b.c', 'x-y']) expect(new URL(world.sessions.linkFor(1, viewId, { type: 'argo', app })).host).toBe('argocd.example.test');
    for (const image of ['harbor.example.test/a/b', 'HARBOR.example.test:443/a/b/c:1']) expect(new URL(world.sessions.linkFor(1, viewId, { type: 'harbor', image })).host).toBe('harbor.example.test');
    expect(() => world.sessions.linkFor(2, viewId, { type: 'argo', app: 'shop' })).toThrow(expect.objectContaining({ code: 'kubernetes.viewUnavailable' }));
  });

  it('puts the addresses into the status only when the vault entry has them', async () => {
    const world = setup();
    world.cluster.argoUrl = 'https://argocd.example.test';
    const first = world.sessions.open(1, 'c1');
    await settle();
    expect(statusesOf(world, first.viewId).at(-1)).toMatchObject({ argoUrl: 'https://argocd.example.test' });
    expect(statusesOf(world, first.viewId).at(-1)).not.toHaveProperty('harborUrl');
    delete world.cluster.argoUrl;
    world.cluster.harborUrl = 'https://harbor.example.test';
    const second = world.sessions.open(2, 'c1');
    expect(second.status).toMatchObject({ harborUrl: 'https://harbor.example.test' });
    expect(second.status).not.toHaveProperty('argoUrl');
  });
});

suite('openableHref', () => {
  it('opens only https on the host of the vault address, checked again before the browser', () => {
    const base = 'https://argocd.example.test';
    expect(openableHref('https://argocd.example.test/applications/shop', base)).toBe('https://argocd.example.test/applications/shop');
    expect(openableHref('https://ARGOCD.example.test:443/applications/shop', base)).toBe('https://argocd.example.test/applications/shop');
    for (const href of [
      'http://argocd.example.test/applications/shop',
      'https://evil.example.test/applications/shop',
      'https://argocd.example.test.evil.example/x',
      'https://argocd.example.test:8443/x',
      'https://user@argocd.example.test/x',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'not a url',
      null,
    ]) expect(openableHref(href, base)).toBeNull();
    expect(openableHref('https://argocd.example.test/x', 'not a url')).toBeNull();
  });
});
