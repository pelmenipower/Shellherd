import { createHash } from 'node:crypto';
import { chmodSync, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server, utils } from 'ssh2';
import type { AddressInfo } from 'node:net';
import type { ConnectionNode } from '../../shared/vault/types';
import type { SftpEvent, TransferJob } from '../../shared/sftp';
import { fileError, localFileSystem } from './file-system';
import { windowBytes } from './transfer';
import { SftpSessionManager } from './sftp-session';
import { testHostKey } from '../ssh/test-host-key';

const { STATUS_CODE, flagsToString } = utils.sftp;
/** Knobs and counters of the test server (reset per resume test). */
const probe = { stallWritesFrom: undefined as number | undefined, shuffleWrites: false, writes: 0, lateWrites: 0, ops: [] as string[], open: 0, maxOpen: 0 };
const attrs = (info: Stats) => ({ mode: info.mode, uid: 0, gid: 0, size: info.size, atime: Math.floor(info.atimeMs / 1000), mtime: Math.floor(info.mtimeMs / 1000) });

/** Minimal SFTP server on a temporary folder: enough for listing, transfers, renames and deletes. */
function startServer(root: string): Promise<{ server: Server; port: number }> {
  const hostKey = testHostKey();
  const local = (path: string) => join(root, posix.normalize(`/${path}`));
  const server = new Server({ hostKeys: [hostKey] }, client => {
    client.on('authentication', context => context.method === 'password' && context.password === 'synthetic-secret' ? context.accept() : context.reject(['password']));
    client.on('ready', () => client.on('session', accept => accept().on('sftp', acceptSftp => {
      const sftp = acceptSftp();
      const handles = new Map<number, { fd?: number; dir?: string; done?: boolean }>();
      let next = 0;
      const handle = (value: { fd?: number; dir?: string }) => { const id = next++; handles.set(id, value); const buffer = Buffer.alloc(4); buffer.writeUInt32BE(id); return buffer; };
      const lookup = (buffer: Buffer) => handles.get(buffer.readUInt32BE(0));
      const guard = (reqid: number, run: () => void) => { try { run(); } catch (error) {
        sftp.status(reqid, (error as NodeJS.ErrnoException).code === 'ENOENT' ? STATUS_CODE.NO_SUCH_FILE : STATUS_CODE.FAILURE);
      } };
      sftp.on('REALPATH', (reqid, path) => { const resolved = posix.normalize(path === '.' ? '/' : `/${path}`); sftp.name(reqid, [{ filename: resolved, longname: resolved, attrs: {} as never }]); });
      sftp.on('STAT', (reqid, path) => guard(reqid, () => sftp.attrs(reqid, attrs(statSync(local(path))))));
      sftp.on('LSTAT', (reqid, path) => guard(reqid, () => sftp.attrs(reqid, attrs(lstatSync(local(path))))));
      sftp.on('FSTAT', (reqid, buffer) => guard(reqid, () => sftp.attrs(reqid, attrs(fstatSync(lookup(buffer)!.fd!)))));
      sftp.on('OPENDIR', (reqid, path) => guard(reqid, () => { statSync(local(path)); sftp.handle(reqid, handle({ dir: local(path) })); }));
      sftp.on('READDIR', (reqid, buffer) => {
        const entry = lookup(buffer)!;
        if (entry.done) { sftp.status(reqid, STATUS_CODE.EOF); return; }
        entry.done = true;
        guard(reqid, () => sftp.name(reqid, readdirSync(entry.dir!).map(name => ({ filename: name, longname: name, attrs: attrs(lstatSync(join(entry.dir!, name))) as never }))));
      });
      sftp.on('OPEN', (reqid, path, flags) => guard(reqid, () => {
        const fd = openSync(local(path), flagsToString(flags)!);
        probe.ops.push(`OPEN ${path}`);
        if (path.endsWith('.part')) { probe.open += 1; probe.maxOpen = Math.max(probe.maxOpen, probe.open); }
        sftp.handle(reqid, handle({ fd }));
      }));
      sftp.on('READ', (reqid, buffer, offset, length) => guard(reqid, () => {
        const data = Buffer.alloc(length);
        const read = readSync(lookup(buffer)!.fd!, data, 0, length, offset);
        if (read) sftp.data(reqid, data.subarray(0, read)); else sftp.status(reqid, STATUS_CODE.EOF);
      }));
      sftp.on('WRITE', (reqid, buffer, offset, data) => {
        probe.writes += 1;
        if (!lookup(buffer)) probe.lateWrites += 1;
        // A stalled server neither stores nor answers these writes (but still answers CLOSE).
        if (probe.stallWritesFrom !== undefined && offset >= probe.stallWritesFrom) return;
        const reply = () => guard(reqid, () => { writeSync(lookup(buffer)!.fd!, data, 0, data.length, offset); sftp.status(reqid, STATUS_CODE.OK); });
        if (probe.shuffleWrites) setTimeout(reply, [3, 0, 2, 1][reqid % 4]); else reply();
      });
      sftp.on('CLOSE', (reqid, buffer) => {
        const entry = lookup(buffer);
        if (entry?.fd !== undefined) { closeSync(entry.fd); probe.open = Math.max(0, probe.open - 1); }
        handles.delete(buffer.readUInt32BE(0)); sftp.status(reqid, STATUS_CODE.OK);
      });
      sftp.on('MKDIR', (reqid, path) => guard(reqid, () => { mkdirSync(local(path)); probe.ops.push(`MKDIR ${path}`); sftp.status(reqid, STATUS_CODE.OK); }));
      sftp.on('RMDIR', (reqid, path) => guard(reqid, () => { rmdirSync(local(path)); sftp.status(reqid, STATUS_CODE.OK); }));
      sftp.on('REMOVE', (reqid, path) => guard(reqid, () => { unlinkSync(local(path)); sftp.status(reqid, STATUS_CODE.OK); }));
      sftp.on('RENAME', (reqid, from, to) => guard(reqid, () => { renameSync(local(from), local(to)); sftp.status(reqid, STATUS_CODE.OK); }));
      sftp.on('SETSTAT', (reqid, path, changes) => guard(reqid, () => {
        if (changes.mode !== undefined) chmodSync(local(path), changes.mode);
        if (changes.mtime !== undefined) utimesSync(local(path), changes.atime ?? changes.mtime, changes.mtime);
        sftp.status(reqid, STATUS_CODE.OK);
      }));
    })));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: (server.address() as AddressInfo).port })));
}

describe.runIf(process.platform === 'win32')('SFTP auto-upload over a real SSH connection', () => {
  const base = mkdtempSync(join(tmpdir(), 'terminus-sync-'));
  const remoteRoot = join(base, 'server');
  const bound = join(base, 'bound');
  const bindingId = '8f14e45f-ceea-4b67-a1b0-5d6a4f2b9c01';
  const events: SftpEvent[] = [];
  let server: Server;
  let manager: SftpSessionManager;

  const waitFor = async (check: () => boolean): Promise<void> => {
    for (let attempt = 0; attempt < 240; attempt += 1) {
      if (check()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('timeout');
  };
  const onServer = (name: string) => join(remoteRoot, 'mirror', name);
  const status = (id: string) => manager.state(1, id).syncs?.find(sync => sync.bindingId === bindingId);
  const connected = (id: string) => waitFor(() => events.some(event => event.type === 'status' && event.sessionId === id && event.status === 'connected'));

  beforeAll(async () => {
    mkdirSync(join(remoteRoot, 'mirror'), { recursive: true }); mkdirSync(bound, { recursive: true });
    writeFileSync(join(bound, 'a.txt'), 'first');
    const started = await startServer(remoteRoot);
    server = started.server;
    const node: ConnectionNode = { id: 'files', type: 'connection', protocol: 'sftp', name: 'Loopback', host: '127.0.0.1', port: started.port,
      username: 'synthetic-user', authentication: { method: 'password', password: 'synthetic-secret' }, tags: [],
      autoUpload: [{ id: bindingId, localPath: bound, remotePath: '/mirror', excludes: ['node_modules/'], enabled: true }] };
    manager = new SftpSessionManager({ getConnection: () => node, verifyHost: async () => true, emit: (_owner, event) => events.push(event), local: localFileSystem,
      openFile: async () => {} });
  });
  afterAll(() => { manager?.closeAll(); server?.close(); rmSync(base, { recursive: true, force: true }); });

  it('mirrors a bound folder, skips newer server files until forced, never uploads excluded folders, and reports a second view', async () => {
    const first = manager.open(1, 'files').sessionId;
    await connected(first);
    await waitFor(() => status(first)?.state === 'watching' && status(first)?.synced === 1);
    expect(readFileSync(onServer('a.txt'), 'utf8')).toBe('first');

    writeFileSync(join(bound, 'b.txt'), 'one');
    // Wait until the upload is booked (known server time recorded), not just until the file is there.
    await waitFor(() => status(first)?.synced === 2);
    expect(readFileSync(onServer('b.txt'), 'utf8')).toBe('one');

    // Someone else wrote a newer copy: the local change is skipped, not overwritten.
    utimesSync(onServer('b.txt'), 2_000_000_000, 2_000_000_000);
    writeFileSync(join(bound, 'b.txt'), 'two');
    await waitFor(() => status(first)?.skipped.includes('b.txt') === true);
    expect(readFileSync(onServer('b.txt'), 'utf8')).toBe('one');
    manager.syncForce(1, first, bindingId);
    await waitFor(() => readFileSync(onServer('b.txt'), 'utf8') === 'two');
    await waitFor(() => status(first)?.skipped.length === 0);

    mkdirSync(join(bound, 'node_modules'));
    writeFileSync(join(bound, 'node_modules', 'x.js'), 'x');
    writeFileSync(join(bound, 'c.txt'), 'marker');
    await waitFor(() => existsSync(onServer('c.txt')));
    expect(existsSync(onServer('node_modules'))).toBe(false);

    // The same binding in a second file view of the connection is refused.
    const second = manager.open(1, 'files').sessionId;
    await connected(second);
    await waitFor(() => status(second)?.state === 'error');
    expect(status(second)?.error?.code).toBe('files.syncElsewhere');
    await manager.syncStart(1, second, bindingId);
    expect(status(second)?.error?.code).toBe('files.syncElsewhere');
    manager.close(1, second);

    manager.close(1, first);
    expect(events.some(event => event.type === 'sync' && event.sessionId === first && event.closed === true)).toBe(true);
  }, 30_000);
});

describe.runIf(process.platform === 'win32')('SFTP over a real SSH connection', () => {
  const base = mkdtempSync(join(tmpdir(), 'terminus-sftp-'));
  const remoteRoot = join(base, 'server');
  const localRoot = join(base, 'local');
  let server: Server;
  let manager: SftpSessionManager;
  const events: SftpEvent[] = [];
  let sessionId: string;
  const opened: string[] = [];
  const openedWith: string[] = [];

  const waitFor = async <T>(find: () => T | undefined): Promise<T> => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const found = find();
      if (found !== undefined) return found;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('timeout');
  };
  const finished = (jobId: string) => waitFor(() => events.flatMap(event => event.type === 'transfer' && event.job.id === jobId
    && ['done', 'error', 'canceled'].includes(event.job.state) ? [event.job] : [])[0] as TransferJob | undefined);

  beforeAll(async () => {
    mkdirSync(remoteRoot); mkdirSync(join(localRoot, 'project', 'docs'), { recursive: true });
    writeFileSync(join(localRoot, 'project', 'readme.txt'), 'hello');
    writeFileSync(join(localRoot, 'project', 'docs', 'big.bin'), Buffer.alloc(700_000, 7));
    utimesSync(join(localRoot, 'project', 'readme.txt'), 1_600_000_000, 1_600_000_000);
    const started = await startServer(remoteRoot);
    server = started.server;
    const node: ConnectionNode = { id: 'files', type: 'connection', protocol: 'sftp', name: 'Loopback', host: '127.0.0.1', port: started.port,
      username: 'synthetic-user', authentication: { method: 'password', password: 'synthetic-secret' }, tags: [] };
    manager = new SftpSessionManager({ getConnection: () => node, verifyHost: async () => true, emit: (_owner, event) => events.push(event), local: localFileSystem,
      openFile: async (path, editor) => { opened.push(path); openedWith.push(editor); }, editPollInterval: 50 });
    sessionId = manager.open(1, 'files').sessionId;
    await waitFor(() => events.find(event => event.type === 'status' && event.status === 'connected') ? true : undefined);
  });
  afterAll(() => { manager?.closeAll(); server?.close(); rmSync(base, { recursive: true, force: true }); });

  it('uploads a folder tree with times, then lists it', async () => {
    expect(await manager.home(1, sessionId)).toBe('/');
    const { jobId } = manager.transfer(1, { sessionId, direction: 'upload', sources: [join(localRoot, 'project')], targetDir: '/', move: false });
    expect(await finished(jobId)).toMatchObject({ state: 'done', totalFiles: 2, doneFiles: 2, totalBytes: 700_005 });
    expect(readFileSync(join(remoteRoot, 'project', 'readme.txt'), 'utf8')).toBe('hello');
    expect(statSync(join(remoteRoot, 'project', 'readme.txt')).mtimeMs).toBe(1_600_000_000_000);
    const listing = await manager.list(1, sessionId, '/project');
    expect(listing.entries.map(entry => `${entry.type}:${entry.name}`).sort()).toEqual(['directory:docs', 'file:readme.txt']);
  });

  it('refuses a file as folder with files.notADirectory, and a missing folder with files.notFound', async () => {
    const failure = (path: string) => manager.list(1, sessionId, path).then(() => null, error => fileError(error));
    expect(await failure('/project/readme.txt')).toEqual({ code: 'files.notADirectory' });
    expect(await failure('/project/fehlt')).toEqual({ code: 'files.notFound' });
  });

  it('asks before overwriting and follows the answer', async () => {
    writeFileSync(join(localRoot, 'project', 'readme.txt'), 'changed');
    const { jobId } = manager.transfer(1, { sessionId, direction: 'upload', sources: [join(localRoot, 'project', 'readme.txt')], targetDir: '/project', move: false });
    const conflict = await waitFor(() => events.flatMap(event => event.type === 'conflict' && event.conflict.jobId === jobId ? [event.conflict] : [])[0]);
    expect(manager.state(1, sessionId).conflict?.name).toBe('readme.txt');
    manager.resolveConflict(1, sessionId, conflict.conflictId, 'overwrite', false);
    expect(await finished(jobId)).toMatchObject({ state: 'done', doneFiles: 1 });
    expect(readFileSync(join(remoteRoot, 'project', 'readme.txt'), 'utf8')).toBe('changed');
  });

  it('opens a server file for editing and uploads each save, but not over a newer server version', async () => {
    const { editId } = await manager.edit(1, sessionId, '/project/readme.txt');
    expect(readFileSync(opened[0], 'utf8')).toBe('changed');
    writeFileSync(opened[0], 'edited locally');
    await waitFor(() => events.some(event => event.type === 'edit' && event.edit.id === editId && event.edit.state === 'saved') ? true : undefined);
    expect(readFileSync(join(remoteRoot, 'project', 'readme.txt'), 'utf8')).toBe('edited locally');

    utimesSync(join(remoteRoot, 'project', 'readme.txt'), 2_000_000_000, 2_000_000_000);
    writeFileSync(opened[0], 'second edit');
    await waitFor(() => events.some(event => event.type === 'edit' && event.edit.state === 'conflict') ? true : undefined);
    expect(readFileSync(join(remoteRoot, 'project', 'readme.txt'), 'utf8')).toBe('edited locally');
    await manager.editUpload(1, sessionId, editId);
    expect(readFileSync(join(remoteRoot, 'project', 'readme.txt'), 'utf8')).toBe('second edit');

    await manager.chmod(1, sessionId, ['/project/readme.txt'], 0o600, false);
    await manager.editClose(1, sessionId, editId);
    expect(manager.state(1, sessionId).edits).toEqual([]);
    await waitFor(() => { try { statSync(opened[0]); return undefined; } catch { return true; } });
  });

  it('creates a new empty file but never replaces an existing one', async () => {
    await manager.createFile(1, sessionId, '/project/notes.md');
    expect(readFileSync(join(remoteRoot, 'project', 'notes.md'), 'utf8')).toBe('');
    writeFileSync(join(remoteRoot, 'project', 'notes.md'), 'keep');
    await expect(manager.createFile(1, sessionId, '/project/notes.md')).rejects.toMatchObject({ code: 'files.exists' });
    expect(readFileSync(join(remoteRoot, 'project', 'notes.md'), 'utf8')).toBe('keep');
    const { editId } = await manager.edit(1, sessionId, '/project/notes.md', 'notepad');
    expect(openedWith.at(-1)).toBe('notepad');
    await manager.editClose(1, sessionId, editId);
  });

  it('downloads, renames and deletes on the server', async () => {
    const target = join(base, 'download');
    mkdirSync(target);
    const { jobId } = manager.transfer(1, { sessionId, direction: 'download', sources: ['/project'], targetDir: target, move: false });
    expect(await finished(jobId)).toMatchObject({ state: 'done', doneFiles: 3 });
    expect(readFileSync(join(target, 'project', 'docs', 'big.bin')).equals(Buffer.alloc(700_000, 7))).toBe(true);
    await manager.rename(1, sessionId, '/project', '/renamed');
    await manager.delete(1, sessionId, ['/renamed']);
    expect(readdirSync(remoteRoot)).toEqual([]);
    await expect(manager.delete(1, sessionId, ['/'])).rejects.toMatchObject({ code: 'files.rootDelete' });
  });
});

describe.runIf(process.platform === 'win32')('SFTP resumable transfers over a real SSH connection', () => {
  const MiB = 1024 * 1024;
  const base = mkdtempSync(join(tmpdir(), 'terminus-resume-'));
  const remoteRoot = join(base, 'server');
  const localRoot = join(base, 'local');
  const remote = (...names: string[]) => join(remoteRoot, 'resume', ...names);
  const events: SftpEvent[] = [];
  let server: Server;
  let manager: SftpSessionManager;
  let sessionId: string;

  const pattern = (size: number) => Buffer.from(Uint8Array.from({ length: size }, (_, index) => index % 251));
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const waitFor = async <T>(find: () => T | undefined): Promise<T> => {
    for (let attempt = 0; attempt < 400; attempt += 1) {
      const found = find();
      if (found !== undefined) return found;
      await sleep(25);
    }
    throw new Error('timeout');
  };
  const finished = (jobId: string) => waitFor(() => events.flatMap(event => event.type === 'transfer' && event.job.id === jobId
    && ['done', 'error', 'canceled'].includes(event.job.state) ? [event.job] : [])[0] as TransferJob | undefined);
  const upload = (path: string) => manager.transfer(1, { sessionId, direction: 'upload', sources: [path], targetDir: '/resume', move: false }).jobId;
  const sizeOf = (path: string) => { try { return statSync(path).size; } catch { return undefined; } };
  /** A source with an old time, so any fresh .part counts as newer. */
  const source = (name: string, data: Buffer) => { const path = join(localRoot, name); writeFileSync(path, data); utimesSync(path, 1_600_000_000, 1_600_000_000); return path; };

  beforeAll(async () => {
    mkdirSync(remote(), { recursive: true }); mkdirSync(localRoot, { recursive: true });
    const started = await startServer(remoteRoot);
    server = started.server;
    const node: ConnectionNode = { id: 'files', type: 'connection', protocol: 'sftp', name: 'Loopback', host: '127.0.0.1', port: started.port,
      username: 'synthetic-user', authentication: { method: 'password', password: 'synthetic-secret' }, tags: [] };
    manager = new SftpSessionManager({ getConnection: () => node, verifyHost: async () => true, emit: (_owner, event) => events.push(event), local: localFileSystem,
      openFile: async () => {} });
    sessionId = manager.open(1, 'files').sessionId;
    await waitFor(() => events.find(event => event.type === 'status' && event.status === 'connected') ? true : undefined);
  });
  afterAll(() => { manager?.closeAll(); server?.close(); rmSync(base, { recursive: true, force: true }); });

  it('resumes an upload one window before the end of the .part, and the result is identical', async () => {
    const data = pattern(12 * MiB);
    const path = source('part.bin', data);
    writeFileSync(remote('part.bin.part'), data.subarray(0, 8 * MiB));
    const job = await finished(upload(path));
    expect(job).toMatchObject({ state: 'done', resumedFrom: 8 * MiB - windowBytes() });
    expect(job.restarted).toBeUndefined();
    expect(hash(remote('part.bin'))).toBe(hash(path));
    expect(existsSync(remote('part.bin.part'))).toBe(false);
  }, 30_000);

  it('restarts when a byte in the checked tail differs, but resumes when only a later byte does', async () => {
    const data = pattern(12 * MiB);
    const path = source('flip.bin', data);
    const bad = Buffer.from(data.subarray(0, 8 * MiB)); bad[3.5 * MiB] ^= 0xff;
    writeFileSync(remote('flip.bin.part'), bad);
    expect(await finished(upload(path))).toMatchObject({ state: 'done', restarted: true });
    expect(hash(remote('flip.bin'))).toBe(hash(path));

    const late = Buffer.from(data.subarray(0, 8 * MiB)); late[6 * MiB] ^= 0xff;
    const path2 = source('late.bin', data);
    writeFileSync(remote('late.bin.part'), late);
    expect(await finished(upload(path2))).toMatchObject({ state: 'done', resumedFrom: 8 * MiB - windowBytes() });
    expect(hash(remote('late.bin'))).toBe(hash(path2));
  }, 30_000);

  it('keeps the .part on cancel with writes stalled and resumes to an identical file', async () => {
    const path = source('huge.bin', pattern(12 * MiB));
    probe.stallWritesFrom = 8 * MiB; probe.lateWrites = 0;
    try {
      const jobId = upload(path);
      await waitFor(() => (sizeOf(remote('huge.bin.part')) ?? 0) >= 8 * MiB ? true : undefined);
      manager.cancel(1, sessionId, jobId);
      expect(await finished(jobId)).toMatchObject({ state: 'canceled', partials: ['/resume/huge.bin.part'] });
      // Every write of the job precedes its CLOSE on the channel; the handle lock itself is proven in sftp-file-system.test.ts.
      expect(probe.lateWrites).toBe(0);
      expect(existsSync(remote('huge.bin'))).toBe(false);
    } finally { probe.stallWritesFrom = undefined; }

    const kept = statSync(remote('huge.bin.part')).size;
    expect(await finished(upload(path))).toMatchObject({ state: 'done', resumedFrom: kept - windowBytes() });
    expect(hash(remote('huge.bin'))).toBe(hash(path));
  }, 30_000);

  it('copes with confirmations arriving out of order', async () => {
    const path = source('shuffle.bin', pattern(12 * MiB));
    probe.shuffleWrites = true;
    try { expect(await finished(upload(path))).toMatchObject({ state: 'done' }); } finally { probe.shuffleWrites = false; }
    expect(hash(remote('shuffle.bin'))).toBe(hash(path));
  }, 30_000);

  it('resumes a download from a local .part', async () => {
    const data = pattern(12 * MiB);
    writeFileSync(remote('dl.bin'), data); utimesSync(remote('dl.bin'), 1_600_000_000, 1_600_000_000);
    const target = join(base, 'download'); mkdirSync(target);
    writeFileSync(join(target, 'dl.bin.part'), data.subarray(0, 8 * MiB));
    const { jobId } = manager.transfer(1, { sessionId, direction: 'download', sources: ['/resume/dl.bin'], targetDir: target, move: false });
    expect(await finished(jobId)).toMatchObject({ state: 'done', resumedFrom: 8 * MiB - windowBytes() });
    expect(hash(join(target, 'dl.bin'))).toBe(hash(remote('dl.bin')));
    expect(existsSync(join(target, 'dl.bin.part'))).toBe(false);
  }, 30_000);

  it('copies a folder with several files in parallel, creating folders first', async () => {
    const dir = join(localRoot, 'dir');
    mkdirSync(join(dir, 'sub'), { recursive: true });
    const names = [0, 1, 2, 3, 4, 5].map(index => index < 3 ? `f${index}.bin` : join('sub', `f${index}.bin`));
    names.forEach((name, index) => writeFileSync(join(dir, name), pattern(MiB + index)));
    probe.ops = []; probe.maxOpen = 0;
    expect(await finished(upload(dir))).toMatchObject({ state: 'done', doneFiles: 6 });
    for (const name of names) expect(hash(remote('dir', name))).toBe(hash(join(dir, name)));
    const firstOpen = probe.ops.findIndex(op => op.startsWith('OPEN '));
    const lastMkdir = probe.ops.map(op => op.startsWith('MKDIR ')).lastIndexOf(true);
    expect(lastMkdir).toBeGreaterThanOrEqual(0);
    expect(lastMkdir).toBeLessThan(firstOpen);
    expect(probe.maxOpen).toBeGreaterThan(1);
  }, 30_000);

  it('never touches a .part that is a folder', async () => {
    mkdirSync(remote('blocked.bin.part'), { recursive: true });
    writeFileSync(remote('blocked.bin.part', 'keep.txt'), 'keep');
    const path = source('blocked.bin', pattern(MiB));
    probe.writes = 0;
    expect(await finished(upload(path))).toMatchObject({ state: 'error', error: { code: 'files.existsAsDirectory' } });
    expect(probe.writes).toBe(0);
    expect(readFileSync(remote('blocked.bin.part', 'keep.txt'), 'utf8')).toBe('keep');
    expect(existsSync(remote('blocked.bin'))).toBe(false);
  });

  it('cleans up the server folder', async () => {
    await manager.delete(1, sessionId, ['/resume']);
    expect(readdirSync(remoteRoot)).toEqual([]);
  });
});
