import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry, TransferJob } from '../../shared/sftp';
import type { FileSystem, ReadHandle, WriteHandle } from './file-system';
import { copyRange, planTransfer, runTransfer, TransferCanceled, TUNING, windowBytes } from './transfer';
import type { TransferHooks } from './transfer';

type Node = { type: 'file'; data: string; modified: number } | { type: 'directory' };

/** How the fake target lands writes. */
interface Behavior {
  /** Every write lands after [3, 0, 2, 1][index % 4] ms: confirmations arrive out of order. */
  shuffle?: boolean;
  /** Writes at or beyond this offset never resolve and never land. */
  stallFrom?: number;
  /** Awaited before a write lands. */
  gate?: (position: number) => Promise<void> | undefined;
  /** `close` of a write handle rejects with this. */
  closeError?: Error;
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));
const pattern = (length: number): string => Array.from({ length }, (_, index) => String.fromCharCode(index % 251)).join('');
const sha = (text: string): string => createHash('sha256').update(text, 'latin1').digest('hex');
const DEFAULTS = { ...TUNING };

/** Synthetic file system; paths are POSIX on both sides. Data is a latin1 string, positioned writes fill gaps with \0. */
function memory(files: Record<string, string | null>, modified = 1000, behavior: Behavior = {}): FileSystem & { nodes: Map<string, Node>; behavior: Behavior } {
  const nodes = new Map<string, Node>([['/', { type: 'directory' }]]);
  for (const [path, data] of Object.entries(files)) nodes.set(path, data === null ? { type: 'directory' } : { type: 'file', data, modified });
  const entry = (path: string, node: Node): FileEntry => node.type === 'file'
    ? { name: posix.basename(path), type: 'file', size: node.data.length, modified: node.modified }
    : { name: posix.basename(path), type: 'directory', size: 0, modified: 0 };
  return {
    nodes, behavior,
    join: posix.join, basename: posix.basename,
    list: async dir => [...nodes].filter(([path]) => path !== dir && posix.dirname(path) === dir).map(([path, node]) => entry(path, node)),
    stat: async path => { const node = nodes.get(path); return node ? entry(path, node) : null; },
    mkdir: async path => { nodes.set(path, { type: 'directory' }); },
    read: () => { throw new Error('streams are not used by transfers'); },
    write: () => { throw new Error('streams are not used by transfers'); },
    openRead: async path => {
      const node = nodes.get(path);
      if (node?.type !== 'file') throw new Error('missing');
      const data = Buffer.from(node.data, 'latin1');
      return { read: async (length, position) => data.subarray(position, position + length), close: async () => {} };
    },
    openWrite: async (path, _mode, resume) => {
      const existing = nodes.get(path);
      if (resume && existing?.type !== 'file') throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      if (!resume) nodes.set(path, { type: 'file', data: '', modified: 0 });
      let index = 0;
      let closed = false;
      return {
        write: async (data, position) => {
          if (closed) throw new Error('handle closed');
          const delay = behavior.shuffle ? [3, 0, 2, 1][index++ % 4] : 0;
          if (behavior.stallFrom !== undefined && position >= behavior.stallFrom) return new Promise<void>(() => {});
          await behavior.gate?.(position);
          if (delay) await sleep(delay);
          const node = nodes.get(path);
          // A write to a removed file lands nowhere.
          if (node?.type !== 'file') return;
          const padded = node.data.padEnd(position, '\0');
          nodes.set(path, { type: 'file', data: padded.slice(0, position) + data.toString('latin1') + padded.slice(position + data.length), modified: node.modified });
        },
        close: async () => { closed = true; if (behavior.closeError) throw behavior.closeError; },
      };
    },
    setModified: async (path, value) => { const node = nodes.get(path); if (node?.type === 'file') node.modified = value; },
    removeFile: async path => { nodes.delete(path); },
    removeDirectory: async path => { if ([...nodes.keys()].some(other => posix.dirname(other) === path && other !== path)) throw new Error('not empty'); nodes.delete(path); },
    rename: async (from, to) => { const node = nodes.get(from); if (node) { nodes.delete(from); nodes.set(to, node); } },
    realpath: async path => path,
  };
}

const newJob = (move = false): TransferJob => ({ id: 'job', direction: 'upload', move, label: 'x', entryCount: 1, targetDir: '/target', state: 'running',
  totalBytes: 0, doneBytes: 0, totalFiles: 0, doneFiles: 0, skippedFiles: 0 });
const hooks = (conflict: TransferHooks['conflict'] = async () => ({ choice: 'overwrite', applyToAll: false })): TransferHooks => ({ progress: () => {}, conflict });
const signal = () => new AbortController().signal;

async function transfer(from: FileSystem, to: FileSystem, sources: string[], job = newJob(), transferHooks = hooks(), abort = signal()) {
  const { items } = await planTransfer(from, to, sources, '/target', abort);
  await runTransfer(job, items, from, to, transferHooks, abort);
  return job;
}

afterEach(() => { Object.assign(TUNING, DEFAULTS); });

describe('file transfer', () => {
  it('never lowers the window (R16)', () => {
    // R16: lowering W breaks resuming .part files of earlier versions.
    expect(windowBytes()).toBeGreaterThanOrEqual(128 * 31 * 1024);
  });

  describe('rate', () => {
    it('reports a rate once the window spans a second', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        TUNING.chunk = 1024;
        const from = memory({ '/a.txt': 'x'.repeat(3072) });
        const seen: (number | undefined)[] = [];
        const progress = (job: TransferJob): void => { seen.push(job.bytesPerSecond); vi.setSystemTime(Date.now() + 600); };
        await transfer(from, memory({ '/target': null }), ['/a.txt'], newJob(), { ...hooks(), progress });
        expect(seen).toHaveLength(5);
        expect(seen.slice(0, 3)).toEqual([undefined, undefined, undefined]);
        expect(seen[3]).toBeCloseTo(2048 / 1.2, 3);
        expect(seen[4]).toBeCloseTo(2048 / 1.2, 3);
      } finally { vi.useRealTimers(); }
    });

    it('clears the rate during a conflict question and restarts the window', async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      try {
        TUNING.chunk = 1024;
        TUNING.files = 1;
        const from = memory({ '/a.txt': 'x'.repeat(3072), '/b.txt': 'x'.repeat(3072) });
        const to = memory({ '/target': null, '/target/b.txt': 'old' });
        const seen: (number | undefined)[] = [];
        let atConflict: number | undefined = -1;
        let asked = -1;
        const progress = (job: TransferJob): void => { seen.push(job.bytesPerSecond); vi.setSystemTime(Date.now() + 600); };
        const job = newJob();
        const conflict: TransferHooks['conflict'] = async () => {
          atConflict = job.bytesPerSecond; asked = seen.length;
          return { choice: 'overwrite', applyToAll: false };
        };
        await transfer(from, to, ['/a.txt', '/b.txt'], job, { progress, conflict });
        expect(seen.slice(0, asked).some(value => typeof value === 'number')).toBe(true);
        expect(atConflict).toBeUndefined();
        expect(seen[asked]).toBeUndefined();
      } finally { vi.useRealTimers(); }
    });
  });

  it('copies folders recursively, keeping times and creating folders before their files', async () => {
    const from = memory({ '/src': null, '/src/a.txt': 'alpha', '/src/sub': null, '/src/sub/b.txt': 'beta' }, 5000);
    const to = memory({ '/target': null });
    const { items } = await planTransfer(from, to, ['/src'], '/target', signal());
    expect(items.map(item => item.target)).toEqual(['/target/src', '/target/src/a.txt', '/target/src/sub', '/target/src/sub/b.txt']);
    const job = await transfer(from, to, ['/src']);
    expect(to.nodes.get('/target/src/sub/b.txt')).toEqual({ type: 'file', data: 'beta', modified: 5000 });
    expect(job).toMatchObject({ totalFiles: 2, doneFiles: 2, totalBytes: 9, doneBytes: 9 });
  });

  it('asks once per existing file unless the answer applies to all', async () => {
    const from = memory({ '/a.txt': 'new-a', '/b.txt': 'new-b' });
    const to = memory({ '/target': null, '/target/a.txt': 'old', '/target/b.txt': 'old' });
    const conflict = vi.fn(async () => ({ choice: 'skip' as const, applyToAll: true }));
    const job = await transfer(from, to, ['/a.txt', '/b.txt'], newJob(), hooks(conflict));
    expect(conflict).toHaveBeenCalledTimes(1);
    expect(job.skippedFiles).toBe(2);
    expect(to.nodes.get('/target/a.txt')).toMatchObject({ data: 'old' });
  });

  it('copies only newer files when asked to', async () => {
    const from = memory({ '/a.txt': 'source' }, 10_000);
    const older = memory({ '/target': null, '/target/a.txt': 'target' }, 9_500);
    await transfer(from, older, ['/a.txt'], newJob(), hooks(async () => ({ choice: 'newer', applyToAll: false })));
    expect(older.nodes.get('/target/a.txt')).toMatchObject({ data: 'target' });
    const outdated = memory({ '/target': null, '/target/a.txt': 'target' }, 2_000);
    await transfer(from, outdated, ['/a.txt'], newJob(), hooks(async () => ({ choice: 'newer', applyToAll: false })));
    expect(outdated.nodes.get('/target/a.txt')).toMatchObject({ data: 'source' });
  });

  it('moves: deletes copied sources and empty folders, keeps skipped files', async () => {
    const from = memory({ '/src': null, '/src/a.txt': 'a', '/src/b.txt': 'b' });
    const to = memory({ '/target': null, '/target/src': null, '/target/src/b.txt': 'keep' });
    await transfer(from, to, ['/src'], newJob(true), hooks(async () => ({ choice: 'skip', applyToAll: false })));
    expect(from.nodes.has('/src/a.txt')).toBe(false);
    expect(from.nodes.has('/src/b.txt')).toBe(true);
    expect(from.nodes.has('/src')).toBe(true);
  });

  it('cancels from the conflict question', async () => {
    const from = memory({ '/a.txt': 'a' });
    const to = memory({ '/target': null, '/target/a.txt': 'old' });
    await expect(transfer(from, to, ['/a.txt'], newJob(), hooks(async () => ({ choice: 'cancel', applyToAll: false })))).rejects.toBeInstanceOf(TransferCanceled);
    expect(to.nodes.get('/target/a.txt')).toMatchObject({ data: 'old' });
  });

  it('leaves at once when aborted while a piece hangs, removing the half-written file', async () => {
    TUNING.chunk = 10; TUNING.inFlight = 4;
    const controller = new AbortController();
    const slow = memory({ '/big.bin': 'x'.repeat(100) });
    // The first piece arrives, the rest never does (a silent server).
    slow.openRead = async () => ({ read: async (length, position) => position === 0 ? Buffer.alloc(length) : new Promise<Buffer>(() => {}), close: async () => {} });
    const target = memory({ '/target': null });
    setTimeout(() => controller.abort(), 5);
    const job = newJob();
    await expect(transfer(slow, target, ['/big.bin'], job, hooks(), controller.signal)).rejects.toBeInstanceOf(TransferCanceled);
    expect(target.nodes.has('/target/big.bin')).toBe(false);
    expect(target.nodes.has('/target/big.bin.part')).toBe(false);
    expect(job.partials).toEqual([]);
  });

  it('refuses to replace a folder with a file', async () => {
    const from = memory({ '/a': 'file' });
    const to = memory({ '/target': null, '/target/a': null });
    await expect(transfer(from, to, ['/a'])).rejects.toMatchObject({ code: 'files.existsAsDirectory' });
  });

  it('skips server names that are unsafe on Windows and rejects an unsafe top-level name', async () => {
    const from = memory({ '/dir': null, '/dir/..\\evil.bat': 'x', '/dir/a:b': 'x', '/dir/trail.': 'x', '/dir/ok.txt': 'ok' });
    const to = memory({ '/target': null });
    const { items, skipped } = await planTransfer(from, to, ['/dir'], '/target', signal());
    expect(items.map(item => item.target)).toEqual(['/target/dir', '/target/dir/ok.txt']);
    expect(skipped).toBe(3);
    await expect(planTransfer(memory({ '/src/x:y': 'x' }), to, ['/src/x:y'], '/target', signal())).rejects.toMatchObject({ code: 'files.unsafeName' });
  });

  it('skip hook prunes folders, counts as skipped and gets the full source path', async () => {
    const from = memory({ '/dir': null, '/dir/node_modules': null, '/dir/node_modules/x.js': 'x', '/dir/ok.txt': 'ok' });
    const to = memory({ '/target': null });
    const list = vi.spyOn(from, 'list');
    const seen: string[] = [];
    const { items, skipped } = await planTransfer(from, to, ['/dir'], '/target', signal(), (source, entry) => { seen.push(source); return entry.name === 'node_modules'; });
    expect(items.map(item => item.target)).toEqual(['/target/dir', '/target/dir/ok.txt']);
    expect(skipped).toBe(1);
    expect(seen).toContain('/dir/node_modules');
    expect(list.mock.calls.map(call => call[0])).toEqual(['/dir']);
  });

  it('keeps the existing target when reading fails and leaves no .part behind', async () => {
    TUNING.chunk = 2;
    const from = memory({ '/a.txt': 'new' });
    const open = from.openRead;
    from.openRead = async path => {
      const handle = await open(path);
      return { read: (length, position) => position ? Promise.reject(new Error('read')) : handle.read(length, position), close: handle.close };
    };
    const to = memory({ '/target': null, '/target/a.txt': 'old' });
    await expect(transfer(from, to, ['/a.txt'])).rejects.toThrow('read');
    expect(to.nodes.get('/target/a.txt')).toMatchObject({ data: 'old' });
    expect(to.nodes.has('/target/a.txt.part')).toBe(false);
  });

  it('keeps the old target when closing the copy fails', async () => {
    const from = memory({ '/a.txt': 'new' });
    const to = memory({ '/target': null, '/target/a.txt': 'old' }, 1000, { closeError: new Error('boom') });
    await expect(transfer(from, to, ['/a.txt'])).rejects.toThrow('boom');
    expect(to.nodes.get('/target/a.txt')).toMatchObject({ data: 'old' });
    expect(to.nodes.has('/target/a.txt.part')).toBe(false);
  });

  it('reports nothing once a canceled copy has ended, even when a late write is confirmed', async () => {
    const from = memory({ '/a.txt': 'new' });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const to = memory({ '/target': null }, 1000, { gate: position => position === 0 ? held : undefined });
    const controller = new AbortController();
    let calls = 0;
    setTimeout(() => controller.abort(), 5);
    await expect(transfer(from, to, ['/a.txt'], newJob(), { ...hooks(), progress: () => { calls += 1; } }, controller.signal)).rejects.toBeInstanceOf(TransferCanceled);
    const before = calls;
    release();
    await sleep(10);
    expect(calls).toBe(before);
  });

  it('replaces the target on success without leaving a .part', async () => {
    const from = memory({ '/a.txt': 'new' });
    const to = memory({ '/target': null, '/target/a.txt': 'old' });
    await transfer(from, to, ['/a.txt']);
    expect(to.nodes.get('/target/a.txt')).toMatchObject({ data: 'new' });
    expect(to.nodes.has('/target/a.txt.part')).toBe(false);
  });

  it('overwrites the real file behind a link instead of replacing the link', async () => {
    const from = memory({ '/link': 'new' });
    const to = memory({ '/target': null, '/target/link': 'old', '/target/real': 'old' });
    to.realpath = async path => path === '/target/link' ? '/target/real' : path;
    await transfer(from, to, ['/link']);
    expect(to.nodes.get('/target/real')).toMatchObject({ data: 'new' });
    expect(to.nodes.get('/target/link')).toMatchObject({ data: 'old' });
    expect(to.nodes.has('/target/real.part')).toBe(false);
  });

  it('overwrites the target itself when resolving it fails', async () => {
    const from = memory({ '/a.txt': 'new' });
    const to = memory({ '/target': null, '/target/a.txt': 'old' });
    to.realpath = async () => { throw new Error('EISDIR: illegal operation on a directory, realpath'); };
    await transfer(from, to, ['/a.txt']);
    expect(to.nodes.get('/target/a.txt')).toMatchObject({ data: 'new' });
  });

  it('passes the mode of the existing target to the writer', async () => {
    const from = memory({ '/a.txt': 'new' });
    const to = memory({ '/target': null, '/target/a.txt': 'old' });
    const stat = to.stat;
    to.stat = async path => { const entry = await stat(path); return entry && { ...entry, mode: 0o600 }; };
    const open = vi.spyOn(to, 'openWrite');
    await transfer(from, to, ['/a.txt']);
    expect(open).toHaveBeenCalledWith('/target/a.txt.part', 0o600, false);
  });

  describe('rename that refuses an existing target', () => {
    const strict = () => {
      const from = memory({ '/a.txt': 'new' });
      const to = memory({ '/target': null, '/target/a.txt': 'old' });
      const rename = to.rename;
      to.rename = async (source, target) => { if (to.nodes.has(target)) throw new Error('exists'); await rename(source, target); };
      return { from, to };
    };

    it('removes the old target and renames again', async () => {
      const { from, to } = strict();
      await transfer(from, to, ['/a.txt']);
      expect(to.nodes.get('/target/a.txt')).toMatchObject({ data: 'new' });
      expect(to.nodes.has('/target/a.txt.part')).toBe(false);
    });

    it('keeps the old target and drops the copy when the target cannot be removed', async () => {
      const { from, to } = strict();
      to.removeFile = async path => { if (path === '/target/a.txt') throw new Error('locked'); to.nodes.delete(path); };
      await expect(transfer(from, to, ['/a.txt'])).rejects.toThrow('exists');
      expect(to.nodes.get('/target/a.txt')).toMatchObject({ data: 'old' });
      expect(to.nodes.has('/target/a.txt.part')).toBe(false);
    });

    it('keeps the old target when the .part vanished before the swap', async () => {
      const { from, to } = strict();
      const open = to.openWrite;
      to.openWrite = async (path, mode, resume) => {
        const handle = await open(path, mode, resume);
        return { write: handle.write, close: async () => { await handle.close(); to.nodes.delete(path); } };
      };
      await expect(transfer(from, to, ['/a.txt'])).rejects.toThrow('exists');
      expect(to.nodes.get('/target/a.txt')).toMatchObject({ data: 'old' });
    });
  });

  describe('resuming a .part', () => {
    const SOURCE = 'abcdefgh';
    const setup = (part: string, sourceModified = 1000) => {
      TUNING.chunk = 1; TUNING.inFlight = 2;
      const from = memory({ '/a.bin': SOURCE }, sourceModified);
      const to = memory({ '/target': null, '/target/a.bin.part': part });
      return { from, to, open: vi.spyOn(to, 'openWrite'), remove: vi.spyOn(to, 'removeFile') };
    };

    it('continues one window before the end when the bytes before it match', async () => {
      const { from, to, open } = setup('abcde');
      const job = await transfer(from, to, ['/a.bin']);
      expect(job).toMatchObject({ resumedFrom: 3, doneBytes: 8, partials: [] });
      expect(job.restarted).toBeUndefined();
      expect(to.nodes.get('/target/a.bin')).toMatchObject({ data: SOURCE });
      expect(open).toHaveBeenCalledWith('/target/a.bin.part', undefined, true);
    });

    it('starts over when the bytes before the resume point differ', async () => {
      const { from, to, remove } = setup('abXde');
      const job = await transfer(from, to, ['/a.bin']);
      expect(job.restarted).toBe(true);
      expect(remove).toHaveBeenCalledWith('/target/a.bin.part');
      expect(to.nodes.get('/target/a.bin')).toMatchObject({ data: SOURCE });
    });

    it('starts over when the .part is longer than the source or the source is newer', async () => {
      const longer = setup('abcdefghij');
      expect((await transfer(longer.from, longer.to, ['/a.bin'])).restarted).toBe(true);
      const newer = setup('abcde', 10_000);
      expect((await transfer(newer.from, newer.to, ['/a.bin'])).restarted).toBe(true);
      expect(newer.to.nodes.get('/target/a.bin')).toMatchObject({ data: SOURCE });
    });

    it('rewrites the last window of a complete .part', async () => {
      const { from, to } = setup(SOURCE);
      const job = await transfer(from, to, ['/a.bin']);
      expect(job.resumedFrom).toBe(6);
      expect(to.nodes.get('/target/a.bin')).toMatchObject({ data: SOURCE });
    });

    it('rewrites a .part of at most one window from the start without a hint', async () => {
      const { from, to, open, remove } = setup('ab');
      const job = await transfer(from, to, ['/a.bin']);
      expect(job.resumedFrom).toBeUndefined();
      expect(job.restarted).toBeUndefined();
      expect(remove).not.toHaveBeenCalled();
      expect(open).toHaveBeenCalledWith('/target/a.bin.part', undefined, false);
      expect(to.nodes.get('/target/a.bin')).toMatchObject({ data: SOURCE });
    });

    it('overwrites differences after the resume point', async () => {
      const { from, to } = setup('abcdX');
      await transfer(from, to, ['/a.bin']);
      expect(to.nodes.get('/target/a.bin')).toMatchObject({ data: SOURCE });
    });

    it('refuses a folder named like the .part and leaves it alone', async () => {
      const from = memory({ '/a.bin': 'x' });
      const to = memory({ '/target': null, '/target/a.bin.part': null });
      const job = newJob();
      await expect(transfer(from, to, ['/a.bin'], job)).rejects.toMatchObject({ code: 'files.existsAsDirectory' });
      expect(to.nodes.get('/target/a.bin.part')).toEqual({ type: 'directory' });
      expect(job.partials).toBeUndefined();
    });
  });

  describe('canceling and resuming', () => {
    it('keeps the .part on cancel and a second run finishes bit for bit', async () => {
      TUNING.chunk = 4; TUNING.inFlight = 4; TUNING.files = 4;
      const text = pattern(64);
      const from = memory({ '/a.bin': text });
      const to = memory({ '/target': null }, 1000, { stallFrom: 32 });
      const controller = new AbortController();
      const first = newJob();
      const progress = (job: TransferJob): void => { if (job.doneBytes >= 32) controller.abort(); };
      await expect(transfer(from, to, ['/a.bin'], first, { ...hooks(), progress, keepPartial: true }, controller.signal)).rejects.toBeInstanceOf(TransferCanceled);
      expect(first.partials).toEqual(['/target/a.bin.part']);
      expect((to.nodes.get('/target/a.bin.part') as { data: string }).data).toHaveLength(32);
      expect(to.nodes.has('/target/a.bin')).toBe(false);
      to.behavior.stallFrom = undefined;
      const second = await transfer(from, to, ['/a.bin']);
      expect(second.resumedFrom).toBe(16);
      expect(sha(to.nodes.get('/target/a.bin')!.type === 'file' ? (to.nodes.get('/target/a.bin') as { data: string }).data : '')).toBe(sha(text));
    });

    it('deletes the .part on cancel without keepPartial', async () => {
      TUNING.chunk = 4; TUNING.inFlight = 4;
      const from = memory({ '/a.bin': pattern(64) });
      const to = memory({ '/target': null }, 1000, { stallFrom: 32 });
      const controller = new AbortController();
      const job = newJob();
      const progress = (current: TransferJob): void => { if (current.doneBytes >= 32) controller.abort(); };
      await expect(transfer(from, to, ['/a.bin'], job, { ...hooks(), progress }, controller.signal)).rejects.toBeInstanceOf(TransferCanceled);
      expect(job.partials).toEqual([]);
      expect(to.nodes.has('/target/a.bin.part')).toBe(false);
    });

    it('copies bit for bit when confirmations arrive out of order', async () => {
      TUNING.chunk = 7; TUNING.inFlight = 5;
      const text = pattern(1000);
      const to = memory({ '/target': null }, 1000, { shuffle: true });
      await transfer(memory({ '/a.bin': text }), to, ['/a.bin']);
      expect((to.nodes.get('/target/a.bin') as { data: string }).data).toBe(text);
    });
  });

  describe('copyRange', () => {
    it('never has pieces beyond one window past the oldest unconfirmed piece', async () => {
      TUNING.chunk = 4; TUNING.inFlight = 3;
      const data = Buffer.from(pattern(40), 'latin1');
      const source: ReadHandle = { read: async (length, position) => data.subarray(position, position + length), close: async () => {} };
      const issued: number[] = [];
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      const target: WriteHandle = { write: async (_data, position) => { issued.push(position); if (position === 0) await held; }, close: async () => {} };
      const done = copyRange(source, target, 0, 40, signal(), () => {});
      await sleep(20);
      expect(Math.max(...issued)).toBeLessThan(12);
      release();
      await done;
      expect([...issued].sort((a, b) => a - b)).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36]);
    });
  });

  describe('folders', () => {
    const many = (count: number): Record<string, string | null> =>
      Object.fromEntries(Array.from({ length: count }, (_, index) => [`/f${index}.txt`, `data ${index}`]));

    it('asks one question at a time and settles waiting ones with an answer for all', async () => {
      TUNING.files = 4;
      const to = memory({ '/target': null, '/target/f0.txt': 'old', '/target/f1.txt': 'old', '/target/f2.txt': 'old' });
      let open = 0; let most = 0;
      const conflict = vi.fn(async () => { open += 1; most = Math.max(most, open); await sleep(5); open -= 1; return { choice: 'overwrite' as const, applyToAll: false }; });
      await transfer(memory(many(6)), to, Object.keys(many(6)), newJob(), hooks(conflict));
      expect(most).toBe(1);
      expect(conflict).toHaveBeenCalledTimes(3);
      const all = vi.fn(async () => { await sleep(5); return { choice: 'skip' as const, applyToAll: true }; });
      const job = await transfer(memory(many(6)), memory({ '/target': null, '/target/f0.txt': 'old', '/target/f1.txt': 'old' }), Object.keys(many(6)), newJob(), hooks(all));
      expect(all).toHaveBeenCalledTimes(1);
      expect(job.skippedFiles).toBe(2);
    });

    it('stops at the first failure without hanging on a waiting question', async () => {
      TUNING.files = 4;
      const from = memory(many(3));
      const open = from.openRead;
      from.openRead = async path => { if (path === '/f2.txt') throw new Error('read failed'); return open(path); };
      const to = memory({ '/target': null, '/target/f0.txt': 'old', '/target/f1.txt': 'old' });
      const conflict = vi.fn(() => new Promise<never>(() => {}));
      await expect(transfer(from, to, ['/f0.txt', '/f1.txt', '/f2.txt'], newJob(), hooks(conflict))).rejects.toThrow('read failed');
      expect(conflict).toHaveBeenCalledTimes(1);
    });

    it('copies names that differ only in case one after another', async () => {
      TUNING.files = 4;
      const from = memory({ '/A.txt': 'upper', '/a.txt': 'lower' });
      const to = memory({ '/target': null }, 1000, { gate: () => sleep(5) });
      const open = to.openWrite;
      let now = 0; let most = 0;
      to.openWrite = async (path, mode, resume) => {
        const handle = await open(path, mode, resume);
        now += 1; most = Math.max(most, now);
        return { write: handle.write, close: async () => { now -= 1; await handle.close(); } };
      };
      await transfer(from, to, ['/A.txt', '/a.txt']);
      expect(most).toBe(1);
    });

    it('drops a moved source from the job even when a later one fails', async () => {
      TUNING.files = 1;
      const from = memory({ '/a.txt': 'a', '/b.txt': 'b' });
      const open = from.openRead;
      from.openRead = async path => { if (path === '/b.txt') throw new Error('read'); return open(path); };
      const job = { ...newJob(true), sources: ['/a.txt', '/b.txt'] };
      await expect(transfer(from, memory({ '/target': null }), ['/a.txt', '/b.txt'], job)).rejects.toThrow('read');
      expect(job.sources).toEqual(['/b.txt']);
    });

    it('lists the running files and counts bytes of parallel files without overwriting each other', async () => {
      TUNING.files = 4; TUNING.chunk = 2;
      const seen = new Set<string>();
      const job = await transfer(memory(many(4)), memory({ '/target': null }), Object.keys(many(4)), newJob(), { ...hooks(), progress: current => { if (current.current) seen.add(current.current); } });
      expect([...seen].some(names => names.includes(', '))).toBe(true);
      expect(job).toMatchObject({ doneFiles: 4, doneBytes: 4 * 'data 0'.length, current: undefined });
    });
  });

  describe('files above 4 GiB', () => {
    const MIB = 1024 * 1024;
    const SIZE = 5 * 1024 * MIB;
    const mark = (length: number, position: number): Buffer => {
      const buffer = Buffer.alloc(length);
      if (length >= 8) buffer.writeBigUInt64BE(BigInt(position), 0);
      return buffer;
    };

    /** A sparse 5 GiB source and target: every piece carries its own offset, so a wrong offset shows up as a bad mark. */
    function sparse(holes: Set<number>) {
      const landed: [number, number][] = [];
      const state = { bad: 0, final: [] as [number, number][] };
      const merged = (): [number, number][] => {
        const out: [number, number][] = [];
        for (const [start, end] of [...landed].sort((a, b) => a[0] - b[0])) {
          const last = out[out.length - 1];
          if (last && start <= last[1]) last[1] = Math.max(last[1], end); else out.push([start, end]);
        }
        return out;
      };
      const covered = (start: number, end: number): boolean => merged().some(([from, to]) => from <= start && to >= end);
      const from = memory({});
      from.stat = async path => path === '/big.bin' ? { name: 'big.bin', type: 'file', size: SIZE, modified: 1000 } : null;
      from.openRead = async () => ({ read: async (length, position) => mark(Math.max(0, Math.min(length, SIZE - position)), position), close: async () => {} });
      const to = memory({ '/target': null });
      const base = to.stat;
      to.stat = async path => path === '/target/big.bin.part' ? (landed.length ? { name: 'big.bin.part', type: 'file', size: Math.max(...landed.map(([, end]) => end)), modified: 0 } : null) : base(path);
      to.openRead = async () => ({
        read: async (length, position) => covered(position, position + length) ? mark(length, position) : Buffer.alloc(0), close: async () => {} });
      to.openWrite = async (_path, _mode, resume) => {
        if (!resume) landed.length = 0;
        return {
          write: async (data, position) => {
            if (holes.has(position)) return new Promise<void>(() => {});
            if (data.length >= 8 && data.readBigUInt64BE(0) !== BigInt(position)) state.bad += 1;
            landed.push([position, position + data.length]);
          },
          close: async () => {},
        };
      };
      to.rename = async (source, target) => { if (source.endsWith('.part') && target === '/target/big.bin') state.final = merged(); };
      return { from, to, state, merged };
    }

    it('resumes after several cancels with holes in the window and ends with every byte in place', async () => {
      TUNING.chunk = MIB; TUNING.inFlight = 8; TUNING.files = 1;
      const holes = new Set([4200 * MIB, 4900 * MIB]);
      const { from, to, state, merged } = sparse(holes);
      for (const hole of [4200 * MIB, 4900 * MIB]) {
        const controller = new AbortController();
        const job = newJob();
        // Everything but the hole confirms, then the window is full and the run is stopped.
        const threshold = hole + (TUNING.inFlight - 1) * MIB;
        const progress = (current: TransferJob): void => { if (current.doneBytes >= threshold) controller.abort(); };
        await expect(transfer(from, to, ['/big.bin'], job, { ...hooks(), progress, keepPartial: true }, controller.signal)).rejects.toBeInstanceOf(TransferCanceled);
        expect(job.partials).toEqual(['/target/big.bin.part']);
        holes.delete(hole);
      }
      const last = await transfer(from, to, ['/big.bin']);
      expect(last.resumedFrom).toBeGreaterThan(4 * 1024 * MIB);
      expect(state.bad).toBe(0);
      expect(state.final).toEqual([[0, SIZE]]);
      expect(merged()).toEqual([[0, SIZE]]);
    }, 60_000);
  });
});
