import type { CodedError } from '../../shared/errors';
import type { KubeQuery, KubeRow } from '../../shared/kubernetes';
import { KubeApiError, type KubeApi, type KubeObject, type ListResult, type WatchHandle, type WatchType } from './api';
import { toApiError } from './client-api';
import { toRow } from './rows';

export const BATCH_MS = 250;
const RETRY_DELAYS_MS = [1000, 2000, 5000];
const TROUBLE_AFTER = 3;
const GONE = 410;
/** A cleanly closed watch resumes after this pause, so a server that closes at once cannot cause a tight loop. */
const RESUME_MS = 1000;
/** After this many clean closes without any event the watch starts over with a list. */
const RELIST_AFTER_CLEAN = 3;
/** 401 and 403 will not fix themselves quickly: shown at once, retried slowly. */
const AUTH_RETRY_MS = 30_000;

export interface RowBatch { reset: boolean; upserts: KubeRow[]; deletes: string[] }

export interface WatcherOptions {
  batchMs?: number;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  /** Called after each batch and after each list with the complete object set. */
  onObjects?: (objects: KubeObject[]) => void;
}

export const defaultSchedule = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);
export const defaultCancel = (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>);

interface Stored { object: KubeObject; row: KubeRow }
interface Timer { handle: unknown }

/**
 * Keeps one table in sync: list, then watch from the list's resourceVersion. Changes are batched,
 * a 410 (stale resourceVersion, as end or as ERROR event) relists at once, a clean server close resumes the watch
 * after 1 s (and relists after three in a row without events), and other errors relist after 1 s, 2 s, then 5 s.
 * After three failures in a row onTrouble reports it; 401/403 are reported at once and retried every 30 s.
 */
export class ResourceWatcher {
  private readonly batchMs: number;
  private readonly schedule: (fn: () => void, ms: number) => unknown;
  private readonly cancel: (handle: unknown) => void;
  private readonly stored = new Map<string, Stored>();
  private readonly upserts = new Map<string, KubeRow>();
  private readonly deletes = new Set<string>();
  private resourceVersion = '';
  private generation = 0;
  private stopped = false;
  private watchHandle: WatchHandle | undefined;
  private batchTimer: Timer | undefined;
  private retryTimer: Timer | undefined;
  private failures = 0;
  private cleanCloses = 0;
  private troubled = false;
  private troubleKey: string | undefined;

  constructor(private readonly api: KubeApi, private readonly query: KubeQuery,
    private readonly emit: (batch: RowBatch) => void,
    private readonly onTrouble: (error: CodedError | undefined) => void, private readonly options: WatcherOptions = {}) {
    this.batchMs = options.batchMs ?? BATCH_MS;
    this.schedule = options.schedule ?? defaultSchedule;
    this.cancel = options.cancel ?? defaultCancel;
  }

  /** Lists, emits the full set as a reset batch and starts the watch. Resolves after the first list attempt. */
  async start(): Promise<void> {
    this.stopped = false;
    await this.relist();
  }

  stop(): void {
    this.stopped = true;
    this.generation++;
    this.watchHandle?.stop();
    this.watchHandle = undefined;
    this.cancelTimers();
    this.upserts.clear();
    this.deletes.clear();
  }

  /** Current rows (for late subscribers). */
  rows(): KubeRow[] {
    return [...this.stored.values()].map(entry => entry.row);
  }

  private async relist(): Promise<void> {
    const gen = this.restart();
    let result: ListResult;
    try {
      result = await this.api.list(this.query.kind, this.query.namespace, this.query.selector);
    } catch (error) {
      if (!this.isStale(gen)) this.fail(error, gen);
      return;
    }
    if (this.isStale(gen)) return;
    this.stored.clear();
    for (const object of result.items) this.store(object);
    this.resourceVersion = result.resourceVersion;
    this.emit({ reset: true, upserts: this.rows(), deletes: [] });
    this.notifyObjects();
    this.recover();
    await this.watchFrom(gen);
  }

  private async watchFrom(gen: number): Promise<void> {
    try {
      const handle = await this.api.watch(this.query.kind, this.query.namespace, this.query.selector, this.resourceVersion,
        (type, object) => this.onEvent(gen, type, object), error => this.onEnd(gen, error));
      if (this.isStale(gen)) {
        handle.stop();
        return;
      }
      this.watchHandle = handle;
    } catch (error) {
      if (!this.isStale(gen)) this.fail(error, gen);
    }
  }

  private onEvent(gen: number, type: WatchType, object: KubeObject): void {
    if (this.isStale(gen)) return;
    if (type === 'ERROR') {
      this.onErrorEvent(object);
      return;
    }
    this.cleanCloses = 0;
    const version = object.metadata?.resourceVersion;
    if (version) this.resourceVersion = version;
    if (type === 'BOOKMARK') return;
    const uid = object.metadata?.uid;
    if (!uid) return;
    if (type === 'DELETED') {
      this.remove(uid);
      return;
    }
    const row = toRow(this.query.kind, object);
    if (!row) {
      this.remove(uid);
      return;
    }
    this.stored.set(uid, { object, row });
    this.upserts.set(uid, row);
    this.deletes.delete(uid);
    this.arm();
  }

  /** The server reports a failed watch as a Status object inside the stream and closes it afterwards. */
  private onErrorEvent(object: KubeObject): void {
    const code = (object as { code?: unknown }).code;
    if (code === GONE) {
      void this.relist();
      return;
    }
    // A new generation makes the close that follows this event stale.
    this.watchHandle?.stop();
    this.watchHandle = undefined;
    this.fail(toApiError({ code: typeof code === 'number' ? code : undefined }), ++this.generation);
  }

  private onEnd(gen: number, error: KubeApiError | undefined): void {
    if (this.isStale(gen)) return;
    this.watchHandle = undefined;
    if (error?.code === GONE) {
      void this.relist();
    } else if (error) {
      this.fail(error, gen);
    } else if (++this.cleanCloses >= RELIST_AFTER_CLEAN) {
      this.cleanCloses = 0;
      void this.relist();
    } else {
      this.retryTimer = {
        handle: this.schedule(() => {
          this.retryTimer = undefined;
          if (!this.isStale(gen)) void this.watchFrom(gen);
        }, RESUME_MS),
      };
    }
  }

  private store(object: KubeObject): void {
    const uid = object.metadata?.uid;
    const row = toRow(this.query.kind, object);
    if (uid && row) this.stored.set(uid, { object, row });
  }

  private remove(uid: string): void {
    if (!this.stored.has(uid)) return;
    this.stored.delete(uid);
    this.upserts.delete(uid);
    this.deletes.add(uid);
    this.arm();
  }

  private arm(): void {
    if (this.batchTimer) return;
    this.batchTimer = { handle: this.schedule(() => this.flush(), this.batchMs) };
  }

  private flush(): void {
    this.batchTimer = undefined;
    if (this.stopped || (this.upserts.size === 0 && this.deletes.size === 0)) return;
    const batch: RowBatch = { reset: false, upserts: [...this.upserts.values()], deletes: [...this.deletes] };
    this.upserts.clear();
    this.deletes.clear();
    this.emit(batch);
    this.notifyObjects();
    this.recover();
  }

  private fail(error: unknown, gen: number): void {
    this.watchHandle = undefined;
    this.failures++;
    // Never the raw error text: an ApiException carries the response body and headers.
    const api = toApiError(error);
    const auth = api.code === 401 || api.code === 403;
    if (auth || this.failures >= TROUBLE_AFTER) {
      this.troubled = true;
      // The API's English message is a safe technical detail; auth failures carry their own readable code.
      const trouble: CodedError = auth ? api.coded : { code: 'kubernetes.liveUpdateFailed', detail: api.message };
      const key = JSON.stringify(trouble);
      if (key !== this.troubleKey) {
        this.troubleKey = key;
        this.onTrouble(trouble);
      }
    }
    const delay = auth ? AUTH_RETRY_MS : RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length) - 1];
    this.retryTimer = {
      handle: this.schedule(() => {
        this.retryTimer = undefined;
        if (!this.isStale(gen)) void this.relist();
      }, delay),
    };
  }

  /** A successful list or batch ends any failure streak. */
  private recover(): void {
    this.failures = 0;
    this.cleanCloses = 0;
    if (this.troubled) {
      this.troubled = false;
      this.troubleKey = undefined;
      this.onTrouble(undefined);
    }
  }

  private notifyObjects(): void {
    this.options.onObjects?.([...this.stored.values()].map(entry => entry.object));
  }

  /** Starts a new generation: stops the current watch, drops pending changes and timers. */
  private restart(): number {
    this.generation++;
    this.watchHandle?.stop();
    this.watchHandle = undefined;
    this.cancelTimers();
    this.upserts.clear();
    this.deletes.clear();
    return this.generation;
  }

  private cancelTimers(): void {
    if (this.batchTimer) this.cancel(this.batchTimer.handle);
    if (this.retryTimer) this.cancel(this.retryTimer.handle);
    this.batchTimer = undefined;
    this.retryTimer = undefined;
  }

  private isStale(gen: number): boolean {
    return this.stopped || gen !== this.generation;
  }
}
