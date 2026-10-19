import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { posix } from 'node:path';
import { Client } from 'ssh2';
import type { SFTPWrapper } from 'ssh2';
import type { ConnectionNode } from '../../shared/vault/types';
import { MAX_SFTP_SESSIONS } from '../../shared/sftp';
import type { EditorChoice } from '../../shared/sftp';
import type { ConflictChoice, DirectoryListing, SftpEvent, SftpSessionState, SftpStatus, SftpTransferRequest, TransferConflict, TransferJob } from '../../shared/sftp';
import { sshConnectConfig } from '../ssh/client-config';
import { publicError } from '../ssh/session';
import { FileError, fileErrorText } from './file-system';
import type { FileSystem } from './file-system';
import { removeRemote, sftpFileSystem } from './sftp-file-system';
import type { RemoteFileSystem } from './sftp-file-system';
import { planTransfer, runTransfer, TransferCanceled } from './transfer';
import { RemoteEdits } from './remote-edit';

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
  /** Injected so tests never open network connections. */
  createClient?: () => Client;
}

interface Job {
  job: TransferJob;
  sources: string[];
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
  status: SftpStatus;
  jobs: Job[];
  running?: Job;
  conflict?: { conflict: TransferConflict; resolve: (answer: { choice: ConflictChoice; applyToAll: boolean }) => void };
  key?: Buffer;
}

export class SftpSessionManager {
  private sessions = new Map<string, Session>();
  constructor(private readonly dependencies: SftpDependencies) {}

  open(ownerId: number, connectionId: string): { sessionId: string } {
    if (this.sessions.size >= MAX_SFTP_SESSIONS) throw new FileError(`Maximal ${MAX_SFTP_SESSIONS} Dateiverbindungen gleichzeitig. Schließe zuerst einen Tab.`);
    const connection = this.dependencies.getConnection(connectionId);
    if (connection.protocol !== 'sftp' && connection.protocol !== 'ssh') throw new FileError('Diese Verbindung unterstützt keine Dateiübertragung.');
    if (!connection.host.trim() || !connection.username?.trim()) throw new FileError('Bitte speichere Host und Benutzername, bevor du die Verbindung startest.');
    const client = this.dependencies.createClient?.() ?? new Client();
    const session: Session = { id: randomUUID(), ownerId, connectionId, client, status: 'connecting', jobs: [] };
    this.sessions.set(session.id, session);
    client.on('error', error => this.finish(session, 'error', publicError(error)));
    client.on('close', () => this.finish(session, 'closed'));
    void this.connect(session, connection);
    return { sessionId: session.id };
  }

  private async connect(session: Session, connection: ConnectionNode): Promise<void> {
    if (connection.protocol !== 'sftp' && connection.protocol !== 'ssh') return;
    try {
      const { config, key } = await sshConnectConfig(connection, (hostKey, callback) => {
        void this.dependencies.verifyHost(connection.host, connection.port, hostKey, () => this.active(session))
          .then(valid => {
            if (!valid && this.active(session)) this.finish(session, 'error', 'Der Server-Schlüssel wurde nicht bestätigt.');
            callback(valid && this.active(session));
          }).catch(error => { this.finish(session, 'error', publicError(error)); callback(false); });
      });
      session.key = key;
      if (!this.active(session)) { this.clearKey(session); return; }
      session.client.once('ready', () => {
        this.clearKey(session);
        session.client.sftp((error: Error | undefined, sftp: SFTPWrapper) => {
          if (!this.active(session)) { sftp?.end(); return; }
          if (error) { this.finish(session, 'error', 'Der Server bietet kein SFTP an.'); return; }
          sftp.on('close', () => this.finish(session, 'closed'));
          session.fs = sftpFileSystem(sftp);
          session.edits = new RemoteEdits(session.fs, { openFile: this.dependencies.openFile, pollInterval: this.dependencies.editPollInterval,
            emit: (edit, closed) => { if (this.active(session)) this.emit(session, { type: 'edit', sessionId: session.id, edit, ...(closed ? { closed } : {}) }); } });
          session.status = 'connected';
          this.emit(session, { type: 'status', sessionId: session.id, status: 'connected' });
        });
      });
      session.client.connect(config);
    } catch (error) { this.finish(session, 'error', publicError(error)); }
  }

  private active(session: Session): boolean { return this.sessions.get(session.id) === session; }
  private clearKey(session: Session): void { session.key?.fill(0); session.key = undefined; }
  private emit(session: Session, event: SftpEvent): void { this.dependencies.emit(session.ownerId, event); }

  private owned(ownerId: number, id: string): Session {
    const session = this.sessions.get(id);
    if (!session || session.ownerId !== ownerId) throw new FileError('Die Dateiverbindung ist nicht verfügbar.');
    return session;
  }

  private remote(ownerId: number, id: string): RemoteFileSystem {
    const session = this.owned(ownerId, id);
    if (!session.fs) throw new FileError('Die Dateiverbindung ist noch nicht bereit.');
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
      if (posix.normalize(path) === '/') throw new FileError('Das Wurzelverzeichnis kann nicht gelöscht werden.');
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

  /** Creates an empty file; an existing file is never replaced. */
  async createFile(ownerId: number, id: string, path: string): Promise<void> {
    const fs = this.remote(ownerId, id);
    if (await fs.lstat(path)) throw new FileError('Ein Eintrag mit diesem Namen existiert bereits.');
    await pipeline(Readable.from([]), fs.write(path));
  }
  editOpen(ownerId: number, id: string, editId: string): Promise<void> { return this.editor(ownerId, id).reopen(editId); }
  /** Uploads even if the server copy changed meanwhile. */
  editUpload(ownerId: number, id: string, editId: string): Promise<void> { return this.editor(ownerId, id).upload(editId, true); }
  editClose(ownerId: number, id: string, editId: string): Promise<void> { return this.editor(ownerId, id).close(editId); }

  /** Queues a transfer; jobs of a connection run one after another. */
  transfer(ownerId: number, request: SftpTransferRequest): { jobId: string } {
    const session = this.owned(ownerId, request.sessionId);
    if (!session.fs) throw new FileError('Die Dateiverbindung ist noch nicht bereit.');
    const names = request.sources.map(source => request.direction === 'upload' ? this.dependencies.local.basename(source) : posix.basename(source));
    const job: TransferJob = { id: randomUUID(), direction: request.direction, move: request.move, targetDir: request.targetDir,
      label: names.length === 1 ? names[0] : `${names.length} Einträge`, state: 'queued',
      totalBytes: 0, doneBytes: 0, totalFiles: 0, doneFiles: 0, skippedFiles: 0 };
    const entry: Job = { job, sources: request.sources, controller: new AbortController(), lastEmit: 0 };
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
      }, controller.signal);
      job.state = 'done';
    } catch (error) {
      job.state = error instanceof TransferCanceled || controller.signal.aborted ? 'canceled' : 'error';
      if (job.state === 'error') job.message = fileErrorText(error);
    } finally {
      job.current = undefined;
      session.running = undefined;
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

  /** Removes finished jobs from the list. */
  clearFinished(ownerId: number, id: string): void {
    const session = this.owned(ownerId, id);
    session.jobs = session.jobs.filter(item => item.job.state === 'queued' || item.job.state === 'running');
  }

  state(ownerId: number, id: string): SftpSessionState {
    const session = this.owned(ownerId, id);
    return { status: session.status, jobs: session.jobs.map(item => ({ ...item.job })), edits: session.edits?.list() ?? [],
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

  private finish(session: Session, status: 'closed' | 'error', message?: string): void {
    if (!this.active(session)) return;
    this.sessions.delete(session.id);
    this.clearKey(session);
    for (const entry of session.jobs) entry.controller.abort();
    session.conflict?.resolve({ choice: 'cancel', applyToAll: false });
    session.edits?.closeAll();
    session.client.destroy();
    session.status = status;
    this.dependencies.emit(session.ownerId, { type: 'status', sessionId: session.id, status, ...(message ? { message } : {}) });
  }
}
