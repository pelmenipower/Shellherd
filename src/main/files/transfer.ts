import type { ConflictChoice, FileEntry, TransferConflict, TransferJob } from '../../shared/sftp';
import { FileError, mapLimit, unsafeLocalName } from './file-system';
import { rateMeter } from './transfer-rate';
import type { RateMeter } from './transfer-rate';
import type { FileSystem, ReadHandle, WriteHandle } from './file-system';

const MAX_PLANNED = 100_000;

export interface PlannedItem { source: string; target: string; type: 'file' | 'directory'; size: number; modified: number; name: string }

export interface TransferHooks {
  /** Called on every chunk; the caller throttles. */
  progress: (job: TransferJob) => void;
  conflict: (conflict: Omit<TransferConflict, 'conflictId' | 'jobId'>) => Promise<{ choice: ConflictChoice; applyToAll: boolean }>;
  /** Keep a half-written .part after a cancel or failure so a later run can resume it; the queue keeps, auto-upload removes. */
  keepPartial?: boolean;
  /** A file arrived at its target (after the swap). */
  copied?: (source: string, target: string) => void;
}

/** Copy window: pieces of `chunk` bytes, at most `inFlight` unconfirmed, `files` copied at once per job. Tests change and restore it.
 *  31 KiB stays below ssh2's 31 952-byte limit for servers without OpenSSH ident, so no piece is ever split (a split's tail goes out after a close). */
export const TUNING = { chunk: 31 * 1024, inFlight: 128, files: 4 };
/** Bytes that may be unconfirmed at any time; a leftover .part is resumed this far before its end.
 *  Never lower it below 128 x 31 KiB in a later version or a setting: older .part files may hold gaps that far back (R16). */
export const windowBytes = (): number => TUNING.chunk * TUNING.inFlight;
const TAIL_BYTES = 1024 * 1024;
const CLOSE_WAIT_MS = 10_000;

/** Closing after a cancel or failure: a silent or dead server must not hold the job; the result does not matter there. */
async function settle(closing: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([closing.catch(() => {}), new Promise<void>(resolve => { timer = setTimeout(resolve, CLOSE_WAIT_MS); })]);
  clearTimeout(timer);
}

export class TransferCanceled extends Error {}

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new TransferCanceled();
}

/** Expands folders into a flat, ordered list: every folder comes before its contents. Links to folders are skipped. */
export async function planTransfer(from: FileSystem, to: FileSystem, sources: string[], targetDir: string, signal: AbortSignal,
  skip?: (source: string, entry: FileEntry) => boolean): Promise<{ items: PlannedItem[]; skipped: number }> {
  const items: PlannedItem[] = [];
  let skipped = 0;
  const add = (item: PlannedItem): void => {
    if (items.length >= MAX_PLANNED) throw new FileError('files.tooManyPlanned', { max: MAX_PLANNED });
    items.push(item);
  };
  const walk = async (dir: string, target: string): Promise<void> => {
    checkAborted(signal);
    for (const entry of await from.list(dir)) {
      const source = from.join(dir, entry.name);
      if (unsafeLocalName(entry.name) || skip?.(source, entry)) { skipped += 1; continue; }
      const destination = to.join(target, entry.name);
      const type = entry.type === 'link' ? entry.linkTarget : entry.type;
      if (type === 'directory' && entry.type === 'directory') {
        add({ source, target: destination, type, size: 0, modified: entry.modified, name: entry.name });
        await walk(source, destination);
      } else if (type === 'file') add({ source, target: destination, type, size: entry.size, modified: entry.modified, name: entry.name });
      else skipped += 1;
    }
  };
  for (const source of sources) {
    checkAborted(signal);
    const entry = await from.stat(source);
    if (!entry) throw new FileError('files.sourceNotFound', { name: from.basename(source) });
    const name = from.basename(source);
    if (unsafeLocalName(name)) throw new FileError('files.unsafeName', { name });
    const target = to.join(targetDir, name);
    if (entry.type === 'directory') {
      add({ source, target, type: 'directory', size: 0, modified: entry.modified, name });
      await walk(source, target);
    } else add({ source, target, type: 'file', size: entry.size, modified: entry.modified, name });
  }
  return { items, skipped };
}

/** Copies (or moves) planned items; asks about existing files unless a previous answer applies to all. Up to `TUNING.files` files run at once. */
export async function runTransfer(job: TransferJob, items: PlannedItem[], from: FileSystem, to: FileSystem, hooks: TransferHooks, signal: AbortSignal): Promise<void> {
  const rate = rateMeter();
  let policy: ConflictChoice | undefined;
  let asking: Promise<unknown> = Promise.resolve();
  const partials = new Set<string>();
  const running = new Map<PlannedItem, string>();
  job.totalFiles = items.filter(item => item.type === 'file').length;
  job.totalBytes = items.reduce((total, item) => total + item.size, 0);
  hooks.progress(job);
  // One failure or cancel stops every worker; the first error is the job's error.
  const inner = new AbortController();
  const stop = AbortSignal.any([signal, inner.signal]);
  const stopped = new Promise<never>((_, reject) => stop.addEventListener('abort', () => reject(new TransferCanceled()), { once: true }));
  stopped.catch(() => {});
  // Folders first, parents before children (plan order); files afterwards, a few at a time.
  for (const item of items) {
    if (item.type !== 'directory') continue;
    checkAborted(stop);
    const existing = await to.stat(item.target);
    if (existing && existing.type !== 'directory') throw new FileError('files.existsAsFile', { name: item.name });
    if (!existing) await to.mkdir(item.target);
  }
  // The session holds one open question at a time; an answer "for all" settles the questions still waiting.
  const decide = (item: PlannedItem, existing: FileEntry): Promise<ConflictChoice> => {
    const turn = asking.then(async () => {
      // Questions still waiting when the job stops are never shown.
      checkAborted(stop);
      if (policy) return policy;
      job.bytesPerSecond = undefined; rate.reset();
      // A failing worker stops the job while a question is open; the answer no longer matters then.
      const answer = await Promise.race([hooks.conflict({ name: item.name, source: { size: item.size, modified: item.modified },
        target: { size: existing.size, modified: existing.modified } }), stopped]);
      if (answer.applyToAll) policy = answer.choice;
      return answer.choice;
    });
    asking = turn.catch(() => {});
    return turn;
  };
  let failure: unknown;
  const one = async (item: PlannedItem): Promise<void> => {
    checkAborted(stop);
    running.set(item, item.name); job.current = [...running.values()].join(', ');
    try {
      const existing = await to.stat(item.target);
      if (existing) {
        if (existing.type === 'directory') throw new FileError('files.existsAsDirectory', { name: item.name });
        const choice = policy ?? await decide(item, existing);
        checkAborted(stop);
        if (choice === 'cancel') throw new TransferCanceled();
        // Servers keep whole seconds; a smaller difference is not "newer".
        if (choice === 'skip' || (choice === 'newer' && item.modified <= existing.modified + 1000)) {
          job.skippedFiles += 1; job.doneBytes += item.size; hooks.progress(job);
          return;
        }
      }
      // Write through links to the real file; the .part swap must not replace the link itself.
      // Some virtual Windows drives cannot resolve paths; overwriting the path itself still works there.
      const target = existing ? await to.realpath(item.target).catch(() => item.target) : item.target;
      await copyFile(job, item, target, existing?.mode, from, to, hooks, rate, partials, stop);
      await to.setModified(target, item.modified).catch(() => {});
      if (job.move) {
        await from.removeFile(item.source);
        // A resumed move must not ask for sources that are already gone.
        if (job.sources) job.sources = job.sources.filter(source => source !== item.source);
      }
      hooks.copied?.(item.source, target);
      job.doneFiles += 1;
      hooks.progress(job);
    } finally { running.delete(item); job.current = [...running.values()].join(', ') || undefined; }
  };
  const files = items.filter(item => item.type === 'file');
  const targets = new Set(files.map(item => item.target.toLowerCase()));
  // Windows ignores case, and a file named like another file's .part shares that .part: such jobs copy one file at a time, like before.
  const shared = targets.size < files.length || [...targets].some(target => target.endsWith('.part') && targets.has(target.slice(0, -'.part'.length)));
  const width = shared ? 1 : TUNING.files;
  // x before x.part: copying x renames its own x.part away, so the real x.part must come after it.
  const order = shared ? [...files].sort((a, b) => Number(a.target.toLowerCase().endsWith('.part')) - Number(b.target.toLowerCase().endsWith('.part'))) : files;
  await mapLimit(order, width, async item => {
    if (failure !== undefined) return;
    try { await one(item); } catch (error) { failure ??= error; inner.abort(); }
  });
  if (failure !== undefined) throw failure;
  if (job.move) {
    // Deepest folders first; folders that still hold skipped files stay.
    for (const item of [...items].reverse()) if (item.type === 'directory') await from.removeDirectory(item.source).catch(() => {});
  }
  job.current = undefined;
}

/** Copies [start, size) in pieces. Pieces go out in order; the oldest unconfirmed piece blocks new ones, so unconfirmed bytes
 *  never span more than windowBytes(), whatever order the confirmations arrive in. Confirmed bytes are reported as they come. */
export async function copyRange(source: ReadHandle, target: WriteHandle, start: number, size: number, signal: AbortSignal,
  onConfirmed: (bytes: number) => void): Promise<void> {
  const pending = new Map<number, Promise<void>>();
  let failure: unknown;
  let eof = false;
  let offset = start;
  let open = true;
  const piece = async (at: number): Promise<void> => {
    const want = Math.min(TUNING.chunk, size - at);
    const data = await source.read(want, at);
    if (data.length < want) eof = true;
    // Pieces that land after a cancel are not reported: the job has already ended.
    if (data.length) { await target.write(data, at); if (open) onConfirmed(data.length); }
  };
  try {
    while (pending.size || (!eof && offset < size && failure === undefined)) {
      checkAborted(signal);
      while (!eof && offset < size && failure === undefined && pending.size < TUNING.inFlight) {
        pending.set(offset, piece(offset).catch(error => { failure ??= error; }));
        offset += TUNING.chunk;
      }
      const oldest = pending.keys().next().value as number;
      await untilDoneOrAborted(pending.get(oldest)!, signal);
      pending.delete(oldest);
    }
  } finally { open = false; }
  if (failure !== undefined) throw failure;
}

/** Waits for `piece` or a cancel, whichever comes first; leaves nothing attached afterwards (a race against one long-lived promise keeps every round alive).
 *  A cancel must leave the loop at once, even while the oldest piece hangs on a silent server. */
function untilDoneOrAborted(piece: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => reject(new TransferCanceled());
    signal.addEventListener('abort', onAbort, { once: true });
    void piece.then(() => { signal.removeEventListener('abort', onAbort); resolve(); });
  });
}

async function copyFile(job: TransferJob, item: PlannedItem, target: string, mode: number | undefined, from: FileSystem, to: FileSystem,
  hooks: TransferHooks, rate: RateMeter, partials: Set<string>, signal: AbortSignal): Promise<void> {
  // shortcut: a real file named x.part is taken for ours (resumed when it matches, removed otherwise); upgrade when someone reports it.
  const partial = `${target}.part`;
  const part = await to.stat(partial);
  // A folder named x.part is never ours; discarding it would delete it recursively.
  if (part && part.type !== 'file') throw new FileError('files.existsAsDirectory', { name: to.basename(partial) });
  const source = await from.openRead(item.source);
  try {
    let offset = 0;
    if (part && part.size > windowBytes()) {
      if (await resumable(source, item, to, partial, part)) { offset = part.size - windowBytes(); job.resumedFrom = (job.resumedFrom ?? 0) + offset; }
      else { await to.removeFile(partial); job.restarted = true; }
    }
    checkAborted(signal);
    partials.add(partial); job.partials = [...partials];
    let counted = offset;
    if (offset) { job.doneBytes += offset; hooks.progress(job); }
    try {
      const dest = await to.openWrite(partial, mode, offset > 0);
      try {
        await copyRange(source, dest, offset, item.size, signal, bytes => { counted += bytes; job.doneBytes += bytes; job.bytesPerSecond = rate.add(bytes); hooks.progress(job); });
      } catch (error) { await settle(dest.close()); throw error; }
      // Some servers commit the data only on close; a failed close is a failed copy.
      await dest.close();
    } catch (error) {
      if (!hooks.keepPartial) { await to.removeFile(partial).catch(() => {}); partials.delete(partial); job.partials = [...partials]; }
      if (signal.aborted) throw new TransferCanceled();
      throw error;
    }
    // Local rename replaces the target; OpenSSH SFTP refuses an existing one, so it is removed first there.
    await to.rename(partial, target).catch(async (error: unknown) => {
      // The .part is gone (removed elsewhere): the old target must survive.
      if (!await to.stat(partial).catch(() => null)) throw error;
      await to.removeFile(target).catch(() => {});
      await to.rename(partial, target).catch(async (retryError: unknown) => {
        // The old file survived (e.g. locked): drop the copy. Otherwise `.part` is the only copy and stays.
        if (await to.stat(target).catch(() => null)) { await to.removeFile(partial).catch(() => {}); partials.delete(partial); job.partials = [...partials]; }
        throw retryError;
      });
    });
    partials.delete(partial); job.partials = [...partials];
    // Files that changed size while copying still count once; other files may have counted meanwhile, so add the difference.
    job.doneBytes += item.size - counted;
  } finally { await settle(source.close()); }
}

/** A leftover .part longer than one window continues the copy at `size - window`: everything after that point may hold gaps and is rewritten,
 *  everything before it was confirmed. It qualifies when it is not longer or newer than the source and its last megabyte before that point equals the source there. */
async function resumable(source: ReadHandle, item: PlannedItem, to: FileSystem, partial: string, part: FileEntry): Promise<boolean> {
  // Servers keep whole seconds (same rule as the conflict check).
  if (part.size > item.size || item.modified > part.modified + 1000) return false;
  const end = part.size - windowBytes();
  const start = Math.max(0, end - TAIL_BYTES);
  const ours = await to.openRead(partial);
  try {
    const [mine, theirs] = await Promise.all([ours.read(end - start, start), source.read(end - start, start)]);
    return mine.length === end - start && mine.equals(theirs);
  } finally { await settle(ours.close()); }
}
