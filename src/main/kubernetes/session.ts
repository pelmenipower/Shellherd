import { randomUUID } from 'node:crypto';
import type { KubeConfig } from '@kubernetes/client-node';
import type { KubernetesConnectionNode } from '../../shared/vault/types';
import type { ClusterState, ClusterStatus, KubeAction, KubeDetail, KubeDetailMode, KubeEvent, KubeOpenResult, KubeQuery, KubeRef, KubeRow, KubeTerminalTarget, UsageHistory } from '../../shared/kubernetes';
import { READ_ONLY_MESSAGE, queryKey } from '../../shared/kubernetes';
import type { TerminalSize } from '../../shared/ssh';
import { HostAccessError } from '../containers/runner';
import { KubeApiError } from './api';
import { isAltnameError } from './client-api';
import type { KubeApi, KubeStream, TerminalIo } from './api';
import { runAction } from './actions';
import type { ClusterAccess } from './access';
import { describe, toYaml } from './describe';
import { KubeInputError, parseKubeconfig } from './kubeconfig';
import type { ParsedKubeconfig } from './kubeconfig';
import { Overview } from './overview';
import type { OverviewState } from './overview';
import { toRow } from './rows';
import type { Tunnel } from './tunnel';
import { ResourceWatcher, defaultCancel, defaultSchedule } from './watch';
import type { RowBatch } from './watch';

export const HEALTH_MS = 5000;
const DEFAULT_IDLE_MS = 60_000;
const DEFAULT_BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const NOT_AVAILABLE = 'Die Cluster-Ansicht ist nicht verfügbar.';
const NOT_CONNECTED = 'Der Cluster ist gerade nicht verbunden.';
const RECONNECTING = 'Die Verbindung zum Cluster wird gerade wiederhergestellt.';
const CONNECT_FAILED = 'Die Verbindung zum Cluster ist fehlgeschlagen.';
const DISABLED = 'Diese Verbindung ist deaktiviert.';
const ENDED = 'Die Cluster-Sitzung wurde beendet.';
/** How long a terminal waits for a reconnect, like the SSH start timer. */
const READY_WAIT_MS = 30_000;

export interface KubeSessionDependencies {
  getCluster: (id: string) => KubernetesConnectionNode;
  openAccess: (cluster: KubernetesConnectionNode) => Promise<ClusterAccess>;
  openTunnel: (access: ClusterAccess, target: { host: string; port: number }) => Promise<Tunnel>;
  createApi: (config: KubeConfig) => KubeApi;
  emit: (ownerId: number, event: KubeEvent) => void;
  idleMs?: number;
  backoffMs?: number[];
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
}

interface Timer { handle: unknown }

/** One view of a cluster tab: its owner, its session and the table it shows. */
interface View {
  viewId: string;
  ownerId: number;
  session: Session;
  query?: KubeQuery;
  key?: string;
}

/** One live watcher per distinct query, shared by every view that shows that query. */
interface Entry {
  query: KubeQuery;
  views: Set<string>;
  loaded: boolean;
  trouble?: string;
  watcher: ResourceWatcher;
}

interface SessionOptions {
  schedule: (fn: () => void, ms: number) => unknown;
  cancel: (handle: unknown) => void;
  idleMs: number;
  backoffMs: number[];
}

/** Messages that are safe to show: our own errors, and plain errors without system or library detail. */
export function userMessage(error: unknown): string | undefined {
  if (error instanceof KubeInputError || error instanceof HostAccessError || error instanceof KubeApiError) return error.message;
  if (error instanceof Error && !('code' in error) && !('level' in error)) return error.message;
  return undefined;
}

/** Only a certificate that does not name the server's host is worth the `kubernetes` retry. */
function isAltname(error: unknown): boolean {
  return error instanceof KubeApiError && isAltnameError(error);
}

/** Nodes show their running pod count and, with metrics, CPU and RAM, all taken from the overview. */
function decorate(query: KubeQuery, row: KubeRow, counts: Record<string, number>, usage: Record<string, { cpu: string; memory: string }>): KubeRow {
  if (query.kind !== 'nodes') return row;
  const share = usage[row.ref.name];
  return { ...row, cells: { ...row.cells, pods: counts[row.ref.name] ?? 0, ...(share ?? {}) } };
}

/**
 * One connection to a cluster, shared by every view and terminal that uses it. It owns the access host,
 * the tunnel, the API client, the overview and the watchers, and reconnects after the access host drops.
 */
class Session {
  state: ClusterState = 'connecting';
  message?: string;
  metrics = false;
  private hostName?: string;
  private cluster?: KubernetesConnectionNode;
  private contextNamespace?: string;
  private access?: ClusterAccess;
  private tunnel?: Tunnel;
  private api?: KubeApi;
  private overview?: Overview;
  private readonly entries = new Map<string, Entry>();
  private readonly views = new Map<string, View>();
  private waiters: { resolve: (api: KubeApi) => void; reject: (error: Error) => void }[] = [];
  private terminals = 0;
  private podKey?: string;
  private attempt = 0;
  private disposed = false;
  private health?: Timer;
  private retry?: Timer;
  private idle?: Timer;

  constructor(private readonly deps: KubeSessionDependencies, private readonly options: SessionOptions,
    readonly clusterId: string, private readonly forget: () => void) {}

  /** Starts connecting. Views attached before this call receive the connecting status. */
  begin(): void {
    this.setState('connecting');
    void this.connectFirst();
  }

  attach(view: View): void {
    this.views.set(view.viewId, view);
    this.stopTimer(this.idle);
    this.idle = undefined;
  }

  sendStatus(view: View): void {
    this.deps.emit(view.ownerId, { type: 'status', viewId: view.viewId, status: this.status() });
  }

  /** Current status and overview, for the reply to `k8s:open`. */
  snapshot(viewId: string): KubeOpenResult {
    const state = this.overview?.current();
    return { viewId, status: this.status(), ...(state ? { overview: state } : {}) };
  }

  /** Sends everything a view may have missed: status, overview, usage and the trouble of its table. */
  resend(view: View): void {
    this.sendStatus(view);
    const state = this.overview?.current();
    if (state) this.deps.emit(view.ownerId, { type: 'overview', viewId: view.viewId, ...state });
    const usage = this.overview?.usage();
    if (usage && Object.keys(usage).length > 0) this.deps.emit(view.ownerId, { type: 'usage', viewId: view.viewId, pods: usage });
  }

  detach(view: View): void {
    this.release(view);
    this.views.delete(view.viewId);
    view.query = undefined;
    this.maybeIdle();
  }

  /** A terminal keeps the session alive like a view does. */
  holdTerminal(): void {
    this.terminals++;
    this.stopTimer(this.idle);
    this.idle = undefined;
  }

  releaseTerminal(): void {
    this.terminals--;
    this.maybeIdle();
  }

  requireApi(): KubeApi {
    if (this.state !== 'ready' || !this.api) throw new Error(this.state === 'reconnecting' ? RECONNECTING : NOT_CONNECTED);
    return this.api;
  }

  /** Resolves with the API once the session is ready; rejects if it fails or ends first. */
  waitReady(): Promise<KubeApi> {
    if (this.state === 'ready' && this.api) return Promise.resolve(this.api);
    if (this.state === 'error') return Promise.reject(new Error(this.message ?? CONNECT_FAILED));
    return new Promise((resolve, reject) => {
      let timer: Timer | undefined;
      const clear = (): void => { if (timer) this.options.cancel(timer.handle); };
      const waiter = {
        resolve: (api: KubeApi) => { clear(); resolve(api); },
        reject: (error: Error) => { clear(); reject(error); },
      };
      // A reconnect gets a limit like the first connect; a session that never comes back must not hold the caller.
      if (this.state === 'reconnecting') {
        timer = this.later(() => {
          this.waiters = this.waiters.filter(candidate => candidate !== waiter);
          reject(new Error(RECONNECTING));
        }, READY_WAIT_MS);
      }
      this.waiters.push(waiter);
    });
  }

  /** Subscribes a view to a query. Without a live API the query waits until the session is ready. */
  subscribe(view: View, query: KubeQuery): Promise<void> {
    if (view.key && view.key !== queryKey(query)) this.release(view);
    return this.join(view, query);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTimer(this.idle);
    this.stopTimer(this.retry);
    this.idle = undefined;
    this.retry = undefined;
    this.teardownLive();
    this.forget();
    this.rejectWaiters(ENDED);
    this.views.clear();
  }

  private async connectFirst(): Promise<void> {
    try {
      await this.establish();
      this.setReady();
    } catch (error) {
      if (this.disposed) return;
      this.teardownLive();
      this.message = userMessage(error) ?? CONNECT_FAILED;
      this.setState('error', this.message);
      this.forget();
      this.rejectWaiters(this.message);
    }
  }

  private rejectWaiters(message: string): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter.reject(new Error(message));
  }

  private async establish(): Promise<void> {
    const cluster = this.deps.getCluster(this.clusterId);
    this.cluster = cluster;
    const access = await this.deps.openAccess(cluster);
    if (this.disposed) { access.host.close(); throw new Error(ENDED); }
    this.access = access;
    this.hostName = access.connection.name;
    const parsed = parseKubeconfig(access.kubeconfig, cluster.context);
    // Without a namespace in the vault or the context the tab shows all namespaces.
    this.contextNamespace = parsed.namespace;
    this.emitStatus();
    const tunnel = await this.deps.openTunnel(access, parsed.server);
    if (this.disposed) { tunnel.close(); throw new Error(ENDED); }
    this.tunnel = tunnel;
    const api = await this.probe(parsed, tunnel.port);
    if (this.disposed) throw new Error(ENDED);
    this.api = api;
    this.overview = new Overview(api,
      state => this.onOverview(state),
      pods => this.onUsage(pods),
      available => this.onMetrics(available),
      { schedule: this.options.schedule, cancel: this.options.cancel });
    await this.overview.start();
    if (this.disposed) throw new Error(ENDED);
    await this.startWatchers();
  }

  /** Lists nodes once. A certificate that does not match the server name gets one retry with the name `kubernetes`. */
  private async probe(parsed: ParsedKubeconfig, port: number): Promise<KubeApi> {
    const first = this.deps.createApi(parsed.build(port));
    try {
      await first.list('nodes', null);
      return first;
    } catch (error) {
      if (!isAltname(error)) throw error;
    }
    const second = this.deps.createApi(parsed.build(port, 'kubernetes'));
    await second.list('nodes', null);
    return second;
  }

  private setReady(): void {
    this.attempt = 0;
    this.message = undefined;
    this.setState('ready');
    this.scheduleHealth();
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) waiter.resolve(this.api as KubeApi);
  }

  private scheduleHealth(): void {
    this.stopTimer(this.health);
    this.health = this.later(() => {
      this.health = undefined;
      this.checkHealth();
    }, HEALTH_MS);
  }

  /** Runs on the health timer and whenever a watcher reports trouble. */
  private checkHealth(): void {
    if (this.disposed || this.state !== 'ready') return;
    if (this.access?.host.closed) {
      this.reconnect();
      return;
    }
    this.scheduleHealth();
  }

  private reconnect(): void {
    this.teardownLive();
    this.attempt = 0;
    this.setState('reconnecting');
    this.scheduleRetry();
  }

  private scheduleRetry(): void {
    const backoff = this.options.backoffMs;
    const delay = backoff[Math.min(this.attempt, backoff.length - 1)];
    this.retry = this.later(() => {
      this.retry = undefined;
      void this.retryNow();
    }, delay);
  }

  private async retryNow(): Promise<void> {
    if (this.disposed) return;
    try {
      await this.establish();
      this.setReady();
    } catch (error) {
      if (this.disposed) return;
      this.teardownLive();
      this.attempt++;
      this.setState('reconnecting', userMessage(error) ?? CONNECT_FAILED);
      this.scheduleRetry();
    }
  }

  /** Stops everything that depends on the live connection. The views and the session itself stay. */
  private teardownLive(): void {
    this.stopTimer(this.health);
    this.health = undefined;
    for (const entry of this.entries.values()) entry.watcher.stop();
    this.entries.clear();
    for (const view of this.views.values()) view.key = undefined;
    this.overview?.stop();
    this.overview = undefined;
    this.api = undefined;
    this.metrics = false;
    try { this.tunnel?.close(); } catch { /* already closed */ }
    this.tunnel = undefined;
    try { this.access?.host.close(); } catch { /* already closed */ }
    this.access = undefined;
  }

  private async startWatchers(): Promise<void> {
    for (const entry of this.entries.values()) entry.watcher.stop();
    this.entries.clear();
    const starts: Promise<void>[] = [];
    for (const view of this.views.values()) {
      if (view.query) starts.push(this.join(view, view.query));
    }
    await Promise.all(starts);
  }

  private join(view: View, query: KubeQuery): Promise<void> {
    const key = queryKey(query);
    view.query = query;
    view.key = key;
    const api = this.api;
    if (!api) return Promise.resolve();
    const existing = this.entries.get(key);
    if (existing) {
      existing.views.add(view.viewId);
      if (existing.loaded) this.deliver(view.viewId, existing.query, { reset: true, upserts: existing.watcher.rows(), deletes: [] });
      if (existing.trouble) this.deliverTrouble(view.viewId, existing.query, existing.trouble);
      return Promise.resolve();
    }
    const entry: Entry = {
      query,
      views: new Set([view.viewId]),
      loaded: false,
      watcher: new ResourceWatcher(api, query,
        batch => this.onBatch(entry, batch),
        message => {
          entry.trouble = message;
          for (const viewId of entry.views) this.deliverTrouble(viewId, entry.query, message);
          if (message !== undefined) this.checkHealth();
        },
        { schedule: this.options.schedule, cancel: this.options.cancel }),
    };
    this.entries.set(key, entry);
    return entry.watcher.start();
  }

  private release(view: View): void {
    if (!view.key) return;
    const key = view.key;
    view.key = undefined;
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.views.delete(view.viewId);
    if (entry.views.size === 0) {
      entry.watcher.stop();
      this.entries.delete(key);
    }
  }

  private onBatch(entry: Entry, batch: RowBatch): void {
    entry.loaded = true;
    for (const viewId of entry.views) this.deliver(viewId, entry.query, batch);
  }

  private deliver(viewId: string, query: KubeQuery, batch: RowBatch): void {
    const view = this.views.get(viewId);
    if (!view) return;
    const counts = this.overview?.podCounts() ?? {};
    const usage = this.overview?.nodeUsageCells() ?? {};
    const upserts = batch.upserts.map(row => decorate(query, row, counts, usage));
    this.deps.emit(view.ownerId, { type: 'rows', viewId, query, reset: batch.reset, upserts, deletes: batch.deletes });
  }

  private deliverTrouble(viewId: string, query: KubeQuery, message: string | undefined): void {
    const view = this.views.get(viewId);
    if (!view) return;
    this.deps.emit(view.ownerId, { type: 'trouble', viewId, query, ...(message ? { message } : {}) });
  }

  private onOverview(state: OverviewState): void {
    for (const view of this.views.values()) {
      this.deps.emit(view.ownerId, { type: 'overview', viewId: view.viewId, nodes: state.nodes, problems: state.problems, namespaces: state.namespaces });
    }
    // Pod counts and usage in the nodes table change without any node change, so the nodes rows are sent again when they do.
    const counts = this.overview?.podCounts() ?? {};
    const key = JSON.stringify([Object.entries(counts).sort(), Object.entries(this.overview?.nodeUsageCells() ?? {}).sort()]);
    if (key === this.podKey) return;
    this.podKey = key;
    for (const entry of this.entries.values()) {
      if (entry.query.kind === 'nodes' && entry.loaded) this.onBatch(entry, { reset: true, upserts: entry.watcher.rows(), deletes: [] });
    }
  }

  private onUsage(pods: UsageHistory): void {
    for (const view of this.views.values()) this.deps.emit(view.ownerId, { type: 'usage', viewId: view.viewId, pods });
  }

  private onMetrics(available: boolean): void {
    if (this.metrics === available) return;
    this.metrics = available;
    this.emitStatus();
  }

  private setState(state: ClusterState, message?: string): void {
    this.state = state;
    this.message = message;
    this.emitStatus();
  }

  private emitStatus(): void {
    for (const view of this.views.values()) this.sendStatus(view);
  }

  private status(): ClusterStatus {
    try { this.cluster = this.deps.getCluster(this.clusterId); } catch { /* removed from the vault: keep the last known values */ }
    const cluster = this.cluster;
    return {
      state: this.state,
      name: cluster?.name ?? this.clusterId,
      production: cluster?.production ?? false,
      readOnly: cluster?.readOnly ?? true,
      ...(this.hostName ? { host: this.hostName } : {}),
      ...(this.message ? { message: this.message } : {}),
      metrics: this.metrics,
      // Vault setting first, then the kubeconfig context (known once the config was read).
      ...(cluster?.namespace || this.contextNamespace ? { namespace: cluster?.namespace || this.contextNamespace } : {}),
    };
  }

  private maybeIdle(): void {
    if (this.views.size > 0 || this.terminals > 0 || this.idle || this.disposed) return;
    this.idle = this.later(() => {
      this.idle = undefined;
      if (this.views.size === 0 && this.terminals === 0) this.dispose();
    }, this.options.idleMs);
  }

  private later(fn: () => void, ms: number): Timer {
    return { handle: this.options.schedule(fn, ms) };
  }

  private stopTimer(timer: Timer | undefined): void {
    if (timer) this.options.cancel(timer.handle);
  }
}

export class KubeSessions {
  private readonly sessions = new Map<string, Session>();
  private readonly views = new Map<string, View>();
  private readonly options: SessionOptions;

  constructor(private readonly deps: KubeSessionDependencies) {
    this.options = {
      schedule: deps.schedule ?? defaultSchedule,
      cancel: deps.cancel ?? defaultCancel,
      idleMs: deps.idleMs ?? DEFAULT_IDLE_MS,
      backoffMs: deps.backoffMs ?? DEFAULT_BACKOFF_MS,
    };
  }

  /** Returns the session of a cluster, creating it when none is running. Created sessions are not begun. */
  private sessionFor(clusterId: string): { session: Session; fresh: boolean } {
    const existing = this.sessions.get(clusterId);
    if (existing) return { session: existing, fresh: false };
    const created: Session = new Session(this.deps, this.options, clusterId, () => {
      if (this.sessions.get(clusterId) === created) this.sessions.delete(clusterId);
    });
    this.sessions.set(clusterId, created);
    return { session: created, fresh: true };
  }

  /** Opens a view on the cluster's session; the session connects in the background if it is not running. */
  open(ownerId: number, clusterId: string): KubeOpenResult {
    if (this.deps.getCluster(clusterId).disabled) throw new Error(DISABLED);
    const { session, fresh } = this.sessionFor(clusterId);
    const view: View = { viewId: randomUUID(), ownerId, session };
    this.views.set(view.viewId, view);
    session.attach(view);
    if (fresh) session.begin();
    // The events of begin() reach the renderer before it listens, so the reply carries the state.
    return session.snapshot(view.viewId);
  }

  subscribe(ownerId: number, viewId: string, query: KubeQuery): Promise<void> {
    const view = this.viewOf(ownerId, viewId);
    // The renderer registers its listener after `open`, so it gets the current state again with its first query.
    view.session.resend(view);
    return view.session.subscribe(view, query);
  }

  async detail(ownerId: number, viewId: string, ref: KubeRef, mode: KubeDetailMode): Promise<KubeDetail> {
    const api = this.viewOf(ownerId, viewId).session.requireApi();
    if (mode === 'yaml') return { mode: 'yaml', text: toYaml(await api.read(ref)) };
    if (mode === 'describe') {
      const object = await api.read(ref);
      return { mode: 'describe', text: describe(object, await api.eventsFor(ref)) };
    }
    const rows = (await api.eventsFor(ref))
      .map(event => toRow('events', event))
      .filter((row): row is KubeRow => row !== null);
    return { mode: 'events', rows };
  }

  async action(ownerId: number, viewId: string, request: { ref: KubeRef; action: KubeAction; replicas?: number }): Promise<void> {
    const view = this.viewOf(ownerId, viewId);
    // Read at each call, so a change to read-only in the vault applies at once.
    const cluster = this.deps.getCluster(view.session.clusterId);
    if (cluster.readOnly) throw new Error(READ_ONLY_MESSAGE);
    await runAction(view.session.requireApi(), request, { readOnly: false });
  }

  close(ownerId: number, viewId: string): void {
    const view = this.views.get(viewId);
    if (!view) return;
    if (view.ownerId !== ownerId) throw new Error(NOT_AVAILABLE);
    this.views.delete(viewId);
    view.session.detach(view);
  }

  /** True while the window has a cluster view open (closing the window then asks for confirmation). */
  hasOwner(ownerId: number): boolean {
    for (const view of this.views.values()) if (view.ownerId === ownerId) return true;
    return false;
  }

  closeOwner(ownerId: number): void {
    for (const view of [...this.views.values()]) {
      if (view.ownerId === ownerId) this.close(ownerId, view.viewId);
    }
  }

  closeAll(): void {
    for (const session of [...this.sessions.values()]) session.dispose();
    this.sessions.clear();
    this.views.clear();
  }

  /** Pod logs and shells run on the cluster's session; the terminal keeps the session alive until it ends. */
  async openTerminal(clusterId: string, target: KubeTerminalTarget, size: TerminalSize, io: TerminalIo): Promise<KubeStream> {
    const cluster = this.deps.getCluster(clusterId);
    if (cluster.disabled) throw new Error(DISABLED);
    if (target.mode === 'shell' && cluster.readOnly) throw new Error(READ_ONLY_MESSAGE);
    const { session, fresh } = this.sessionFor(clusterId);
    session.holdTerminal();
    if (fresh) session.begin();
    let released = false;
    const release = (): void => {
      if (released) return;
      released = true;
      session.releaseTerminal();
    };
    try {
      const api = await session.waitReady();
      const stream = await api.openTerminal(target, { cols: size.cols, rows: size.rows }, {
        data: io.data,
        end: (code, message) => {
          try { io.end(code, message); } finally { release(); }
        },
      });
      return {
        write: data => stream.write(data),
        resize: (cols, rows) => stream.resize(cols, rows),
        pause: () => stream.pause(),
        resume: () => stream.resume(),
        close: () => {
          try { stream.close(); } finally { release(); }
        },
      };
    } catch (error) {
      release();
      throw error;
    }
  }

  private viewOf(ownerId: number, viewId: string): View {
    const view = this.views.get(viewId);
    if (!view || view.ownerId !== ownerId) throw new Error(NOT_AVAILABLE);
    return view;
  }
}
