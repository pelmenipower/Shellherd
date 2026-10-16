import { describe, expect, it } from 'vitest';
import type { KubeQuery } from '../../shared/kubernetes';
import { KubeApiError, type KubeApi, type KubeObject, type KubeStream, type ListResult, type WatchHandle, type WatchType } from './api';
import { ResourceWatcher, type RowBatch, type WatcherOptions } from './watch';

const QUERY: KubeQuery = { kind: 'pods', namespace: 'shop' };
const settle = () => new Promise(resolve => setImmediate(resolve));

interface FakeWatch {
  resourceVersion: string;
  onEvent: (type: WatchType, object: KubeObject) => void;
  onEnd: (error?: KubeApiError) => void;
  stopped: boolean;
}

class FakeApi implements KubeApi {
  listCalls = 0;
  listQueue: (ListResult | Error)[] = [];
  watches: FakeWatch[] = [];

  async list(): Promise<ListResult> {
    this.listCalls++;
    const next = this.listQueue.shift() ?? { items: [], resourceVersion: '1' };
    if (next instanceof Error) throw next;
    return next;
  }

  async watch(_kind: unknown, _namespace: unknown, _selector: unknown, resourceVersion: string,
    onEvent: (type: WatchType, object: KubeObject) => void, onEnd: (error?: KubeApiError) => void): Promise<WatchHandle> {
    const watch: FakeWatch = { resourceVersion, onEvent, onEnd, stopped: false };
    this.watches.push(watch);
    return { stop: () => { watch.stopped = true; } };
  }

  latest(): FakeWatch {
    return this.watches[this.watches.length - 1];
  }

  read(): never { throw new Error('unused'); }
  eventsFor(): never { throw new Error('unused'); }
  mergePatch(): never { throw new Error('unused'); }
  remove(): never { throw new Error('unused'); }
  nodeMetrics(): never { throw new Error('unused'); }
  podMetrics(): never { throw new Error('unused'); }
  openTerminal(): Promise<KubeStream> { throw new Error('unused'); }
}

/** Deterministic timers: nothing runs until advance() moves the clock. */
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

const pod = (uid: string, name: string, phase = 'Running') => ({
  apiVersion: 'v1', kind: 'Pod',
  metadata: { uid, name, namespace: 'shop', resourceVersion: `rv-${uid}` },
  status: { phase, containerStatuses: [] },
});

function setup(options: WatcherOptions = {}) {
  const api = new FakeApi();
  const clock = new FakeClock();
  const batches: RowBatch[] = [];
  const trouble: (string | undefined)[] = [];
  const watcher = new ResourceWatcher(api, QUERY, batch => batches.push(batch), message => trouble.push(message),
    { schedule: clock.schedule, cancel: clock.cancel, ...options });
  return { api, clock, batches, trouble, watcher };
}

describe('ResourceWatcher', () => {
  it('lists, emits a reset batch and watches from the list resourceVersion', async () => {
    const { api, batches, watcher } = setup();
    api.listQueue.push({ items: [pod('u1', 'a'), pod('u2', 'b')], resourceVersion: '42' });

    await watcher.start();

    expect(batches).toHaveLength(1);
    expect(batches[0].reset).toBe(true);
    expect(batches[0].deletes).toEqual([]);
    expect(batches[0].upserts.map(row => row.uid)).toEqual(['u1', 'u2']);
    expect(api.watches).toHaveLength(1);
    expect(api.latest().resourceVersion).toBe('42');
    expect(watcher.rows().map(row => row.uid)).toEqual(['u1', 'u2']);
  });

  it('batches ADDED and MODIFIED within 250 ms, keeps the last state per uid and reports DELETED', async () => {
    const { api, clock, batches, watcher } = setup();
    api.listQueue.push({ items: [pod('u1', 'a'), pod('u2', 'b')], resourceVersion: '1' });
    await watcher.start();

    api.latest().onEvent('ADDED', pod('u3', 'c'));
    api.latest().onEvent('MODIFIED', pod('u3', 'c', 'Pending'));
    api.latest().onEvent('MODIFIED', pod('u1', 'a'));
    api.latest().onEvent('DELETED', pod('u2', 'b'));
    expect(batches).toHaveLength(1);

    clock.advance(249);
    expect(batches).toHaveLength(1);
    clock.advance(1);

    expect(batches).toHaveLength(2);
    expect(batches[1].reset).toBe(false);
    expect(batches[1].upserts.map(row => row.uid).sort()).toEqual(['u1', 'u3']);
    expect(batches[1].upserts.find(row => row.uid === 'u3')?.cells.status).toBe('Pending');
    expect(batches[1].deletes).toEqual(['u2']);
    expect(watcher.rows().map(row => row.uid).sort()).toEqual(['u1', 'u3']);
  });

  it('emits no batch for BOOKMARK but resumes the next watch from its resourceVersion', async () => {
    const { api, clock, batches, watcher } = setup();
    await watcher.start();

    api.latest().onEvent('BOOKMARK', { metadata: { resourceVersion: '99' } });
    clock.advance(1000);
    expect(batches).toHaveLength(1);

    api.latest().onEnd();
    await settle();

    expect(api.listCalls).toBe(1);
    expect(api.watches).toHaveLength(2);
    expect(api.latest().resourceVersion).toBe('99');
  });

  it('relists with a reset batch after 410 and does not report trouble', async () => {
    const { api, batches, trouble, watcher } = setup();
    api.listQueue.push({ items: [pod('u1', 'a')], resourceVersion: '5' }, { items: [pod('u9', 'z')], resourceVersion: '50' });
    await watcher.start();

    api.latest().onEnd(new KubeApiError('gone', 410));
    await settle();

    expect(api.listCalls).toBe(2);
    expect(batches[batches.length - 1]).toEqual({ reset: true, upserts: expect.any(Array), deletes: [] });
    expect(batches[batches.length - 1].upserts.map(row => row.uid)).toEqual(['u9']);
    expect(api.watches).toHaveLength(2);
    expect(api.latest().resourceVersion).toBe('50');
    expect(trouble).toEqual([]);
  });

  it('retries failed lists after 1 s, 2 s and 5 s and reports trouble after three failures', async () => {
    const { api, clock, batches, trouble, watcher } = setup();
    const offline = () => new Error('offline');
    api.listQueue.push(offline(), offline(), offline(), { items: [pod('u1', 'a')], resourceVersion: '7' });

    await watcher.start();
    expect(api.listCalls).toBe(1);
    expect(trouble).toEqual([]);

    clock.advance(999);
    await settle();
    expect(api.listCalls).toBe(1);
    clock.advance(1);
    await settle();
    expect(api.listCalls).toBe(2);

    clock.advance(1999);
    await settle();
    expect(api.listCalls).toBe(2);
    clock.advance(1);
    await settle();
    expect(api.listCalls).toBe(3);
    expect(trouble).toEqual(['Live-Aktualisierung gestört: offline']);

    clock.advance(4999);
    await settle();
    expect(api.listCalls).toBe(3);
    clock.advance(1);
    await settle();

    expect(api.listCalls).toBe(4);
    expect(batches[batches.length - 1].upserts.map(row => row.uid)).toEqual(['u1']);
    expect(trouble).toEqual(['Live-Aktualisierung gestört: offline', undefined]);
  });

  it('resumes a cleanly closed watch from the last resourceVersion without listing', async () => {
    const { api, watcher } = setup();
    api.listQueue.push({ items: [], resourceVersion: '10' });
    await watcher.start();
    api.latest().onEvent('MODIFIED', pod('u1', 'a'));

    api.latest().onEnd();
    await settle();

    expect(api.listCalls).toBe(1);
    expect(api.watches).toHaveLength(2);
    expect(api.latest().resourceVersion).toBe('rv-u1');
  });

  it('stop stops the watch, drops pending batches and starts nothing new', async () => {
    const { api, clock, batches, watcher } = setup();
    await watcher.start();
    api.latest().onEvent('ADDED', pod('u3', 'c'));

    watcher.stop();
    clock.advance(1000);
    expect(batches).toHaveLength(1);
    expect(api.latest().stopped).toBe(true);

    api.latest().onEnd();
    api.latest().onEnd(new KubeApiError('gone', 410));
    await settle();
    expect(api.listCalls).toBe(1);
    expect(api.watches).toHaveLength(1);
  });

  it('ignores objects for which toRow returns null', async () => {
    const { api, clock, batches, watcher } = setup();
    await watcher.start();

    api.latest().onEvent('ADDED', { apiVersion: 'v1', kind: 'Pod', metadata: { name: 'no-uid' } });
    clock.advance(1000);

    expect(batches).toHaveLength(1);
    expect(watcher.rows()).toEqual([]);
  });

  it('passes the complete object set to onObjects after the list and after each batch', async () => {
    const seen: number[][] = [];
    const { api, clock, watcher } = setup({ onObjects: objects => seen.push(objects.map(o => Number(o.metadata?.uid?.slice(1))).sort()) });
    api.listQueue.push({ items: [pod('u1', 'a'), pod('u2', 'b')], resourceVersion: '1' });
    await watcher.start();
    expect(seen).toEqual([[1, 2]]);

    api.latest().onEvent('ADDED', pod('u3', 'c'));
    clock.advance(250);
    expect(seen).toEqual([[1, 2], [1, 2, 3]]);
  });
});
