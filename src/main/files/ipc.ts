import { ipcMain, shell, webContents } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { spawn } from 'node:child_process';
import { extname, win32 } from 'node:path';
import { z } from 'zod';
import { parseRequest } from '../ssh/validation';
import { AppError } from '../../shared/errors';
import { AUTO_UPLOAD_LOCAL_PATH } from '../../shared/vault/schema';
import { IPC_CHANNELS } from '../../shared/ipc';
import type { EditorChoice } from '../../shared/sftp';
import { writeFile } from 'node:fs/promises';
import type { KnownHosts } from '../ssh/known-hosts';
import { requireSshSender } from '../ssh/ipc';
import { findConnection } from '../ssh/session';
import type { AuthPrompts } from '../ssh/auth-prompts';
import { openJump } from '../ssh/jump';
import { openRemoteHost } from '../containers/runner';
import { vaultSessionManager } from '../vault/ipc';
import { effectiveTimeouts } from '../../shared/vault/timeouts';
import { FileError, fileError, localFileSystem, localPlaces } from './file-system';
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
// Typed paths reach this channel: drive or UNC only, never device paths (\\?\, \\.\).
const LocalListSchema = z.object({ path: localPath.refine(value => AUTO_UPLOAD_LOCAL_PATH.test(value)) }).strict();
const LocalRenameSchema = z.object({ from: localPath, to: localPath }).strict();
const LocalDeleteSchema = z.object({ paths: z.array(localPath).min(1).max(1000) }).strict();

const editor = z.enum(['default', 'notepad']);
const EditFileSchema = z.object({ ...session, path: remotePath, editor }).strict();
const LocalOpenSchema = z.object({ path: localPath, editor }).strict();
const EditSchema = z.object({ ...session, editId: z.string().uuid() }).strict();
const SyncSchema = z.object({ ...session, bindingId: z.string().uuid() }).strict();
const ChmodSchema = z.object({ ...session, paths: z.array(remotePath).min(1).max(1000), mode: z.number().int().min(0).max(0o7777), recursive: z.boolean() }).strict();

// Only types whose Windows association is a viewer or editor, never an interpreter. Everything else opens in Notepad.
const EDITABLE = /^\.(txt|text|md|markdown|rst|json|json5|jsonc|yaml|yml|toml|ini|cfg|conf|config|properties|env|log|csv|tsv|xml|xsd|xsl|sql|diff|patch|c|h|cc|cpp|hpp|cs|java|go|rs|kt|swift|ts|tsx|jsx|css|scss|less|vue|svelte|graphql|proto|tf|hcl|service|timer)$/i;

export function editorFor(path: string, editor: EditorChoice): EditorChoice {
  return editor === 'notepad' || !EDITABLE.test(extname(path)) ? 'notepad' : 'default';
}

function openInNotepad(path: string): void {
  spawn(win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'notepad.exe'), [path], { detached: true, stdio: 'ignore' }).unref();
}

/** Opens an edited copy with the program Windows associates with it, never by running it. */
export async function openForEditing(path: string, editor: EditorChoice = 'default'): Promise<void> {
  if (editorFor(path, editor) === 'notepad' || await shell.openPath(path)) openInNotepad(path);
}

/** Registers a handler whose errors reach the window as readable text, never as internal details. */
function handle<T>(channel: string, schema: z.ZodType<T>, run: (ownerId: number, request: T) => unknown): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, request: unknown) => {
    const ownerId = requireSshSender(event);
    // Session-bound channels are guarded by ownership: the session only exists if the vault was unlocked when it opened.
    if (!(channel.startsWith('sftp:') && channel !== IPC_CHANNELS.sftpOpen)) vaultSessionManager.getSnapshot();
    const parsed = parseRequest(schema, request, 'files.invalidRequest');
    try { return await run(ownerId, parsed); } catch (error) { throw AppError.from(fileError(error)); }
  });
}

export function registerFileIpcHandlers(knownHosts: KnownHosts, prompts: AuthPrompts): SftpSessionManager {
  const manager = new SftpSessionManager({
    getConnection: id => {
      const connection = findConnection(vaultSessionManager.getSnapshot().vault.nodes, id);
      if (!connection) throw new FileError('files.connectionNotFound');
      return connection;
    },
    getTimeouts: connection => effectiveTimeouts(vaultSessionManager.getSnapshot().vault.settings, connection),
    verifyHost: (host, port, key, isActive) => knownHosts.verify(host, port, key, isActive),
    ask: prompts.ask,
    openJump: (connection, ownerId, active) => openJump(connection, {
      getConnection: id => findConnection(vaultSessionManager.getSnapshot().vault.nodes, id),
      openRemote: (jump, owner, active) => openRemoteHost(jump, (host, port, key, isActive) => knownHosts.verify(host, port, key, isActive), undefined,
        effectiveTimeouts(vaultSessionManager.getSnapshot().vault.settings, jump), { ask: prompts.ask, ownerId: owner, isActive: active }),
    }, ownerId, active),
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
  handle(IPC_CHANNELS.sftpVerify, JobSchema, (ownerId, request) => manager.verify(ownerId, request.sessionId, request.jobId));
  handle(IPC_CHANNELS.sftpClearFinished, SessionSchema, (ownerId, request) => manager.clearFinished(ownerId, request.sessionId));
  handle(IPC_CHANNELS.sftpState, SessionSchema, (ownerId, request) => manager.state(ownerId, request.sessionId));
  handle(IPC_CHANNELS.sftpChmod, ChmodSchema, (ownerId, request) => manager.chmod(ownerId, request.sessionId, request.paths, request.mode, request.recursive));
  handle(IPC_CHANNELS.sftpEdit, EditFileSchema, (ownerId, request) => manager.edit(ownerId, request.sessionId, request.path, request.editor));
  handle(IPC_CHANNELS.sftpCreateFile, RemotePathSchema, (ownerId, request) => manager.createFile(ownerId, request.sessionId, request.path));
  handle(IPC_CHANNELS.sftpEditOpen, EditSchema, (ownerId, request) => manager.editOpen(ownerId, request.sessionId, request.editId));
  handle(IPC_CHANNELS.sftpEditUpload, EditSchema, (ownerId, request) => manager.editUpload(ownerId, request.sessionId, request.editId));
  handle(IPC_CHANNELS.sftpEditClose, EditSchema, (ownerId, request) => manager.editClose(ownerId, request.sessionId, request.editId));
  handle(IPC_CHANNELS.sftpSyncStart, SyncSchema, (ownerId, request) => manager.syncStart(ownerId, request.sessionId, request.bindingId));
  handle(IPC_CHANNELS.sftpSyncStop, SyncSchema, (ownerId, request) => manager.syncStop(ownerId, request.sessionId, request.bindingId));
  handle(IPC_CHANNELS.sftpSyncForce, SyncSchema, (ownerId, request) => manager.syncForce(ownerId, request.sessionId, request.bindingId));
  handle(IPC_CHANNELS.sftpClose, SessionSchema, (ownerId, request) => manager.close(ownerId, request.sessionId));

  handle(IPC_CHANNELS.localPlaces, z.undefined(), () => localPlaces());
  handle(IPC_CHANNELS.localList, LocalListSchema, async (_ownerId, request) => {
    const path = win32.resolve(request.path);
    return { path, entries: await localFileSystem.list(path) };
  });
  handle(IPC_CHANNELS.localMkdir, LocalPathSchema, (_ownerId, request) => localFileSystem.mkdir(request.path));
  handle(IPC_CHANNELS.localCreateFile, LocalPathSchema, (_ownerId, request) => writeFile(request.path, '', { flag: 'wx' }));
  handle(IPC_CHANNELS.localOpen, LocalOpenSchema, (_ownerId, request) => openForEditing(request.path, request.editor));
  handle(IPC_CHANNELS.localRename, LocalRenameSchema, (_ownerId, request) => localFileSystem.rename(request.from, request.to));
  // Local deletes go to the recycle bin and can be undone there.
  handle(IPC_CHANNELS.localDelete, LocalDeleteSchema, async (_ownerId, request) => {
    for (const path of request.paths) await shell.trashItem(path);
  });
  return manager;
}
