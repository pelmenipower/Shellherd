import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ConflictChoice, TransferConflict, TransferJob } from '../../shared/sftp';
import { FileError, unsafeLocalName } from './file-system';
import type { FileSystem } from './file-system';

const MAX_PLANNED = 100_000;

export interface PlannedItem { source: string; target: string; type: 'file' | 'directory'; size: number; modified: number; name: string }

export interface TransferHooks {
  /** Called on every chunk; the caller throttles. */
  progress: (job: TransferJob) => void;
  conflict: (conflict: Omit<TransferConflict, 'conflictId' | 'jobId'>) => Promise<{ choice: ConflictChoice; applyToAll: boolean }>;
}

export class TransferCanceled extends Error {}

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new TransferCanceled();
}

/** Expands folders into a flat, ordered list: every folder comes before its contents. Links to folders are skipped. */
export async function planTransfer(from: FileSystem, to: FileSystem, sources: string[], targetDir: string, signal: AbortSignal): Promise<{ items: PlannedItem[]; skipped: number }> {
  const items: PlannedItem[] = [];
  let skipped = 0;
  const add = (item: PlannedItem): void => {
    if (items.length >= MAX_PLANNED) throw new FileError('files.tooManyPlanned', { max: MAX_PLANNED });
    items.push(item);
  };
  const walk = async (dir: string, target: string): Promise<void> => {
    checkAborted(signal);
    for (const entry of await from.list(dir)) {
      if (unsafeLocalName(entry.name)) { skipped += 1; continue; }
      const source = from.join(dir, entry.name);
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

/** Copies (or moves) planned items; asks about existing files unless a previous answer applies to all. */
export async function runTransfer(job: TransferJob, items: PlannedItem[], from: FileSystem, to: FileSystem, hooks: TransferHooks, signal: AbortSignal): Promise<void> {
  let policy: ConflictChoice | undefined;
  job.totalFiles = items.filter(item => item.type === 'file').length;
  job.totalBytes = items.reduce((total, item) => total + item.size, 0);
  hooks.progress(job);
  for (const item of items) {
    checkAborted(signal);
    job.current = item.name;
    const existing = await to.stat(item.target);
    if (item.type === 'directory') {
      if (existing && existing.type !== 'directory') throw new FileError('files.existsAsFile', { name: item.name });
      if (!existing) await to.mkdir(item.target);
      continue;
    }
    if (existing) {
      if (existing.type === 'directory') throw new FileError('files.existsAsDirectory', { name: item.name });
      let choice = policy;
      if (!choice) {
        const answer = await hooks.conflict({ name: item.name, source: { size: item.size, modified: item.modified },
          target: { size: existing.size, modified: existing.modified } });
        choice = answer.choice;
        if (answer.applyToAll) policy = choice;
      }
      checkAborted(signal);
      if (choice === 'cancel') throw new TransferCanceled();
      // Servers keep whole seconds; a smaller difference is not "newer".
      if (choice === 'skip' || (choice === 'newer' && item.modified <= existing.modified + 1000)) {
        job.skippedFiles += 1; job.doneBytes += item.size; hooks.progress(job);
        continue;
      }
    }
    // Write through links to the real file; the .part swap must not replace the link itself.
    const target = existing ? await to.realpath(item.target) : item.target;
    await copyFile(job, item, target, existing?.mode, from, to, hooks, signal);
    await to.setModified(target, item.modified).catch(() => {});
    if (job.move) await from.removeFile(item.source);
    job.doneFiles += 1;
    hooks.progress(job);
  }
  if (job.move) {
    // Deepest folders first; folders that still hold skipped files stay.
    for (const item of [...items].reverse()) if (item.type === 'directory') await from.removeDirectory(item.source).catch(() => {});
  }
  job.current = undefined;
}

async function copyFile(job: TransferJob, item: PlannedItem, target: string, mode: number | undefined, from: FileSystem, to: FileSystem, hooks: TransferHooks, signal: AbortSignal): Promise<void> {
  const before = job.doneBytes;
  const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    job.doneBytes += chunk.length;
    hooks.progress(job);
    callback(null, chunk);
  } });
  // shortcut: a real file named x.part collides (and is removed on failure); upgrade when someone reports it.
  const partial = `${target}.part`;
  try {
    await pipeline(from.read(item.source), counter, to.write(partial, mode), { signal });
  } catch (error) {
    await to.removeFile(partial).catch(() => {});
    if (signal.aborted) throw new TransferCanceled();
    throw error;
  }
  // Local rename replaces the target; OpenSSH SFTP refuses an existing one, so it is removed first there.
  await to.rename(partial, target).catch(async () => {
    await to.removeFile(target).catch(() => {});
    await to.rename(partial, target).catch(async error => {
      // The old file survived (e.g. locked): drop the copy. Otherwise `.part` is the only copy and stays.
      if (await to.stat(target).catch(() => null)) await to.removeFile(partial).catch(() => {});
      throw error;
    });
  });
  // Files that changed size while copying still count once.
  job.doneBytes = before + item.size;
}
