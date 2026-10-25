import { StringDecoder } from 'node:string_decoder';
import type { CodedError } from '../../shared/errors';
import { LOG_TAIL_LINES, MAX_LOG_SOURCES, MAX_LOG_STREAMS } from '../../shared/kubernetes';
import type { KubeLogLine, KubeLogSource, KubeLogsStartRequest } from '../../shared/kubernetes';
import type { KubeApi, KubeObject, KubeStream } from './api';
import { formatLogLine } from './log-format';
import { ResourceWatcher, defaultCancel, defaultSchedule } from './watch';

/** Lines go to the renderer every LOG_BATCH_MS; a batch carries at most MAX_BATCH_LINES (the newest), the rest counts as dropped. */
export const LOG_BATCH_MS = 250;
export const MAX_BATCH_LINES = 2000;
/** Longer lines are cut with an ellipsis; a partial line longer than MAX_PENDING_CHARS is passed on as a line. */
export const MAX_LINE_CHARS = 4000;
const MAX_PENDING_CHARS = 64 * 1024;
/** A stream that ended cleanly while its container still runs (proxy or load balancer idle timeout) is opened again after this pause. */
export const LOG_RESUME_MS = 5000;

type Dict = Record<string, unknown>;
const rec = (value: unknown): Dict => (value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export type LogsRequest = Omit<KubeLogsStartRequest, 'viewId'>;
/** The view a run belongs to; `api` waits through a reconnect (Session.waitReady). */
export interface LogsView { ownerId: number; viewId: string; api: () => Promise<KubeApi> }
export interface LogsBatch { id: string; lines: KubeLogLine[]; sources: KubeLogSource[]; waiting: number; full: number; dropped: number; error?: CodedError }
export type LogsEmit = (ownerId: number, viewId: string, batch: LogsBatch) => void;
export interface LogsTimers { schedule: (fn: () => void, ms: number) => unknown; cancel: (handle: unknown) => void }

/**
 * Server timestamp of a `timestamps=true` line as UTC with nine fraction digits, so that the strings sort by time.
 * The kubelet writes the runtime's zone: a node in local time sends `+02:00` instead of `Z`.
 */
export function splitTimestamp(line: string): { time: string; text: string } | undefined {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2}) (.*)$/s.exec(line);
  if (!match) return undefined;
  let seconds = match[1];
  if (match[3] !== 'Z') {
    const utc = new Date(`${match[1]}${match[3]}`);
    if (Number.isNaN(utc.getTime())) return undefined;
    seconds = utc.toISOString().slice(0, 19);
  }
  return { time: `${seconds}.${(match[2] ?? '').padEnd(9, '0')}Z`, text: match[4] };
}

const ESCAPES = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g;
/** Text that is safe to show and short: escape sequences removed, inner line breaks and tabs as a space, other control characters as U+FFFD, capped. */
export function cleanLogText(text: string): string {
  const clean = text.replace(ESCAPES, '').replace(/\r?\n/g, ' ').replace(/\t/g, ' ').replace(/[\x00-\x1f\x7f-\x9f]/g, '�');
  return clean.length > MAX_LINE_CHARS ? `${clean.slice(0, MAX_LINE_CHARS)}…` : clean;
}

/**
 * Containers of a pod that have started at least once (running, terminated or a terminated last run), with a key per
 * container instance and whether it runs now.
 */
export function startedContainers(pod: KubeObject): { container: string; instance: string; running: boolean }[] {
  const statuses = list(rec(pod.status).containerStatuses).map(rec);
  return list(rec(pod.spec).containers).map(rec).flatMap(container => {
    const name = typeof container.name === 'string' ? container.name : '';
    const status = statuses.find(item => item.name === name);
    const state = rec(status?.state);
    const running = rec(state.running).startedAt;
    const started = running ?? rec(state.terminated).startedAt ?? rec(rec(rec(status?.lastState).terminated)).startedAt;
    // client-node's list returns Date objects, a watch event the JSON string: both become epoch milliseconds.
    const startedMs = started instanceof Date ? started.getTime() : typeof started === 'string' ? Date.parse(started) : Number.NaN;
    if (!name || !Number.isFinite(startedMs)) return [];
    return [{ container: name, instance: `${String(status?.restartCount ?? 0)}/${startedMs}`, running: running !== undefined }];
  });
}

interface Source {
  key: string;
  info: KubeLogSource;
  /** Restart count and start time of the container instance read last. */
  instance?: string;
  stream?: KubeStream;
  /** Identifies the current stream; callbacks of an older stream are ignored. */
  token?: symbol;
  decoder: StringDecoder;
  pending: string;
  /** Normalised server time of the newest line, for sinceTime on a reopen. */
  lastTime: string;
  /** After a reopen: lines up to this time were read before and are skipped. */
  skipUntil?: string;
  /** The stream ended cleanly LOG_RESUME_MS ago: the same instance may be opened again while it runs. */
  resume?: boolean;
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One run of "Logs aller Pods": a pod watcher for the selector and one log stream per started container. */
class LogRun {
  stopped = false;
  private api?: KubeApi;
  private watcher?: ResourceWatcher;
  private readonly sources: Source[] = [];
  private pods: KubeObject[] = [];
  private lines: KubeLogLine[] = [];
  private waiting = 0;
  /** Containers that never get a source, because the run already has MAX_LOG_SOURCES. */
  private full = 0;
  private dropped = 0;
  private error?: CodedError;
  /** The renderer has not seen the current state; true at the start, so the first sync reports even without pods. */
  private dirty = true;
  private timer: unknown;
  private timed = false;
  private readonly resumeTimers = new Set<unknown>();

  constructor(readonly view: LogsView, readonly request: LogsRequest, private readonly emit: LogsEmit, private readonly timers: LogsTimers) {}

  start(api: KubeApi): void {
    this.api = api;
    this.watcher = new ResourceWatcher(api, { kind: 'pods', namespace: this.request.namespace, selector: { labels: this.request.selector } },
      () => {},
      error => { this.error = error; this.dirty = true; this.touch(); },
      { schedule: this.timers.schedule, cancel: this.timers.cancel, onObjects: objects => { this.pods = objects; this.sync(); } });
    void this.watcher.start();
  }

  stop(): void {
    this.stopped = true;
    this.watcher?.stop();
    for (const source of this.sources) {
      const stream = source.stream;
      source.token = undefined;
      source.stream = undefined;
      stream?.close();
    }
    if (this.timed) this.timers.cancel(this.timer);
    this.timed = false;
    for (const handle of this.resumeTimers) this.timers.cancel(handle);
    this.resumeTimers.clear();
  }

  /** Opens a stream for every started container that has none, pods by name, at most MAX_LOG_STREAMS at once. */
  private sync(): void {
    if (this.stopped || !this.api) return;
    const named = this.pods
      .map(pod => ({ pod, name: typeof pod.metadata?.name === 'string' ? pod.metadata.name : '' }))
      .filter(entry => entry.name !== '')
      .sort((a, b) => byName(a.name, b.name));
    let waiting = 0;
    let full = 0;
    for (const { pod, name } of named) {
      for (const { container, instance, running } of startedContainers(pod)) {
        const key = `${name}/${container}`;
        const known = this.sources.find(source => source.key === key);
        // Live, or this container instance was read to its end (a running one may resume after a clean end).
        if (known?.stream || (known?.instance === instance && !(running && known.resume))) continue;
        // A new source is never added past MAX_LOG_SOURCES, so such a container stays out: it is not waiting for a stream.
        if (!known && this.sources.length >= MAX_LOG_SOURCES) { full++; continue; }
        if (this.openStreams() >= MAX_LOG_STREAMS) { waiting++; continue; }
        this.open(known ?? this.add(key, name, container), instance);
      }
    }
    if (waiting !== this.waiting || full !== this.full) { this.waiting = waiting; this.full = full; this.dirty = true; }
    this.touch();
  }

  private add(key: string, pod: string, container: string): Source {
    const source: Source = { key, info: { pod, container, live: false }, decoder: new StringDecoder('utf8'), pending: '', lastTime: '' };
    this.sources.push(source);
    return source;
  }

  private openStreams(): number {
    return this.sources.filter(source => source.stream !== undefined).length;
  }

  private open(source: Source, instance: string): void {
    const api = this.api;
    if (!api) return;
    const { pod, container } = source.info;
    const token = Symbol('stream');
    source.token = token;
    source.instance = instance;
    source.resume = false;
    source.info = { pod, container, live: true };
    source.decoder = new StringDecoder('utf8');
    source.pending = '';
    // A reopened container continues after the newest line read; sinceTime has whole seconds, so addLine skips what was read before.
    source.skipUntil = source.lastTime || undefined;
    const start = source.lastTime ? { sinceTime: `${source.lastTime.slice(0, 19)}Z` } : { tailLines: LOG_TAIL_LINES };
    this.dirty = true;
    const stream = api.followLog({ namespace: this.request.namespace, pod, container, mode: 'logs' }, start, {
      data: chunk => { if (source.token === token) this.feed(source, chunk); },
      end: (_code, error) => {
        if (source.token !== token || this.stopped) return;
        this.flushPending(source);
        source.token = undefined;
        source.stream = undefined;
        source.info = { pod, container, live: false, ...(error ? { error } : {}) };
        this.dirty = true;
        if (!error) this.resumeLater(source);
        // A waiting container may take the free slot.
        this.sync();
      },
    });
    if (source.token === token) source.stream = stream;
  }

  /** After a clean end: allows one reopen of the same instance after LOG_RESUME_MS; sync decides whether it still runs. */
  private resumeLater(source: Source): void {
    const handle = this.timers.schedule(() => {
      this.resumeTimers.delete(handle);
      if (this.stopped || source.stream) return;
      source.resume = true;
      this.sync();
    }, LOG_RESUME_MS);
    this.resumeTimers.add(handle);
  }

  private feed(source: Source, chunk: Buffer): void {
    if (this.stopped) return;
    const parts = (source.pending + source.decoder.write(chunk)).split('\n');
    source.pending = parts.pop() ?? '';
    if (source.pending.length > MAX_PENDING_CHARS) { parts.push(source.pending); source.pending = ''; }
    for (const part of parts) this.addLine(source, part);
    this.touch();
  }

  private flushPending(source: Source): void {
    const rest = source.pending + source.decoder.end();
    source.pending = '';
    if (rest !== '') this.addLine(source, rest);
  }

  private addLine(source: Source, raw: string): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    const stamped = splitTimestamp(line);
    if (source.skipUntil !== undefined) {
      if (stamped && stamped.time <= source.skipUntil) return;
      source.skipUntil = undefined;
    }
    if (stamped) source.lastTime = stamped.time;
    const body = stamped ? stamped.text : line;
    const text = cleanLogText(this.request.format === 'compact' ? formatLogLine(body) : body);
    // A flood is cut here already, so main never holds more than two batches of lines.
    if (this.lines.length >= 2 * MAX_BATCH_LINES) {
      this.dropped += MAX_BATCH_LINES;
      this.lines = this.lines.slice(MAX_BATCH_LINES);
    }
    this.lines.push({ source: this.sources.indexOf(source), time: stamped ? stamped.time : source.lastTime, text });
    this.dirty = true;
  }

  private touch(): void {
    if (!this.dirty || this.stopped || this.timed) return;
    this.timed = true;
    this.timer = this.timers.schedule(() => this.flush(), LOG_BATCH_MS);
  }

  private flush(): void {
    this.timed = false;
    if (this.stopped) return;
    let lines = this.lines;
    this.lines = [];
    if (lines.length > MAX_BATCH_LINES) {
      this.dropped += lines.length - MAX_BATCH_LINES;
      lines = lines.slice(-MAX_BATCH_LINES);
    }
    this.dirty = false;
    this.emit(this.view.ownerId, this.view.viewId, {
      id: this.request.id, lines, sources: this.sources.map(source => source.info), waiting: this.waiting, full: this.full, dropped: this.dropped,
      ...(this.error ? { error: this.error } : {}),
    });
  }
}

/** "Logs aller Pods" of every view: at most one run per view; reading only (list/watch pods, get pods/log). */
export class KubeWorkloadLogs {
  private readonly runs = new Map<string, LogRun>();

  constructor(private readonly emit: LogsEmit, private readonly timers: LogsTimers = { schedule: defaultSchedule, cancel: defaultCancel }) {}

  /** Replaces the view's run. Resolves once the run has its API client; rejects when the cluster does not get ready. */
  async start(view: LogsView, request: LogsRequest): Promise<void> {
    this.stopView(view.viewId);
    const run = new LogRun(view, request, this.emit, this.timers);
    this.runs.set(view.viewId, run);
    let api: KubeApi;
    try {
      api = await view.api();
    } catch (error) {
      if (this.runs.get(view.viewId) === run) this.stopView(view.viewId);
      throw error;
    }
    if (!run.stopped) run.start(api);
  }

  /** Stops the run `id` of a view; a newer run of the view stays. */
  stop(viewId: string, id: string): void {
    if (this.runs.get(viewId)?.request.id === id) this.stopView(viewId);
  }

  stopView(viewId: string): void {
    this.runs.get(viewId)?.stop();
    this.runs.delete(viewId);
  }

  stopAll(): void {
    for (const viewId of [...this.runs.keys()]) this.stopView(viewId);
  }
}
