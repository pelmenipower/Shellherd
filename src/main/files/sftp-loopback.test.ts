import { chmodSync, closeSync, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, unlinkSync, utimesSync, writeFileSync, writeSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server, utils } from 'ssh2';
import type { AddressInfo } from 'node:net';
import type { ConnectionNode } from '../../shared/vault/types';
import type { SftpEvent, TransferJob } from '../../shared/sftp';
import { localFileSystem } from './file-system';
import { SftpSessionManager } from './sftp-session';

const { STATUS_CODE, flagsToString } = utils.sftp;
const attrs = (info: Stats) => ({ mode: info.mode, uid: 0, gid: 0, size: info.size, atime: Math.floor(info.atimeMs / 1000), mtime: Math.floor(info.mtimeMs / 1000) });

/** Minimal SFTP server on a temporary folder: enough for listing, transfers, renames and deletes. */
function startServer(root: string): Promise<{ server: Server; port: number }> {
  const hostKey = utils.generateKeyPairSync('ed25519').private;
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
        sftp.name(reqid, readdirSync(entry.dir!).map(name => ({ filename: name, longname: name, attrs: attrs(lstatSync(join(entry.dir!, name))) as never })));
      });
      sftp.on('OPEN', (reqid, path, flags) => guard(reqid, () => sftp.handle(reqid, handle({ fd: openSync(local(path), flagsToString(flags)!) }))));
      sftp.on('READ', (reqid, buffer, offset, length) => guard(reqid, () => {
        const data = Buffer.alloc(length);
        const read = readSync(lookup(buffer)!.fd!, data, 0, length, offset);
        if (read) sftp.data(reqid, data.subarray(0, read)); else sftp.status(reqid, STATUS_CODE.EOF);
      }));
      sftp.on('WRITE', (reqid, buffer, offset, data) => guard(reqid, () => { writeSync(lookup(buffer)!.fd!, data, 0, data.length, offset); sftp.status(reqid, STATUS_CODE.OK); }));
      sftp.on('CLOSE', (reqid, buffer) => { const entry = lookup(buffer); if (entry?.fd !== undefined) closeSync(entry.fd); handles.delete(buffer.readUInt32BE(0)); sftp.status(reqid, STATUS_CODE.OK); });
      sftp.on('MKDIR', (reqid, path) => guard(reqid, () => { mkdirSync(local(path)); sftp.status(reqid, STATUS_CODE.OK); }));
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
