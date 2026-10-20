import { posix } from 'node:path';
import { PassThrough, Readable, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { FileEntry, TransferJob } from '../../shared/sftp';
import type { FileSystem } from './file-system';
import { planTransfer, runTransfer, TransferCanceled } from './transfer';
import type { TransferHooks } from './transfer';

type Node = { type: 'file'; data: string; modified: number } | { type: 'directory' };

/** Synthetic file system; paths are POSIX on both sides. */
function memory(files: Record<string, string | null>, modified = 1000): FileSystem & { nodes: Map<string, Node> } {
  const nodes = new Map<string, Node>([['/', { type: 'directory' }]]);
  for (const [path, data] of Object.entries(files)) nodes.set(path, data === null ? { type: 'directory' } : { type: 'file', data, modified });
  const entry = (path: string, node: Node): FileEntry => node.type === 'file'
    ? { name: posix.basename(path), type: 'file', size: node.data.length, modified: node.modified }
    : { name: posix.basename(path), type: 'directory', size: 0, modified: 0 };
  return {
    nodes,
    join: posix.join, basename: posix.basename,
    list: async dir => [...nodes].filter(([path]) => path !== dir && posix.dirname(path) === dir).map(([path, node]) => entry(path, node)),
    stat: async path => { const node = nodes.get(path); return node ? entry(path, node) : null; },
    mkdir: async path => { nodes.set(path, { type: 'directory' }); },
    read: path => { const node = nodes.get(path); if (node?.type !== 'file') throw new Error('missing'); return Readable.from([Buffer.from(node.data)]); },
    write: path => {
      const chunks: Buffer[] = [];
      return new Writable({ write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); nodes.set(path, { type: 'file', data: Buffer.concat(chunks).toString(), modified: 0 }); callback(); } });
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

describe('file transfer', () => {
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

  it('cancels from the conflict question and removes a half-written file on abort', async () => {
    const from = memory({ '/a.txt': 'a' });
    const to = memory({ '/target': null, '/target/a.txt': 'old' });
    await expect(transfer(from, to, ['/a.txt'], newJob(), hooks(async () => ({ choice: 'cancel', applyToAll: false })))).rejects.toBeInstanceOf(TransferCanceled);
    expect(to.nodes.get('/target/a.txt')).toMatchObject({ data: 'old' });

    const controller = new AbortController();
    const slow = memory({ '/big.bin': '' });
    slow.read = () => { const stream = new PassThrough(); stream.write('partial'); setTimeout(() => controller.abort(), 5); return stream; };
    const target = memory({ '/target': null });
    await expect(transfer(slow, target, ['/big.bin'], newJob(), hooks(), controller.signal)).rejects.toBeInstanceOf(TransferCanceled);
    expect(target.nodes.has('/target/big.bin')).toBe(false);
    expect(target.nodes.has('/target/big.bin.part')).toBe(false);
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

  it('keeps the existing target when reading fails and leaves no .part behind', async () => {
    const from = memory({ '/a.txt': 'new' });
    from.read = () => { const stream = new PassThrough(); stream.write('ne'); setTimeout(() => stream.destroy(new Error('read')), 5); return stream; };
    const to = memory({ '/target': null, '/target/a.txt': 'old' });
    await expect(transfer(from, to, ['/a.txt'])).rejects.toThrow('read');
    expect(to.nodes.get('/target/a.txt')).toMatchObject({ data: 'old' });
    expect(to.nodes.has('/target/a.txt.part')).toBe(false);
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
    const write = vi.spyOn(to, 'write');
    await transfer(from, to, ['/a.txt']);
    expect(write).toHaveBeenCalledWith('/target/a.txt.part', 0o600);
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
  });
});
