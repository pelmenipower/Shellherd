import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import type { AutoUploadStatus } from '../../shared/sftp';
import type { AutoUploadBinding } from '../../shared/vault/types';
import { AutoUploads } from './auto-upload';
import { localFileSystem } from './file-system';
import type { RemoteFileSystem } from './sftp-file-system';

interface Node { type: 'file' | 'directory'; data: Buffer; modified: number }
const dir = (): Node => ({ type: 'directory', data: Buffer.alloc(0), modified: 0 });
const file = (text: string, modified: number): Node => ({ type: 'file', data: Buffer.from(text), modified });

function fakeRemote(options: { keepUploadTime?: boolean; failOn?: string; missingOn?: string; writeDelayMs?: number; removeDelayMs?: number } = {}) {
  const nodes = new Map<string, Node>([['/', dir()], ['/srv', dir()]]);
  const log: string[] = [];
  const calls = { removeFile: 0, removeDirectory: 0, stat: [] as string[] };
  const entry = (path: string, node: Node) => ({ name: posix.basename(path), type: node.type, size: node.data.length, modified: node.modified, mode: 0o644 });
  const stat = async (path: string) => { calls.stat.push(path); const node = nodes.get(path); return node ? entry(path, node) : null; };
  const remote = { join: posix.join, basename: posix.basename, stat, lstat: stat,
    realpath: async (path: string) => { if (!nodes.has(path)) throw Object.assign(new Error('missing'), { code: 2 }); return path; },
    mkdir: async (path: string) => { nodes.set(path, dir()); },
    write: (path: string) => {
      log.push(`write:${path}`);
      const chunks: Buffer[] = [];
      return new Writable({ write(chunk: Buffer, _encoding, callback) { chunks.push(chunk); callback(); },
        final(callback) {
          if (options.failOn && path.includes(options.failOn)) return callback(new Error('boom'));
          if (options.missingOn && path.includes(options.missingOn)) return callback(Object.assign(new Error('no such file'), { code: 2 }));
          setTimeout(() => { nodes.set(path, { type: 'file', data: Buffer.concat(chunks), modified: Date.now() }); callback(); }, options.writeDelayMs ?? 0);
        } });
    },
    setModified: async (path: string, modified: number) => { const node = nodes.get(path); if (node && !options.keepUploadTime) node.modified = modified; },
    removeFile: async (path: string) => {
      // Delayed so an unguarded restart opens the same .part before the aborted run removes it.
      if (options.removeDelayMs && path.endsWith('.part')) await pause(options.removeDelayMs);
      log.push(`removeFile:${path}`); calls.removeFile += 1; nodes.delete(path);
    },
    removeDirectory: async (path: string) => { calls.removeDirectory += 1; nodes.delete(path); },
    rename: async (from: string, to: string) => { nodes.set(to, nodes.get(from)!); nodes.delete(from); },
  } as unknown as RemoteFileSystem;
  return { remote, nodes, calls, log };
}

const roots: string[] = [];
const active: AutoUploads[] = [];
const TIME = Date.now() - 100_000;
const waitFor = async (condition: () => boolean, timeout = 4000): Promise<void> => {
  const end = Date.now() + timeout;
  while (!condition()) { if (Date.now() > end) throw new Error('timeout'); await new Promise(resolve => setTimeout(resolve, 10)); }
};
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const text = (nodes: Map<string, Node>, path: string) => nodes.get(path)?.data.toString();

function setup(options: Parameters<typeof fakeRemote>[0] = {}, inUseElsewhere?: () => boolean) {
  const root = mkdtempSync(join(tmpdir(), 'shellherd-auto-'));
  roots.push(root);
  const fake = fakeRemote(options);
  const emitted: { status: AutoUploadStatus; closed?: boolean }[] = [];
  const auto = new AutoUploads(fake.remote, { local: localFileSystem, settleMs: 30, maxWaitMs: 250, inUseElsewhere,
    emit: (status, closed) => emitted.push({ status, closed }) });
  active.push(auto);
  const write = (name: string, content: string, mtime = TIME) => {
    const path = join(root, name);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
    utimesSync(path, mtime / 1000, mtime / 1000);
  };
  const binding = (overrides: Partial<AutoUploadBinding> = {}): AutoUploadBinding =>
    ({ id: '11111111-1111-4111-8111-111111111111', localPath: root, remotePath: '/srv', excludes: ['.git', 'node_modules/'], enabled: true, ...overrides });
  const status = () => auto.list()[0];
  const ready = () => waitFor(() => status()?.state === 'watching');
  return { root, ...fake, emitted, auto, write, binding, status, ready };
}

afterEach(() => {
  for (const auto of active.splice(0)) auto.closeAll();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('AutoUploads', () => {
  it('compares at start: uploads missing and older files, skips equal ones silently, reports newer server files', async () => {
    const s = setup();
    s.write('new.txt', 'new');
    s.write('old.txt', 'fresh');
    s.write('same.txt', 'same');
    s.write('newer.txt', 'local');
    s.write('node_modules/x.js', 'x');
    s.write('.git/config', 'x');
    s.write('sub/deep.txt', 'deep');
    s.nodes.set('/srv/old.txt', file('o', TIME - 3_600_000));
    s.nodes.set('/srv/same.txt', file('same', TIME));
    s.nodes.set('/srv/newer.txt', file('server version', TIME + 3_600_000));
    await s.auto.start(s.binding());
    expect(s.status().state).toBe('syncing');
    await s.ready();
    expect(text(s.nodes, '/srv/new.txt')).toBe('new');
    expect(text(s.nodes, '/srv/old.txt')).toBe('fresh');
    expect(text(s.nodes, '/srv/sub/deep.txt')).toBe('deep');
    expect(text(s.nodes, '/srv/newer.txt')).toBe('server version');
    expect(s.nodes.has('/srv/node_modules')).toBe(false);
    expect(s.nodes.has('/srv/.git')).toBe(false);
    expect(s.status()).toMatchObject({ synced: 3, skipped: ['newer.txt'], skippedMore: 0, failed: [] });
    expect(s.calls.removeFile + s.calls.removeDirectory).toBe(0);
    expect(readFileSync(join(s.root, 'new.txt'), 'utf8')).toBe('new');
  });

  it('uploads a change after the settle time, creating new server folders', async () => {
    const s = setup();
    await s.auto.start(s.binding());
    await s.ready();
    s.write('a/b/c.txt', 'hello', Date.now());
    s.auto.handleEvent(s.binding().id, 'rename', 'a\\b\\c.txt');
    await waitFor(() => s.nodes.has('/srv/a/b/c.txt'));
    expect(text(s.nodes, '/srv/a/b/c.txt')).toBe('hello');
    expect(s.status().last?.name).toBe('c.txt');
    expect(s.status().state).toBe('watching');
  });

  it('never mirrors a local deletion', async () => {
    const s = setup();
    s.write('gone.txt', 'x');
    await s.auto.start(s.binding());
    await s.ready();
    rmSync(join(s.root, 'gone.txt'));
    s.auto.handleEvent(s.binding().id, 'rename', 'gone.txt');
    await pause(150);
    expect(s.nodes.has('/srv/gone.txt')).toBe(true);
    expect(s.calls.removeFile).toBe(0);
  });

  it('skips a server file that someone else changed after our upload, even if the local file is newer', async () => {
    const s = setup();
    s.write('a.txt', 'one');
    await s.auto.start(s.binding());
    await s.ready();
    s.nodes.set('/srv/a.txt', file('theirs', TIME + 600_000));
    s.write('a.txt', 'a longer local edit', Date.now() + 5000);
    s.auto.handleEvent(s.binding().id, 'change', 'a.txt');
    await waitFor(() => s.status().skipped.length === 1);
    expect(s.status().skipped).toEqual(['a.txt']);
    expect(text(s.nodes, '/srv/a.txt')).toBe('theirs');
  });

  it('force overwrites the skipped files that are still regular files', async () => {
    const s = setup();
    s.write('a.txt', 'local a');
    s.write('b.txt', 'local b');
    s.nodes.set('/srv/a.txt', file('server a', TIME + 3_600_000));
    s.nodes.set('/srv/b.txt', file('server b', TIME + 3_600_000));
    await s.auto.start(s.binding());
    await s.ready();
    expect(s.status().skipped.sort()).toEqual(['a.txt', 'b.txt']);
    rmSync(join(s.root, 'b.txt'));
    s.auto.force(s.binding().id);
    await waitFor(() => s.status().skipped.length === 0 && text(s.nodes, '/srv/a.txt') === 'local a');
    expect(text(s.nodes, '/srv/b.txt')).toBe('server b');
    expect(s.calls.removeFile).toBe(0);
  });

  it('uploads a second change even when the server keeps its own upload time', async () => {
    const s = setup({ keepUploadTime: true });
    s.write('a.txt', 'one');
    await s.auto.start(s.binding());
    await s.ready();
    s.write('a.txt', 'second version', Date.now());
    s.auto.handleEvent(s.binding().id, 'change', 'a.txt');
    await waitFor(() => text(s.nodes, '/srv/a.txt') === 'second version');
    expect(s.status().skipped).toEqual([]);
  });

  it('uploads a same-size change within a second of the previous upload', async () => {
    const s = setup();
    const T = Date.now() - 5000;
    s.write('a.txt', 'aaa', T);
    await s.auto.start(s.binding());
    await s.ready();
    expect(text(s.nodes, '/srv/a.txt')).toBe('aaa');
    s.write('a.txt', 'bbb', T + 500);
    s.auto.handleEvent(s.binding().id, 'change', 'a.txt');
    await waitFor(() => text(s.nodes, '/srv/a.txt') === 'bbb');
    expect(s.status().skipped).toEqual([]);
  });

  it('uploads a same-size change within a second when the server keeps its own time', async () => {
    const s = setup({ keepUploadTime: true });
    s.write('a.txt', 'aaa', Date.now() - 5000);
    await s.auto.start(s.binding());
    await s.ready();
    s.write('a.txt', 'bbb', Date.now());
    s.auto.handleEvent(s.binding().id, 'change', 'a.txt');
    await waitFor(() => text(s.nodes, '/srv/a.txt') === 'bbb');
    expect(s.status().skipped).toEqual([]);
  });

  it('compares again when a file vanishes during the full comparison', async () => {
    const s = setup();
    s.write('gone.txt', 'g');
    s.write('other.txt', 'o');
    let calls = 0;
    const stat: typeof localFileSystem.stat = async path => (path.endsWith('gone.txt') && calls++ === 0 ? null : localFileSystem.stat(path));
    const auto = new AutoUploads(s.remote, { local: { ...localFileSystem, stat }, settleMs: 30, maxWaitMs: 250, emit: () => {} });
    active.push(auto);
    await auto.start(s.binding());
    await waitFor(() => text(s.nodes, '/srv/other.txt') === 'o' && text(s.nodes, '/srv/gone.txt') === 'g');
    await waitFor(() => auto.list()[0]?.state === 'watching');
    expect(auto.list()[0].error).toBeUndefined();
  });

  it('ends in error when a file keeps vanishing during the full comparison', async () => {
    const s = setup();
    s.write('gone.txt', 'g');
    const stat: typeof localFileSystem.stat = async path => (path.endsWith('gone.txt') ? null : localFileSystem.stat(path));
    const auto = new AutoUploads(s.remote, { local: { ...localFileSystem, stat }, settleMs: 30, maxWaitMs: 250, emit: () => {} });
    active.push(auto);
    await auto.start(s.binding());
    await waitFor(() => auto.list()[0]?.state === 'error', 4000);
    expect(auto.list()[0].error?.code).toBe('files.sourceNotFound');
  });

  it('reports a missing server folder as failed instead of ignoring it', async () => {
    const s = setup({ missingOn: 'x.txt' });
    await s.auto.start(s.binding());
    await s.ready();
    s.write('x.txt', 'x', Date.now());
    s.auto.handleEvent(s.binding().id, 'rename', 'x.txt');
    await waitFor(() => s.status().failed.length === 1);
    expect(s.status().failed).toEqual(['x.txt']);
    expect(s.status().error?.code).toBe('files.notFound');
  });

  it('a restarted binding waits for the aborted run before touching the same .part', async () => {
    const s = setup({ writeDelayMs: 300, removeDelayMs: 300 });
    await s.auto.start(s.binding());
    await s.ready();
    s.write('big.txt', 'content', Date.now());
    s.auto.handleEvent(s.binding().id, 'rename', 'big.txt');
    await waitFor(() => s.log.includes('write:/srv/big.txt.part'));
    s.auto.stop(s.binding().id);
    await s.auto.start(s.binding());
    await waitFor(() => text(s.nodes, '/srv/big.txt') === 'content', 6000);
    const writes = s.log.flatMap((entry, index) => entry === 'write:/srv/big.txt.part' ? [index] : []);
    expect(s.log.indexOf('removeFile:/srv/big.txt.part')).toBeLessThan(writes[1]);
    expect(s.nodes.has('/srv/big.txt')).toBe(true);
  });

  it('does not compare a folder on a plain change event', async () => {
    const s = setup();
    s.write('d/f.txt', 'x');
    await s.auto.start(s.binding());
    await s.ready();
    s.calls.stat.length = 0;
    s.auto.handleEvent(s.binding().id, 'change', 'd');
    await pause(150);
    expect(s.calls.stat).toEqual([]);
  });

  it('uploads at the latest after maxWaitMs while a file keeps changing', async () => {
    const s = setup();
    await s.auto.start(s.binding());
    await s.ready();
    s.write('a.log', 'log', Date.now());
    const id = s.binding().id;
    const ticker = setInterval(() => s.auto.handleEvent(id, 'change', 'a.log'), 15);
    try { await waitFor(() => s.nodes.has('/srv/a.log'), 1500); } finally { clearInterval(ticker); }
  });

  it('ignores events below a junction and events that leave the folder', async () => {
    const s = setup();
    const outside = mkdtempSync(join(tmpdir(), 'shellherd-outside-'));
    roots.push(outside);
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(outside, join(s.root, 'j'), 'junction');
    await s.auto.start(s.binding());
    await s.ready();
    const id = s.binding().id;
    s.auto.handleEvent(id, 'change', 'j\\secret.txt');
    s.auto.handleEvent(id, 'rename', 'j');
    s.auto.handleEvent(id, 'change', '..\\x');
    s.auto.handleEvent(id, 'change', 'C:\\Windows\\win.ini');
    s.auto.handleEvent(id, 'change', 'a\0b');
    await pause(200);
    expect([...s.nodes.keys()].sort()).toEqual(['/', '/srv']);
    expect(s.status().state).toBe('watching');
  });

  it('ends in error when the watched folder disappears', async () => {
    const s = setup();
    await s.auto.start(s.binding());
    await s.ready();
    rmSync(s.root, { recursive: true, force: true });
    s.auto.handleEvent(s.binding().id, 'rename', `\\\\?\\${s.root}`);
    await waitFor(() => s.status().state === 'error');
    expect(s.status().error).toEqual({ code: 'files.syncLocalMissing' });
    s.auto.handleEvent(s.binding().id, 'rename', 'x');
    expect(s.auto.running(s.binding().id)).toBe(false);
  });

  it('keeps going when one file cannot be uploaded and lists it as failed', async () => {
    const s = setup({ failOn: 'bad.txt' });
    s.write('bad.txt', 'x');
    s.write('good.txt', 'y');
    await s.auto.start(s.binding());
    await s.ready();
    expect(text(s.nodes, '/srv/good.txt')).toBe('y');
    expect(s.nodes.has('/srv/bad.txt')).toBe(false);
    expect(s.status().failed).toEqual(['bad.txt']);
    expect(s.status().error).toBeDefined();
    expect(s.status().state).toBe('watching');
  });

  it('refuses a binding another file view runs', async () => {
    const s = setup({}, () => true);
    await s.auto.start(s.binding());
    expect(s.status().state).toBe('error');
    expect(s.status().error).toEqual({ code: 'files.syncElsewhere' });
    expect(s.auto.running(s.binding().id)).toBe(false);
    expect(s.calls.stat).toEqual([]);
  });

  it('reports folder problems as state error', async () => {
    const s = setup();
    await s.auto.start(s.binding({ localPath: join(s.root, 'missing') }));
    expect(s.status().error).toEqual({ code: 'files.syncLocalMissing' });
    await s.auto.start(s.binding({ remotePath: '/nope' }));
    expect(s.status().error).toEqual({ code: 'files.syncRemoteMissing' });
    await s.auto.start(s.binding({ remotePath: '/' }));
    expect(s.status().error).toEqual({ code: 'files.syncRemoteRoot' });
  });

  it('refuses overlapping folders of different bindings', async () => {
    const s = setup();
    mkdirSync(join(s.root, 'inner'));
    await s.auto.start(s.binding());
    await s.auto.start(s.binding({ id: '22222222-2222-4222-8222-222222222222', localPath: join(s.root, 'inner') }));
    expect(s.auto.list().find(item => item.bindingId.startsWith('2'))?.error).toEqual({ code: 'files.syncOverlap' });
  });

  it('stop emits closed and uploads nothing afterwards; closeAll closes every watcher', async () => {
    const s = setup();
    await s.auto.start(s.binding());
    await s.ready();
    s.auto.stop(s.binding().id);
    expect(s.emitted.at(-1)?.closed).toBe(true);
    expect(s.auto.list()).toEqual([]);
    s.write('late.txt', 'x', Date.now());
    s.auto.handleEvent(s.binding().id, 'change', 'late.txt');
    await s.auto.start(s.binding());
    await s.ready();
    s.auto.closeAll();
    s.write('later.txt', 'x', Date.now());
    await pause(200);
    expect(s.nodes.has('/srv/later.txt')).toBe(false);
    expect(s.emitted.at(-1)?.closed).toBe(true);
  });

  it('force with an unknown id throws files.syncNotFound', () => {
    const s = setup();
    expect(() => s.auto.force('nope')).toThrowError(expect.objectContaining({ code: 'files.syncNotFound' }));
  });
});
