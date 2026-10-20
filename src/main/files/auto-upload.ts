import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { posix, win32 } from 'node:path';
import { compileExcludes } from '../../shared/exclude-glob';
import type { ExcludeMatcher } from '../../shared/exclude-glob';
import type { AutoUploadStatus, TransferJob } from '../../shared/sftp';
import type { AutoUploadBinding } from '../../shared/vault/types';
import { FileError, fileError, unsafeLocalName } from './file-system';
import type { FileSystem } from './file-system';
import type { RemoteFileSystem } from './sftp-file-system';
import { planTransfer, runTransfer, TransferCanceled } from './transfer';
import type { PlannedItem } from './transfer';

const MAX_LISTED = 100;
/** More pending entries than this are cheaper to compare as a whole. */
const STORM = 500;
const EMIT_INTERVAL = 200;

export interface AutoUploadDependencies {
  local: FileSystem;
  emit: (status: AutoUploadStatus, closed?: boolean) => void;
  /** True when another file view already runs this binding (same id). */
  inUseElsewhere?: (bindingId: string) => boolean;
  /** Quiet time before a batch is uploaded; default 500. */
  settleMs?: number;
  /** Upper bound from the first pending event to the batch; default 2000. */
  maxWaitMs?: number;
}

type Timer = ReturnType<typeof setTimeout>;

interface Bound {
  status: Omit<AutoUploadStatus, 'skipped' | 'skippedMore'>;
  matcher: ExcludeMatcher;
  /** Lower-case path with trailing backslash, for overlap checks. */
  key: string;
  root: string;
  remoteRoot: string;
  /** Server time after our last upload, per relative path: a different time means someone else wrote the file. */
  known: Map<string, number>;
  /** Local modification time of our last upload, per relative path. */
  sent: Map<string, number>;
  /** Uncapped; the status shows the first 100. */
  skipped: Set<string>;
  forced: Set<string>;
  /** Relative Windows path → a `rename` event was among them. */
  pending: Map<string, boolean>;
  job: TransferJob;
  controller: AbortController;
  watcher?: FSWatcher;
  timer?: Timer;
  firstAt?: number;
  emitTimer?: Timer;
  running: boolean;
  again: boolean;
  full: boolean;
  checkingRoot: boolean;
  closed: boolean;
  retries: number;
  current?: Promise<void>;
}

/** Local folders mirrored into server folders: one way, never deletes (uploads always run with `move: false`). */
export class AutoUploads {
  private bound = new Map<string, Bound>();
  private readonly settleMs: number;
  private readonly maxWaitMs: number;
  constructor(private readonly remote: RemoteFileSystem, private readonly deps: AutoUploadDependencies) {
    this.settleMs = deps.settleMs ?? 500;
    this.maxWaitMs = deps.maxWaitMs ?? 2000;
  }

  /** Registers and reports the binding synchronously, then checks folders and starts the watcher; the first full comparison runs in the background. Never rejects for binding problems: they end as state 'error'. A running binding with the same id is stopped first. */
  async start(binding: AutoUploadBinding): Promise<void> {
    const previous = this.bound.get(binding.id)?.current;
    this.stop(binding.id);
    const b: Bound = { status: { bindingId: binding.id, localPath: binding.localPath, remotePath: binding.remotePath, state: 'syncing', synced: 0, failed: [] },
      matcher: compileExcludes(binding.excludes), key: pathKey(binding.localPath), root: '', remoteRoot: '', known: new Map(), sent: new Map(), skipped: new Set(),
      forced: new Set(), pending: new Map(), controller: new AbortController(), running: false, again: false, full: false, checkingRoot: false, closed: false, retries: 0,
      job: { id: binding.id, direction: 'upload', move: false, label: '', entryCount: 0, targetDir: '', state: 'running', totalBytes: 0, doneBytes: 0,
        totalFiles: 0, doneFiles: 0, skippedFiles: 0 } };
    this.bound.set(binding.id, b);
    this.publish(b, true);
    try {
      if (this.deps.inUseElsewhere?.(binding.id)) throw new FileError('files.syncElsewhere');
      for (const other of this.bound.values()) {
        if (other !== b && (other.key.startsWith(b.key) || b.key.startsWith(other.key))) throw new FileError('files.syncOverlap');
      }
      await previous;
      if (b.closed) return;
      const info = await lstat(binding.localPath).catch(() => null);
      if (!info || !info.isDirectory() && !info.isSymbolicLink()) throw new FileError('files.syncLocalMissing');
      if (info.isSymbolicLink()) throw new FileError('files.syncLocalLink');
      b.root = await realpath(win32.resolve(binding.localPath));
      b.remoteRoot = await this.remote.realpath(binding.remotePath).catch(() => { throw new FileError('files.syncRemoteMissing'); });
      if (b.remoteRoot === '/') throw new FileError('files.syncRemoteRoot');
      if ((await this.remote.stat(b.remoteRoot))?.type !== 'directory') throw new FileError('files.syncRemoteMissing');
      if (b.closed) return;
      b.job.targetDir = b.remoteRoot;
      b.watcher = watch(b.root, { recursive: true, persistent: false }, (type, name) => this.handleEvent(binding.id, type, name));
      b.watcher.on('error', error => this.fail(b, error));
    } catch (error) {
      if (!b.closed) this.fail(b, error);
      return;
    }
    b.full = true;
    void this.flush(b);
  }

  /** Unknown id: no-op. Emits the last status with `closed`. */
  stop(id: string): void {
    const b = this.bound.get(id);
    if (!b) return;
    this.bound.delete(id);
    b.closed = true;
    clearTimeout(b.timer);
    clearTimeout(b.emitTimer);
    b.watcher?.close();
    b.controller.abort();
    this.deps.emit(this.view(b), true);
  }

  /** Re-uploads every skipped entry that is still a regular file, overwriting the server copy. Unknown id: throws FileError('files.syncNotFound'). Runs serialized with the batches. */
  force(id: string): void {
    const b = this.bound.get(id);
    if (!b) throw new FileError('files.syncNotFound');
    for (const rel of b.skipped) b.forced.add(rel);
    void this.flush(b);
  }

  /** Registered and not in state 'error'. */
  running(id: string): boolean { const state = this.bound.get(id)?.status.state; return state !== undefined && state !== 'error'; }

  list(): AutoUploadStatus[] { return [...this.bound.values()].map(b => this.view(b)); }

  /** Synchronous: clears timers, closes watchers, aborts uploads, emits `closed` for each. */
  closeAll(): void { for (const id of [...this.bound.keys()]) this.stop(id); }

  /** Watcher callback; public for tests. */
  handleEvent(id: string, eventType: string, filename: string | null): void {
    const b = this.bound.get(id);
    if (!b || b.closed || b.status.state === 'error') return;
    if (filename === null) { b.full = true; this.schedule(b); return; }
    const rel = win32.relative(b.root, win32.resolve(b.root, filename));
    if (filename.includes('\0') || win32.isAbsolute(filename) || rel === '..' || rel.startsWith('..\\') || win32.isAbsolute(rel)) {
      // Deleting the watched folder floods the watcher with absolute names instead of an error.
      if (!b.checkingRoot) {
        b.checkingRoot = true;
        void lstat(b.root).then(() => { b.checkingRoot = false; }, () => this.fail(b, new FileError('files.syncLocalMissing')));
      }
      return;
    }
    if (!rel || b.matcher(rel.split('\\').join('/'), false)) return;
    b.pending.set(rel, (b.pending.get(rel) ?? false) || eventType === 'rename');
    this.schedule(b);
  }

  private schedule(b: Bound): void {
    const now = Date.now();
    b.firstAt ??= now;
    clearTimeout(b.timer);
    b.timer = setTimeout(() => void this.flush(b), Math.max(0, Math.min(this.settleMs, b.firstAt + this.maxWaitMs - now)));
  }

  private async flush(b: Bound): Promise<void> {
    if (b.closed || b.status.state === 'error') return;
    if (b.running) { b.again = true; return; }
    b.current = this.drain(b);
    return b.current;
  }

  /** Never rejects. */
  private async drain(b: Bound): Promise<void> {
    b.running = true;
    b.firstAt = undefined;
    try {
      const pending = b.pending;
      b.pending = new Map();
      const forced = [...b.forced];
      b.forced.clear();
      if (b.full || pending.size > STORM) {
        b.full = false;
        this.setState(b, 'syncing');
        await this.fullSync(b);
        this.setState(b, 'watching');
      } else await this.batch(b, pending);
      for (const rel of forced) await this.forceOne(b, rel);
    } catch (error) {
      if (!(error instanceof TransferCanceled) && !b.closed) this.fail(b, error);
    } finally {
      b.running = false;
      if (b.again) { b.again = false; void this.flush(b); }
    }
  }

  private skipFor(b: Bound) {
    // modified 0: the file could not be inspected (locked); it would wrongly look "older" than the server copy.
    return (source: string, entry: { type: string; modified: number }): boolean =>
      entry.type === 'link' || entry.modified === 0 || b.matcher(win32.relative(b.root, source).split('\\').join('/'), entry.type === 'directory');
  }

  private async fullSync(b: Bound): Promise<void> {
    const skip = this.skipFor(b);
    const children = (await this.deps.local.list(b.root))
      .filter(entry => !unsafeLocalName(entry.name) && !skip(win32.join(b.root, entry.name), entry))
      .map(entry => win32.join(b.root, entry.name));
    let items: PlannedItem[];
    try { ({ items } = await planTransfer(this.deps.local, this.remote, children, b.remoteRoot, b.controller.signal, skip)); }
    catch (error) {
      const code = fileError(error).code;
      // Files vanish while a checkout or build runs: compare again once it settles, a few times at most.
      if ((code === 'files.sourceNotFound' || code === 'files.notFound') && b.retries < 3) { b.retries += 1; b.full = true; this.schedule(b); return; }
      throw error;
    }
    b.retries = 0;
    for (const item of items) await this.upload(b, item, false);
  }

  private async batch(b: Bound, pending: Map<string, boolean>): Promise<void> {
    const found: { abs: string; rel: string; directory: boolean }[] = [];
    for (const [name, renamed] of pending) {
      const path = win32.join(b.root, name);
      const info = await lstat(path).catch(() => null);
      // Deletions are never mirrored; folders report `change` for every file inside, only new ones matter.
      if (!info || info.isSymbolicLink() || (info.isDirectory() && !renamed)) continue;
      // The real path catches junctions in ancestors and 8.3 short names that would dodge the excludes.
      const real = await realpath(path).catch(() => null);
      const rel = real && win32.relative(b.root, real);
      if (!real || !rel || rel === '..' || rel.startsWith('..\\') || win32.isAbsolute(rel)) continue;
      const parts = rel.split('\\');
      if (parts.some(unsafeLocalName) || b.matcher(parts.join('/'), info.isDirectory())) continue;
      found.push({ abs: real, rel: parts.join('/'), directory: info.isDirectory() });
    }
    const folders = found.filter(entry => entry.directory).map(entry => entry.rel);
    for (const entry of found) if (!folders.some(folder => entry.rel.startsWith(`${folder}/`))) await this.send(b, entry.abs, entry.rel, false);
  }

  private async forceOne(b: Bound, rel: string): Promise<void> {
    b.skipped.delete(rel);
    const abs = win32.join(b.root, ...rel.split('/'));
    if ((await lstat(abs).catch(() => null))?.isFile()) await this.send(b, abs, rel, true);
    this.publish(b);
  }

  /** One local file or folder: creates the server parents, then uploads item by item. */
  private async send(b: Bound, abs: string, rel: string, overwrite: boolean): Promise<void> {
    const target = posix.join(b.remoteRoot, rel);
    if (!target.startsWith(`${b.remoteRoot}/`)) return;
    const parent = posix.dirname(target);
    try {
      let current = b.remoteRoot;
      for (const segment of posix.relative(b.remoteRoot, parent).split('/').filter(Boolean)) {
        current = posix.join(current, segment);
        const entry = await this.remote.stat(current);
        if (!entry) await this.remote.mkdir(current);
        else if (entry.type !== 'directory') throw new FileError('files.existsAsFile', { name: segment });
      }
      const { items } = await planTransfer(this.deps.local, this.remote, [abs], parent, b.controller.signal, this.skipFor(b));
      for (const item of items) await this.upload(b, item, overwrite);
    } catch (error) { await this.itemFailed(b, rel, abs, error); }
  }

  private async upload(b: Bound, item: PlannedItem, overwrite: boolean): Promise<void> {
    const rel = item.target.slice(b.remoteRoot.length + 1);
    const before = b.job.doneFiles;
    try {
      await runTransfer(b.job, [item], this.deps.local, this.remote, { progress: () => {}, conflict: async ({ source, target }) => {
        const known = b.known.get(rel);
        const sent = b.sent.get(rel);
        // Rule 1: the server copy changed since our upload; rule 2 only without our own upload in this session.
        const newer = known !== undefined ? Math.abs(target.modified - known) > 1000 : target.modified > source.modified + 1000;
        if (newer && !overwrite) b.skipped.add(rel);
        // Our own upload: exact local time; otherwise the size and ±1 s comparison of the start.
        const unchanged = target.size === source.size && (sent !== undefined ? source.modified === sent : Math.abs(target.modified - source.modified) <= 1000);
        return { choice: overwrite || (!newer && !unchanged) ? 'overwrite' : 'skip', applyToAll: false };
      } }, b.controller.signal);
    } catch (error) { await this.itemFailed(b, rel, item.source, error); return; }
    if (b.job.doneFiles > before) {
      // The server may refuse our modification time, so read back what it keeps.
      b.known.set(rel, (await this.remote.stat(item.target).catch(() => null))?.modified ?? item.modified);
      b.sent.set(rel, item.modified);
      b.skipped.delete(rel);
      b.status.synced += 1;
      b.status.last = { name: item.name, at: Date.now() };
      b.status.failed = b.status.failed.filter(path => path !== rel);
      if (!b.status.failed.length && b.status.state !== 'error') b.status.error = undefined;
    }
    this.publish(b);
  }

  private async itemFailed(b: Bound, rel: string, source: string, error: unknown): Promise<void> {
    if (error instanceof TransferCanceled || b.controller.signal.aborted) throw new TransferCanceled();
    const coded = fileError(error);
    // Only a local deletion is ignored; a missing server folder has the same code and must show as a failure.
    if ((coded.code === 'files.sourceNotFound' || coded.code === 'files.notFound') && !(await lstat(source).catch(() => null))) return;
    if (!b.status.failed.includes(rel) && b.status.failed.length < MAX_LISTED) b.status.failed.push(rel);
    b.status.error = coded;
    this.publish(b);
  }

  private fail(b: Bound, error: unknown): void {
    b.watcher?.close();
    clearTimeout(b.timer);
    b.controller.abort();
    b.status.state = 'error';
    b.status.error = fileError(error);
    this.publish(b, true);
  }

  private setState(b: Bound, state: 'syncing' | 'watching'): void {
    if (b.closed || b.status.state === 'error') return;
    b.status.state = state;
    this.publish(b, true);
  }

  private view(b: Bound): AutoUploadStatus {
    const skipped = [...b.skipped];
    return { ...b.status, skipped: skipped.slice(0, MAX_LISTED), skippedMore: Math.max(0, skipped.length - MAX_LISTED), failed: [...b.status.failed],
      ...(b.status.last ? { last: { ...b.status.last } } : {}) };
  }

  /** State changes go out at once, counters at most every 200 ms. */
  private publish(b: Bound, immediate = false): void {
    if (b.closed) return;
    const send = (): void => {
      clearTimeout(b.emitTimer);
      b.emitTimer = undefined;
      if (!b.closed) this.deps.emit(this.view(b));
    };
    if (immediate) send();
    else b.emitTimer ??= setTimeout(send, EMIT_INTERVAL);
  }
}

const pathKey = (path: string): string => `${win32.resolve(path).replace(/\\+$/, '').toLowerCase()}\\`;
