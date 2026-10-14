import { ipcMain, shell, webContents } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { spawn } from 'node:child_process';
import { extname, win32 } from 'node:path';
import { z } from 'zod';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { KnownHosts } from '../ssh/known-hosts';
import { requireSshSender } from '../ssh/ipc';
import { findConnection } from '../ssh/session';
import { vaultSessionManager } from '../vault/ipc';
import { FileError, fileErrorText, localFileSystem, localPlaces } from './file-system';
import { SftpSessionManager } from './sftp-session';

const noNul = (value: string) => !value.includes('\0');
const remotePath = z.string().min(1).max(4096).refine(noNul).refine(value => value.startsWith('/') || value === '.');
const localPath = z.string().min(1).max(32_767).refine(noNul).refine(value => win32.isAbsolute(value));
const session = { sessionId: z.string().uuid() };
const SessionSchema = z.object(session).strict();
const OpenSchema = z.object({ connectionId: z.string().min(1).max(256) }).strict();
const RemotePathSchema = z.object({ ...session, path: remotePath }).strict();
const RemoteRenameSchema = z.object({ ...session, from: remotePath, to: remotePath }).strict();
const RemoteDeleteSchema = z.object({ ...session, paths: z.array(remotePath).min(1).max(1000) }).strict();
const TransferSchema = z.discriminatedUnion('direction', [
  z.object({ ...session, direction: z.literal('upload'), sources: z.array(localPath).min(1).max(1000), targetDir: remotePath, move: z.boolean() }).strict(),
  z.object({ ...session, direction: z.literal('download'), sources: z.array(remotePath).min(1).max(1000), targetDir: localPath, move: z.boolean() }).strict(),
]);
const JobSchema = z.object({ ...session, jobId: z.string().uuid() }).strict();
const ConflictSchema = z.object({ ...session, conflictId: z.string().uuid(), choice: z.enum(['overwrite', 'skip', 'newer', 'cancel']), applyToAll: z.boolean() }).strict();
const LocalPathSchema = z.object({ path: localPath }).strict();
const LocalRenameSchema = z.object({ from: localPath, to: localPath }).strict();
const LocalDeleteSchema = z.object({ paths: z.array(localPath).min(1).max(1000) }).strict();

const EditSchema = z.object({ ...session, editId: z.string().uuid() }).strict();
const ChmodSchema = z.object({ ...session, paths: z.array(remotePath).min(1).max(1000), mode: z.number().int().min(0).max(0o7777), recursive: z.boolean() }).strict();

// Programs and scripts would run instead of opening; they and files without extension open in Notepad.
const RUNNABLE = /^\.(exe|com|bat|cmd|ps1|psm1|psd1|vbs|vbe|js|jse|wsf|wsh|msi|msp|msc|lnk|url|scr|hta|cpl|jar|reg|pif|scf|inf|application|appref-ms|dll|sys)$/i;

function openInNotepad(path: string): void {
  spawn(win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'notepad.exe'), [path], { detached: true, stdio: 'ignore' }).unref();
}

/** Opens an edited copy with the program Windows associates with it, never by running it. */
export async function openForEditing(path: string): Promise<void> {
  const extension = extname(path);
  if (!extension || RUNNABLE.test(extension)) { openInNotepad(path); return; }
  if (await shell.openPath(path)) openInNotepad(path);
}

function parse<T>(schema: z.ZodType<T>, request: unknown): T {
  const result = schema.safeParse(request);
  if (!result.success) throw new Error('Ungültige Dateianfrage.');
  return result.data;
}

/** Registers a handler whose errors reach the window as readable text, never as internal details. */
function handle<T>(channel: string, schema: z.ZodType<T>, run: (ownerId: number, request: T) => unknown): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, request: unknown) => {
    const ownerId = requireSshSender(event);
    vaultSessionManager.getSnapshot();
    const parsed = parse(schema, request);
    try { return await run(ownerId, parsed); } catch (error) { throw new Error(fileErrorText(error)); }
  });
}

export function registerFileIpcHandlers(knownHosts: KnownHosts): SftpSessionManager {
  const manager = new SftpSessionManager({
    getConnection: id => {
      const connection = findConnection(vaultSessionManager.getSnapshot().vault.nodes, id);
      if (!connection) throw new FileError('Die Verbindung wurde nicht gefunden.');
      return connection;
    },
    verifyHost: (host, port, key, isActive) => knownHosts.verify(host, port, key, isActive),
    emit: (ownerId, event) => {
      const owner = webContents.fromId(ownerId);
      if (owner && !owner.isDestroyed()) owner.send(IPC_CHANNELS.sftpEvent, event);
    },
    local: localFileSystem,
    openFile: openForEditing,
  });
  handle(IPC_CHANNELS.sftpOpen, OpenSchema, (ownerId, request) => manager.open(ownerId, request.connectionId));
  handle(IPC_CHANNELS.sftpHome, SessionSchema, (ownerId, request) => manager.home(ownerId, request.sessionId));
  handle(IPC_CHANNELS.sftpList, RemotePathSchema, (ownerId, request) => manager.list(ownerId, request.sessionId, request.path));
  handle(IPC_CHANNELS.sftpMkdir, RemotePathSchema, (ownerId, request) => manager.mkdir(ownerId, request.sessionId, request.path));
  handle(IPC_CHANNELS.sftpRename, RemoteRenameSchema, (ownerId, request) => manager.rename(ownerId, request.sessionId, request.from, request.to));
  handle(IPC_CHANNELS.sftpDelete, RemoteDeleteSchema, (ownerId, request) => manager.delete(ownerId, request.sessionId, request.paths));
  handle(IPC_CHANNELS.sftpTransfer, TransferSchema, (ownerId, request) => manager.transfer(ownerId, request));
  handle(IPC_CHANNELS.sftpCancel, JobSchema, (ownerId, request) => manager.cancel(ownerId, request.sessionId, request.jobId));
  handle(IPC_CHANNELS.sftpResolve, ConflictSchema, (ownerId, request) =>
    manager.resolveConflict(ownerId, request.sessionId, request.conflictId, request.choice, request.applyToAll));
  handle(IPC_CHANNELS.sftpClearFinished, SessionSchema, (ownerId, request) => manager.clearFinished(ownerId, request.sessionId));
  handle(IPC_CHANNELS.sftpState, SessionSchema, (ownerId, request) => manager.state(ownerId, request.sessionId));
  handle(IPC_CHANNELS.sftpChmod, ChmodSchema, (ownerId, request) => manager.chmod(ownerId, request.sessionId, request.paths, request.mode, request.recursive));
  handle(IPC_CHANNELS.sftpEdit, RemotePathSchema, (ownerId, request) => manager.edit(ownerId, request.sessionId, request.path));
  handle(IPC_CHANNELS.sftpEditOpen, EditSchema, (ownerId, request) => manager.editOpen(ownerId, request.sessionId, request.editId));
  handle(IPC_CHANNELS.sftpEditUpload, EditSchema, (ownerId, request) => manager.editUpload(ownerId, request.sessionId, request.editId));
  handle(IPC_CHANNELS.sftpEditClose, EditSchema, (ownerId, request) => manager.editClose(ownerId, request.sessionId, request.editId));
  handle(IPC_CHANNELS.sftpClose, SessionSchema, (ownerId, request) => manager.close(ownerId, request.sessionId));

  handle(IPC_CHANNELS.localPlaces, z.undefined(), () => localPlaces());
  handle(IPC_CHANNELS.localList, LocalPathSchema, async (_ownerId, request) => {
    const path = win32.resolve(request.path);
    return { path, entries: await localFileSystem.list(path) };
  });
  handle(IPC_CHANNELS.localMkdir, LocalPathSchema, (_ownerId, request) => localFileSystem.mkdir(request.path));
  handle(IPC_CHANNELS.localRename, LocalRenameSchema, (_ownerId, request) => localFileSystem.rename(request.from, request.to));
  // Local deletes go to the recycle bin and can be undone there.
  handle(IPC_CHANNELS.localDelete, LocalDeleteSchema, async (_ownerId, request) => {
    for (const path of request.paths) await shell.trashItem(path);
  });
  return manager;
}
