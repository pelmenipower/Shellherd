import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import type { KubeKind, KubeTerminalTarget } from '../../shared/kubernetes';
import { KubeApiError } from './api';
import type { KubeApi, KubeObject, KubeStream, ListResult, LogFollowOptions, TerminalIo, WatchHandle, WatchType } from './api';
import { KubeWorkloadLogs, LOG_BATCH_MS, LOG_RESUME_MS, MAX_LINE_CHARS, cleanLogText, splitTimestamp, startedContainers, type LogsBatch } from './workload-logs';

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
  readonly cancel = (handle: unknown): void => { this.tasks.delete(handle as number); };
  /** Runs every pending task with this delay, oldest first. */
  run(ms: number): void {
    for (const [id, task] of [...this.tasks.entries()].filter(([, entry]) => entry.ms === ms)) {
      this.tasks.delete(id);
      task.fn();
    }
  }
}

interface Stream { target: KubeTerminalTarget; options: LogFollowOptions; io: TerminalIo; close: Mock }

class FakeApi implements KubeApi {
  pods: KubeObject[] = [];
  listError?: Error;
  streams: Stream[] = [];
  watchStops: Mock[] = [];
  onEvent?: (type: WatchType, object: KubeObject) => void;
  async list(_kind: KubeKind): Promise<ListResult> {
    if (this.listError) throw this.listError;
    return { items: this.pods, resourceVersion: '1' };
  }
  async watch(_kind: KubeKind, _namespace: string | null, _selector: unknown, _version: string,
    onEvent: (type: WatchType, object: KubeObject) => void): Promise<WatchHandle> {
    this.onEvent = onEvent;
    const stop = vi.fn();
    this.watchStops.push(stop);
    return { stop };
  }
  followLog(target: KubeTerminalTarget, options: LogFollowOptions, io: TerminalIo): KubeStream {
    const close = vi.fn();
    this.streams.push({ target, options, io, close });
    return { write() {}, resize() {}, pause() {}, resume() {}, close };
  }
  read(): never { throw new Error('unused'); }
  readLog(): never { throw new Error('unused'); }
  eventsFor(): never { throw new Error('unused'); }
  mergePatch(): never { throw new Error('unused'); }
  remove(): never { throw new Error('unused'); }
  createJobFrom(): never { throw new Error('unused'); }
  nodeMetrics(): never { throw new Error('unused'); }
  podMetrics(): never { throw new Error('unused'); }
  openTerminal(): never { throw new Error('unused'); }
  portForward(): never { throw new Error('unused'); }
  rulesReview(): never { throw new Error('unused'); }
  readArgoApp(): never { throw new Error('unused'); }
}

const running = (startedAt = '2026-10-25T08:00:00Z') => ({ running: { startedAt } });
const pod = (name: string, containers: Record<string, object>, restartCount = 0, lastState?: object): KubeObject => ({
  metadata: { name, namespace: 'shop', uid: `uid-${name}`, resourceVersion: '1' },
  spec: { containers: Object.keys(containers).map(container => ({ name: container })) },
  status: { phase: 'Running', containerStatuses: Object.entries(containers).map(([container, state]) => ({ name: container, restartCount, state, ...(lastState ? { lastState } : {}) })) },
});

async function setup(pods: KubeObject[], format: 'compact' | 'raw' = 'raw') {
  const api = new FakeApi();
  api.pods = pods;
  const clock = new Clock();
  const batches: LogsBatch[] = [];
  const logs = new KubeWorkloadLogs((_owner, _view, batch) => batches.push(batch), clock);
  await logs.start({ ownerId: 1, viewId: 'v', api: async () => api }, { id: 'run', namespace: 'shop', selector: { app: 'api' }, format });
  await settle();
  return { api, clock, batches, logs };
}
const lines = (batches: LogsBatch[]) => batches.flatMap(batch => batch.lines);

describe('splitTimestamp', () => {
  it('pads the fraction to nine digits and keeps the text whole', () => {
    expect(splitTimestamp('2026-10-25T08:10:00.12Z text with  spaces')).toEqual({ time: '2026-10-25T08:10:00.120000000Z', text: 'text with  spaces' });
    expect(splitTimestamp('2026-10-25T08:10:00Z x')).toEqual({ time: '2026-10-25T08:10:00.000000000Z', text: 'x' });
    expect(splitTimestamp('2026-10-25T08:10:00.123456789Z ')).toEqual({ time: '2026-10-25T08:10:00.123456789Z', text: '' });
    expect(splitTimestamp('no stamp')).toBeUndefined();
    expect(splitTimestamp('2026-10-25T08:10:00.1234567890Z too many digits')).toBeUndefined();
  });

  it('turns a zone offset into UTC, so nodes in local time sort with the rest', () => {
    expect(splitTimestamp('2026-10-25T10:10:00.5+02:00 local')).toEqual({ time: '2026-10-25T08:10:00.500000000Z', text: 'local' });
    expect(splitTimestamp('2026-10-25T00:30:00-01:00 west')).toEqual({ time: '2026-10-25T01:30:00.000000000Z', text: 'west' });
    expect(splitTimestamp('2026-13-45T10:10:00+02:00 bad')).toBeUndefined();
  });

  it('sorts as strings in time order', () => {
    const a = splitTimestamp('2026-10-25T08:10:00.9Z a')?.time ?? '';
    const b = splitTimestamp('2026-10-25T08:10:00.10Z b')?.time ?? '';
    expect(b < a).toBe(true);
  });
});

describe('cleanLogText', () => {
  it('removes escape sequences and inner line breaks, replaces control characters and caps the length', () => {
    expect(cleanLogText('\x1b[31mERR\x1b[0m')).toBe('ERR');
    expect(cleanLogText('a\x1b]0;title\x07b')).toBe('ab');
    expect(cleanLogText('a\tb\x07c')).toBe('a b�c');
    expect(cleanLogText('one\r\n    two')).toBe('one     two');
    const long = cleanLogText('x'.repeat(5000));
    expect(long).toHaveLength(MAX_LINE_CHARS + 1);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('startedContainers', () => {
  it('counts running, terminated and a terminated last run; waiting alone does not count', () => {
    const object = pod('p', {
      a: running(), b: { terminated: { startedAt: '2026-10-25T07:00:00Z' } }, c: { waiting: { reason: 'ContainerCreating' } },
    });
    expect(startedContainers(object)).toEqual([
      { container: 'a', instance: `0/${Date.parse('2026-10-25T08:00:00Z')}`, running: true },
      { container: 'b', instance: `0/${Date.parse('2026-10-25T07:00:00Z')}`, running: false },
    ]);
    const crashing = pod('p', { a: { waiting: { reason: 'CrashLoopBackOff' } } }, 3, { terminated: { startedAt: '2026-10-25T07:00:00Z' } });
    expect(startedContainers(crashing)).toEqual([{ container: 'a', instance: `3/${Date.parse('2026-10-25T07:00:00Z')}`, running: false }]);
  });

  it('gives the same instance for a Date from a list and the string from a watch event', () => {
    const fromWatch = startedContainers(pod('p', { a: running('2026-10-25T08:00:00Z') }));
    const fromList = startedContainers(pod('p', { a: { running: { startedAt: new Date('2026-10-25T08:00:00Z') } } }));
    expect(fromList).toEqual(fromWatch);
    expect(startedContainers(pod('p', { a: running() }, 1))[0].instance).not.toBe(fromWatch[0].instance);
  });
});

describe('KubeWorkloadLogs', () => {
  it('opens one stream per started container, pods by name, and batches lines with source and normalised time', async () => {
    const { api, clock, batches } = await setup([pod('b-pod', { app: running() }), pod('a-pod', { app: running(), side: running() })]);
    expect(api.streams.map(stream => `${stream.target.pod}/${stream.target.container}`)).toEqual(['a-pod/app', 'a-pod/side', 'b-pod/app']);
    expect(api.streams.every(stream => stream.options.tailLines === 200 && stream.options.sinceTime === undefined)).toBe(true);
    expect(api.streams[0].target).toEqual({ namespace: 'shop', pod: 'a-pod', container: 'app', mode: 'logs' });
    api.streams[2].io.data(Buffer.from('2026-10-25T08:10:00.1Z first\n2026-10-25T08:10:0'));
    api.streams[2].io.data(Buffer.from('1Z second\n'));
    clock.run(LOG_BATCH_MS);
    expect(batches).toHaveLength(1);
    expect(batches[0].sources).toEqual([
      { pod: 'a-pod', container: 'app', live: true }, { pod: 'a-pod', container: 'side', live: true }, { pod: 'b-pod', container: 'app', live: true },
    ]);
    expect(batches[0].lines).toEqual([
      { source: 2, time: '2026-10-25T08:10:00.100000000Z', text: 'first' },
      { source: 2, time: '2026-10-25T08:10:01.000000000Z', text: 'second' },
    ]);
  });

  it('reports a first batch without pods and formats compact lines without escape sequences', async () => {
    const empty = await setup([]);
    empty.clock.run(LOG_BATCH_MS);
    expect(empty.batches).toEqual([{ id: 'run', lines: [], sources: [], waiting: 0, full: 0, dropped: 0 }]);
    const compact = await setup([pod('a', { app: running() })], 'compact');
    compact.api.streams[0].io.data(Buffer.from('2026-10-25T08:10:00Z {"level":"error","msg":"x"}\n'));
    compact.clock.run(LOG_BATCH_MS);
    expect(lines(compact.batches)[0].text).toBe('ERROR x');
  });

  it('opens at most 20 streams, counts the rest as waiting and moves the next one up when a stream ends', async () => {
    const pods = Array.from({ length: 25 }, (_, i) => pod(`p${String(i).padStart(2, '0')}`, { app: running() }));
    const { api, clock, batches } = await setup(pods);
    expect(api.streams).toHaveLength(20);
    clock.run(LOG_BATCH_MS);
    expect(batches.at(-1)?.waiting).toBe(5);
    api.streams[0].io.end(0);
    expect(api.streams).toHaveLength(21);
    expect(api.streams[20].target.pod).toBe('p20');
    clock.run(LOG_BATCH_MS);
    expect(batches.at(-1)?.waiting).toBe(4);
  });

  it('counts containers beyond 100 sources as full, not as waiting; sources open only as streams end', async () => {
    const pods = Array.from({ length: 101 }, (_, i) => pod(`p${String(i).padStart(3, '0')}`, { app: running() }));
    const { api, clock, batches } = await setup(pods);
    // Every clean end frees one stream for the next container: 80 ends bring the source count to 100.
    for (let i = 0; i < 80; i++) api.streams[i].io.end(0);
    clock.run(LOG_BATCH_MS);
    const last = batches.at(-1);
    expect(last?.sources).toHaveLength(100);
    expect(last?.sources.some(source => source.pod === 'p100')).toBe(false);
    expect(last?.full).toBe(1);
    expect(last?.waiting).toBe(0);
  });

  it('keeps an instance that ended with an error, and reads a new instance from the second of the last line without duplicates', async () => {
    const { api, clock, batches } = await setup([pod('a', { app: running() })]);
    api.streams[0].io.data(Buffer.from('2026-10-25T08:10:05.5Z before\n'));
    api.streams[0].io.end(null, { code: 'kubernetes.connectionReset' });
    clock.run(LOG_BATCH_MS);
    expect(batches.at(-1)?.sources[0]).toEqual({ pod: 'a', container: 'app', live: false, error: { code: 'kubernetes.connectionReset' } });
    api.onEvent?.('MODIFIED', { ...pod('a', { app: running() }), metadata: { name: 'a', namespace: 'shop', uid: 'uid-a', resourceVersion: '2' } });
    clock.run(250);
    expect(api.streams).toHaveLength(1);
    expect(clock.tasks.size === 0 || [...clock.tasks.values()].every(task => task.ms !== LOG_RESUME_MS)).toBe(true);
    api.onEvent?.('MODIFIED', { ...pod('a', { app: running('2026-10-25T08:11:00Z') }, 1), metadata: { name: 'a', namespace: 'shop', uid: 'uid-a', resourceVersion: '3' } });
    clock.run(250);
    expect(api.streams).toHaveLength(2);
    expect(api.streams[1].options).toEqual({ sinceTime: '2026-10-25T08:10:05Z' });
    api.streams[1].io.data(Buffer.from('2026-10-25T08:10:05.2Z old\n2026-10-25T08:10:05.5Z same\n2026-10-25T08:10:05.6Z new\n2026-10-25T08:10:04Z later old\n'));
    clock.run(LOG_BATCH_MS);
    expect(lines(batches).map(line => line.text)).toEqual(['before', 'new', 'later old']);
  });

  it('resumes a running container after a clean end (idle timeout of a proxy), never a terminated one', async () => {
    const { api, clock } = await setup([pod('a', { app: running() }), pod('b', { app: { terminated: { startedAt: '2026-10-25T07:00:00Z' } } })]);
    expect(api.streams).toHaveLength(2);
    api.streams[0].io.data(Buffer.from('2026-10-25T08:10:05Z quiet\n'));
    api.streams[0].io.end(0);
    api.streams[1].io.end(0);
    expect(api.streams).toHaveLength(2);
    clock.run(LOG_RESUME_MS);
    expect(api.streams).toHaveLength(3);
    expect(api.streams[2].target.pod).toBe('a');
    expect(api.streams[2].options).toEqual({ sinceTime: '2026-10-25T08:10:05Z' });
    clock.run(LOG_RESUME_MS);
    expect(api.streams).toHaveLength(3);
  });

  it('drops the oldest lines of a flood and says how many', async () => {
    const { api, clock, batches } = await setup([pod('a', { app: running() })]);
    api.streams[0].io.data(Buffer.from(Array.from({ length: 2500 }, (_, i) => `2026-10-25T08:10:00Z line ${i}\n`).join('')));
    clock.run(LOG_BATCH_MS);
    expect(batches.at(-1)?.lines).toHaveLength(2000);
    expect(batches.at(-1)?.lines[0].text).toBe('line 500');
    expect(batches.at(-1)?.dropped).toBe(500);
    api.streams[0].io.data(Buffer.from(Array.from({ length: 4500 }, (_, i) => `2026-10-25T08:10:01Z more ${i}\n`).join('')));
    clock.run(LOG_BATCH_MS);
    expect(batches.at(-1)?.lines).toHaveLength(2000);
    expect(batches.at(-1)?.lines.at(-1)?.text).toBe('more 4499');
    expect(batches.at(-1)?.dropped).toBe(500 + 2500);
  });

  it('stops streams, watcher and timers; later data, ends and timers send nothing; stop with another id keeps the run', async () => {
    const { api, clock, batches, logs } = await setup([pod('a', { app: running() })]);
    logs.stop('v', 'other');
    expect(api.streams[0].close).not.toHaveBeenCalled();
    api.streams[0].io.data(Buffer.from('2026-10-25T08:10:00Z x\n'));
    logs.stop('v', 'run');
    expect(api.streams[0].close).toHaveBeenCalledTimes(1);
    expect(api.watchStops[0]).toHaveBeenCalledTimes(1);
    expect(clock.tasks.size).toBe(0);
    api.streams[0].io.data(Buffer.from('2026-10-25T08:10:01Z y\n'));
    api.streams[0].io.end(0);
    clock.run(LOG_BATCH_MS);
    clock.run(LOG_RESUME_MS);
    expect(batches).toEqual([]);
  });

  it('replaces the run of a view on a new start and reports a watcher error in the batch', async () => {
    const first = await setup([pod('a', { app: running() })]);
    await first.logs.start({ ownerId: 1, viewId: 'v', api: async () => first.api }, { id: 'run2', namespace: 'shop', selector: { app: 'api' }, format: 'raw' });
    expect(first.api.streams[0].close).toHaveBeenCalledTimes(1);
    const denied = new FakeApi();
    denied.listError = new KubeApiError('Forbidden', 403, { code: 'kubernetes.forbidden' });
    const clock = new Clock();
    const batches: LogsBatch[] = [];
    const logs = new KubeWorkloadLogs((_owner, _view, batch) => batches.push(batch), clock);
    await logs.start({ ownerId: 1, viewId: 'v', api: async () => denied }, { id: 'run', namespace: 'shop', selector: { app: 'api' }, format: 'raw' });
    await settle();
    clock.run(LOG_BATCH_MS);
    expect(batches.at(-1)?.error).toEqual({ code: 'kubernetes.forbidden' });
    logs.stopAll();
  });

  it('forgets the run when the cluster does not get ready and passes the error on', async () => {
    const api = new FakeApi();
    const logs = new KubeWorkloadLogs(() => {}, new Clock());
    await expect(logs.start({ ownerId: 1, viewId: 'v', api: async () => { throw new Error('not ready'); } }, { id: 'run', namespace: 'shop', selector: { app: 'api' }, format: 'raw' }))
      .rejects.toThrow('not ready');
    logs.stop('v', 'run');
    expect(api.streams).toEqual([]);
  });
});
