import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { posix } from 'node:path';
import { Client } from 'ssh2';
import type { SFTPWrapper } from 'ssh2';
import { limitError, type CodedError } from '../../shared/errors';
import type { ConnectionNode, ConnectionTimeouts, SftpConnectionNode, SshConnectionNode } from '../../shared/vault/types';
import { DEFAULT_TIMEOUTS } from '../../shared/vault/timeouts';
import { MAX_SFTP_SESSIONS } from '../../shared/sftp';
import type { EditorChoice } from '../../shared/sftp';
import type { ConflictChoice, DirectoryListing, SftpEvent, SftpSessionState, SftpStatus, SftpTransferRequest, TransferConflict, TransferJob } from '../../shared/sftp';
import { sshConnectConfig } from '../ssh/client-config';
import type { AskPrompts } from '../ssh/auth-prompts';
import type { Jump } from '../ssh/jump';
import { classifyError } from '../ssh/session';
import type { ConnectionErrorCode } from '../../shared/connection-errors';
import { FileError, fileError } from './file-system';
import type { FileSystem } from './file-system';
import { removeRemote, sftpFileSystem } from './sftp-file-system';
import type { RemoteFileSystem } from './sftp-file-system';
import { planTransfer, runTransfer, TransferCanceled } from './transfer';
import { RemoteEdits } from './remote-edit';
import { AutoUploads } from './auto-upload';
import { verifyCopies } from './verify';

export const VERIFY_MAX = 10_000;
const PROGRESS_INTERVAL = 200;
const KEPT_FINISHED_JOBS = 20;

export interface SftpDependencies {
  getConnection: (id: string) => ConnectionNode;
  verifyHost: (host: string, port: number, key: Buffer, isActive: () => boolean) => Promise<boolean>;
  emit: (ownerId: number, event: SftpEvent) => void;
  local: FileSystem;
  /** Opens a local copy of a server file in an editor. */
  openFile: (path: string, editor: EditorChoice) => Promise<void>;
  /** How often edited copies are checked for changes; tests use less. */
  editPollInterval?: number;
  /** Effective timeouts of a connection; default () => DEFAULT_TIMEOUTS. */
  getTimeouts?: (connection: ConnectionNode) => ConnectionTimeouts;
  /** Injected so tests never open network connections. */
  createClient?: () => Client;
  /** Keyboard-interactive questions; without it the server gets no keyboard answers. */
  ask?: AskPrompts;
  /** Opens the hop named by `jumpHost`; undefined without one. */
  openJump?: (connection: SshConnectionNode | SftpConnectionNode, ownerId: number) => Promise<Jump | undefined>;
}

interface Job {
  job: TransferJob;
  sources: string[];
  /** Source and target of every file that arrived; "Prüfen" reads it. Never part of a snapshot. */
  copied: { source: string; target: string }[];
  controller: AbortController;
  lastEmit: number;
}

interface Session {
  id: string;
  ownerId: number;
  connectionId: string;
  client: Client;
  fs?: RemoteFileSystem;
  edits?: RemoteEdits;
  syncs?: AutoUploads;
  status: SftpStatus;
  jobs: Job[];
  running?: Job;
  conflict?: { conflict: TransferConflict; resolve: (answer: { choice: ConflictChoice; applyToAll: boolean }) => void };
  key?: Buffer;
  jump?: Jump;
  idleMs?: number;
  lastIo?: number;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export class SftpSessionManager {
  private sessions = new Map<string, Session>();
  constructor(private readonly dependencies: SftpDependencies) {}

  open(ownerId: number, connectionId: string): { sessionId: string } {
    if (this.sessions.size >= MAX_SFTP_SESSIONS) throw new FileError('files.maxSessions', { max: MAX_SFTP_SESSIONS });
    const connection = this.dependencies.getConnection(connectionId);
    if (connection.protocol !== 'sftp' && connection.protocol !== 'ssh') throw new FileError('files.noTransferSupport');
    if (!connection.host.trim() || !connection.username?.trim()) throw new FileError('files.missingHostOrUser');
    const client = this.dependencies.createClient?.() ?? new Client();
    const session: Session = { id: randomUUID(), ownerId, connectionId, client, status: 'connecting', jobs: [] };
    this.sessions.set(session.id, session);
    client.on('error', error => this.fail(session, error));
    // A close while the session is still active was not caused by the user.
    client.on('close', () => this.finish(session, 'closed', undefined, 'closed-by-server'));
    void this.connect(session, connection);
    return { sessionId: session.id };
  }

  private async connect(session: Session, connection: ConnectionNode): Promise<void> {
    if (connection.protocol !== 'sftp' && connection.protocol !== 'ssh') return;
    const timeouts = (this.dependencies.getTimeouts ?? (() => DEFAULT_TIMEOUTS))(connection);
    session.idleMs = timeouts.idleMinutes * 60_000;
    try {
      if (connection.jumpHost && this.dependencies.openJump) {
        session.jump = await this.dependencies.openJump(connection, session.ownerId);
        // The session may have ended while the hop opened; finish could not close it then.
        if (!this.active(session)) { session.jump?.close(); return; }
      }
      const { ask } = this.dependencies;
      const { config, key } = await sshConnectConfig(connection, (hostKey, callback) => {
        void this.dependencies.verifyHost(connection.host, connection.port, hostKey, () => this.active(session))
          .then(valid => {
            if (!valid && this.active(session)) this.finish(session, 'error', { code: 'files.hostKeyRejected' }, 'hostkey-rejected');
            callback(valid && this.active(session));
          }).catch(error => { this.fail(session, error); callback(false); });
      }, timeouts, {
        client: session.client,
        keyboard: ask ? { ask, ownerId: session.ownerId, isActive: () => this.active(session) } : undefined,
        sock: session.jump?.sock,
      });
      session.key = key;
      if (!this.active(session)) { this.clearKey(session); return; }
      session.client.once('ready', () => {
        this.clearKey(session);
        session.client.sftp((error: Error | undefined, sftp: SFTPWrapper) => {
          if (!this.active(session)) { sftp?.end(); return; }
          if (error) { this.finish(session, 'error', { code: 'files.noSftp' }, 'unknown'); return; }
          sftp.on('close', () => this.finish(session, 'closed', undefined, 'closed-by-server'));
          session.fs = sftpFileSystem(sftp);
          session.edits = new RemoteEdits(session.fs, { openFile: this.dependencies.openFile, pollInterval: this.dependencies.editPollInterval,
            emit: (edit, closed) => { if (this.active(session)) this.emit(session, { type: 'edit', sessionId: session.id, edit, ...(closed ? { closed } : {}) }); } });
          session.syncs = new AutoUploads(session.fs, { local: this.dependencies.local,
            emit: (sync, closed) => { if (this.active(session)) this.emit(session, { type: 'sync', sessionId: session.id, sync, ...(closed ? { closed } : {}) }); },
            // One binding id runs in one file view only: two would write the same server files at once.
            inUseElsewhere: bindingId => [...this.sessions.values()].some(other => other !== session && other.syncs?.running(bindingId) === true) });
          session.status = 'connected';
          this.emit(session, { type: 'status', sessionId: session.id, status: 'connected' });
          this.armIdle(session);
          for (const binding of connection.autoUpload ?? []) if (binding.enabled) void session.syncs.start(binding);
        });
      });
      session.client.connect(config);
    } catch (error) { this.fail(session, error); }
  }

  /** Ends the session with the classified error. */
  private fail(session: Session, error: unknown): void {
    const { code, error: coded } = classifyError(error);
    this.finish(session, 'error', coded, code);
  }

  private active(session: Session): boolean { return this.sessions.get(session.id) === session; }
  private clearKey(session: Session): void { session.key?.fill(0); session.key = undefined; }
  private emit(session: Session, event: SftpEvent): void { this.dependencies.emit(session.ownerId, event); }

  private armIdle(session: Session): void {
    session.lastIo = Date.now();
    if (session.idleMs) session.idleTimer = setTimeout(() => this.checkIdle(session), session.idleMs);
  }

  /** Busy sessions (transfer, live auto-upload, open edit) are rearmed for the full time, never closed. */
  private checkIdle(session: Session): void {
    if (!this.active(session)) return;
    const idleMs = session.idleMs!;
    const busy = session.running || session.jobs.some(item => item.job.state === 'queued')
      || session.syncs?.list().some(sync => sync.state !== 'error') || (session.edits?.list().length ?? 0) > 0;
    if (busy) session.lastIo = Date.now();
    const remaining = idleMs - (Date.now() - session.lastIo!);
    if (remaining <= 0) this.finish(session, 'closed', undefined, 'idle');
    else session.idleTimer = setTimeout(() => this.checkIdle(session), remaining);
  }

  private owned(ownerId: number, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) throw new FileError('files.sessionUnavailable');
    session.lastIo = Date.now();
    return session;
  }

  private remote(ownerId: number, id: string): RemoteFileSystem {
    const session = this.owned(ownerId, id);
    if (!session.fs) throw new FileError('files.sessionNotReady');
    return session.fs;
  }

  home(ownerId: number, id: string): Promise<string> { return this.remote(ownerId, id).realpath('.'); }

  async list(ownerId: number, id: string, path: string): Promise<DirectoryListing> {
    const fs = this.remote(ownerId, id);
    const resolved = await fs.realpath(path);
    return { path: resolved, entries: await fs.list(resolved) };
  }

  mkdir(ownerId: number, id: string, path: string): Promise<void> { return this.remote(ownerId, id).mkdir(path); }
  rename(ownerId: number, id: string, from: string, to: string): Promise<void> { return this.remote(ownerId, id).rename(from, to); }

  async delete(ownerId: number, id: string, paths: string[]): Promise<void> {
    const fs = this.remote(ownerId, id);
    for (const path of paths) {
      if (posix.normalize(path) === '/') throw new FileError('files.rootDelete');
      await removeRemote(fs, path);
    }
  }

  /** Sets permission bits; `recursive` also changes everything inside folders (links are not followed). */
  async chmod(ownerId: number, id: string, paths: string[], mode: number, recursive: boolean): Promise<void> {
    const fs = this.remote(ownerId, id);
    const apply = async (path: string, entry: { type: string } | null): Promise<void> => {
      await fs.chmod(path, mode);
      if (!recursive || entry?.type !== 'directory') return;
      for (const child of await fs.list(path)) await apply(fs.join(path, child.name), child);
    };
    for (const path of paths) await apply(path, await fs.lstat(path));
  }

  private editor(ownerId: number, id: string): RemoteEdits {
    this.remote(ownerId, id);
    return this.sessions.get(id)!.edits!;
  }
  /** Downloads a server file into a temporary folder, opens it and uploads every saved change. */
  edit(ownerId: number, id: string, path: string, editor: EditorChoice = 'default'): Promise<{ editId: string }> { return this.editor(ownerId, id).open(path, editor); }

  /** Starts a stored binding; the paths come from the vault, never from the caller. `enabled` only steers the automatic start. */
  async syncStart(ownerId: number, id: string, bindingId: string): Promise<void> {
    const session = this.owned(ownerId, id);
    const connection = this.dependencies.getConnection(session.connectionId);
    const binding = (connection.protocol === 'ssh' || connection.protocol === 'sftp' ? connection.autoUpload : undefined)?.find(item => item.id === bindingId);
    if (!binding) throw new FileError('files.syncNotFound');
    if (!session.syncs) throw new FileError('files.sessionNotReady');
    await session.syncs.start(binding);
  }
  syncStop(ownerId: number, id: string, bindingId: string): void { this.owned(ownerId, id).syncs?.stop(bindingId); }
  syncForce(ownerId: number, id: string, bindingId: string): void {
    const syncs = this.owned(ownerId, id).syncs;
    if (!syncs) throw new FileError('files.sessionNotReady');
    syncs.force(bindingId);
  }

  /** Creates an empty file; an existing file is never replaced. */
  async createFile(ownerId: number, id: string, path: string): Promise<void> {
    const fs = this.remote(ownerId, id);
    if (await fs.lstat(path)) throw new FileError('files.exists');
    await pipeline(Readable.from([]), fs.write(path));
  }
  editOpen(ownerId: number, id: string, editId: string): Promise<void> { return this.editor(ownerId, id).reopen(editId); }
  /** Uploads even if the server copy changed meanwhile. */
  editUpload(ownerId: number, id: string, editId: string): Promise<void> { return this.editor(ownerId, id).upload(editId, true); }
  editClose(ownerId: number, id: string, editId: string): Promise<void> { return this.editor(ownerId, id).close(editId); }

  /** Queues a transfer; jobs of a connection run one after another. */
  transfer(ownerId: number, request: SftpTransferRequest): { jobId: string } {
    const session = this.owned(ownerId, request.sessionId);
    if (!session.fs) throw new FileError('files.sessionNotReady');
    const names = request.sources.map(source => request.direction === 'upload' ? this.dependencies.local.basename(source) : posix.basename(source));
    const job: TransferJob = { id: randomUUID(), direction: request.direction, move: request.move, targetDir: request.targetDir,
      label: names[0] ?? '', entryCount: names.length, state: 'queued', sources: [...request.sources],
      totalBytes: 0, doneBytes: 0, totalFiles: 0, doneFiles: 0, skippedFiles: 0 };
    const entry: Job = { job, sources: request.sources, copied: [], controller: new AbortController(), lastEmit: 0 };
    session.jobs.push(entry);
    this.pruneJobs(session);
    this.emitJob(session, entry, true);
    void this.pump(session);
    return { jobId: job.id };
  }

  private pruneJobs(session: Session): void {
    const finished = session.jobs.filter(item => item.job.state !== 'queued' && item.job.state !== 'running');
    const drop = new Set(finished.slice(0, Math.max(0, finished.length - KEPT_FINISHED_JOBS)));
    if (drop.size) session.jobs = session.jobs.filter(item => !drop.has(item));
  }

  private emitJob(session: Session, entry: Job, force = false): void {
    const now = Date.now();
    if (!force && now - entry.lastEmit < PROGRESS_INTERVAL) return;
    entry.lastEmit = now;
    if (this.active(session)) this.emit(session, { type: 'transfer', sessionId: session.id, job: { ...entry.job } });
  }

  private async pump(session: Session): Promise<void> {
    if (session.running || !session.fs) return;
    const entry = session.jobs.find(item => item.job.state === 'queued');
    if (!entry) return;
    session.running = entry;
    const { job, controller } = entry;
    job.state = 'running';
    this.emitJob(session, entry, true);
    const [from, to] = job.direction === 'upload' ? [this.dependencies.local, session.fs] : [session.fs, this.dependencies.local];
    try {
      const { items, skipped } = await planTransfer(from, to, entry.sources, job.targetDir, controller.signal);
      job.skippedFiles += skipped;
      await runTransfer(job, items, from, to, {
        progress: () => this.emitJob(session, entry),
        conflict: details => this.ask(session, entry, details),
        keepPartial: true,
        copied: (source, target) => { if (entry.copied.length <= VERIFY_MAX) entry.copied.push({ source, target }); },
      }, controller.signal);
      job.state = 'done';
    } catch (error) {
      job.state = error instanceof TransferCanceled || controller.signal.aborted ? 'canceled' : 'error';
      if (job.state === 'error') job.error = fileError(error);
    } finally {
      job.current = undefined;
      job.bytesPerSecond = undefined;
      session.running = undefined;
      // A question of a stopped job must not come back with `state`.
      if (session.conflict?.conflict.jobId === job.id) session.conflict = undefined;
      if (!job.resumedFrom) entry.copied = [];
      session.lastIo = Date.now();
      this.emitJob(session, entry, true);
    }
    if (this.active(session)) void this.pump(session);
  }

  private ask(session: Session, entry: Job, details: Omit<TransferConflict, 'conflictId' | 'jobId'>): Promise<{ choice: ConflictChoice; applyToAll: boolean }> {
    return new Promise(resolve => {
      const conflict: TransferConflict = { ...details, conflictId: randomUUID(), jobId: entry.job.id };
      session.conflict = { conflict, resolve: answer => { session.conflict = undefined; resolve(answer); } };
      // Progress shown while the question is open should be current.
      this.emitJob(session, entry, true);
      this.emit(session, { type: 'conflict', sessionId: session.id, conflict });
    });
  }

  resolveConflict(ownerId: number, id: string, conflictId: string, choice: ConflictChoice, applyToAll: boolean): void {
    const session = this.owned(ownerId, id);
    if (session.conflict?.conflict.conflictId === conflictId) session.conflict.resolve({ choice, applyToAll });
  }

  cancel(ownerId: number, id: string, jobId: string): void {
    const session = this.owned(ownerId, id);
    const entry = session.jobs.find(item => item.job.id === jobId);
    if (!entry) return;
    if (entry.job.state === 'queued') { entry.job.state = 'canceled'; this.emitJob(session, entry, true); return; }
    entry.controller.abort();
    if (session.conflict?.conflict.jobId === jobId) session.conflict.resolve({ choice: 'cancel', applyToAll: false });
  }

  /** "Prüfen": sha256 of every file the job copied, local stream against sha256sum on the server. Result lands on the job and is emitted. */
  async verify(ownerId: number, id: string, jobId: string): Promise<void> {
    const session = this.owned(ownerId, id);
    const entry = session.jobs.find(item => item.job.id === jobId);
    if (!entry || entry.job.state !== 'done' || !entry.job.resumedFrom || entry.job.verify === 'running') return;
    if (entry.copied.length > VERIFY_MAX) throw new FileError('files.verifyTooMany', { max: VERIFY_MAX });
    entry.job.verify = 'running'; entry.job.mismatched = undefined; this.emitJob(session, entry, true);
    try {
      const mismatched = await verifyCopies(session.client, entry.copied, entry.job.direction);
      entry.job.verify = mismatched.length ? 'mismatch' : 'ok';
      entry.job.mismatched = mismatched.length ? mismatched : undefined;
    } catch (error) { entry.job.verify = undefined; throw error; }
    finally { if (this.active(session)) this.emitJob(session, entry, true); }
  }

  /** Removes finished jobs from the list. */
  clearFinished(ownerId: number, id: string): void {
    const session = this.owned(ownerId, id);
    session.jobs = session.jobs.filter(item => item.job.state === 'queued' || item.job.state === 'running');
  }

  state(ownerId: number, id: string): SftpSessionState {
    const session = this.owned(ownerId, id);
    return { status: session.status, jobs: session.jobs.map(item => ({ ...item.job })), edits: session.edits?.list() ?? [], syncs: session.syncs?.list() ?? [],
      ...(session.conflict ? { conflict: session.conflict.conflict } : {}) };
  }

  /** Moves the connection to another window; it fetches the current state with `state`. */
  transferOwner(fromOwner: number, id: string, toOwner: number): 'connecting' | 'connected' {
    const session = this.owned(fromOwner, id);
    session.ownerId = toOwner;
    return session.status === 'connected' ? 'connected' : 'connecting';
  }

  close(ownerId: number, id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    this.owned(ownerId, id);
    this.finish(session, 'closed');
  }

  closeAll(): void { for (const session of [...this.sessions.values()]) this.finish(session, 'closed'); }
  closeOwner(ownerId: number): void {
    for (const session of [...this.sessions.values()]) if (session.ownerId === ownerId) this.finish(session, 'closed');
  }
  owns(ownerId: number, id: string): boolean { return this.sessions.get(id)?.ownerId === ownerId; }
  hasOwner(ownerId: number): boolean { return [...this.sessions.values()].some(session => session.ownerId === ownerId); }

  private finish(session: Session, status: 'closed' | 'error', error?: CodedError, code?: ConnectionErrorCode): void {
    if (!this.active(session)) return;
    clearTimeout(session.idleTimer);
    // Before the session leaves the map: the emit guard drops events of inactive sessions.
    session.syncs?.closeAll();
    this.sessions.delete(session.id);
    this.clearKey(session);
    for (const entry of session.jobs) entry.controller.abort();
    session.conflict?.resolve({ choice: 'cancel', applyToAll: false });
    session.edits?.closeAll();
    session.client.destroy();
    session.jump?.close();
    session.status = status;
    this.dependencies.emit(session.ownerId, { type: 'status', sessionId: session.id, status, ...(error ? { error: limitError(error) } : {}), ...(code ? { code } : {}) });
  }
}
