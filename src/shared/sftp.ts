/** Shared types of the file browser (SFTP now, FTP later). */
import type { ConnectionErrorCode } from './connection-errors';
import type { CodedError } from './errors';

export const MAX_SFTP_SESSIONS = 16;

export type FileType = 'file' | 'directory' | 'link';

export interface FileEntry {
  name: string;
  type: FileType;
  size: number;
  /** Last modification, milliseconds since 1970. */
  modified: number;
  /** `rwxr-xr-x` style; remote entries only. */
  permissions?: string;
  /** Permission bits (e.g. 0o644); remote entries only. */
  mode?: number;
  /** Links: what they point to; unknown for broken links. */
  linkTarget?: 'file' | 'directory';
}

export interface DirectoryListing { path: string; entries: FileEntry[] }

export type SftpStatus = 'connecting' | 'connected' | 'closed' | 'error';
export type TransferDirection = 'upload' | 'download';
export type TransferState = 'queued' | 'running' | 'done' | 'error' | 'canceled';
export type ConflictChoice = 'overwrite' | 'skip' | 'newer' | 'cancel';

export interface TransferJob {
  id: string;
  direction: TransferDirection;
  /** Delete each source after it was copied. */
  move: boolean;
  /** Name of the first entry. */
  label: string;
  /** Number of requested sources. */
  entryCount: number;
  targetDir: string;
  state: TransferState;
  totalBytes: number;
  doneBytes: number;
  totalFiles: number;
  doneFiles: number;
  skippedFiles: number;
  current?: string;
  /** Smoothed rate of the running copy; absent in the first second, while a conflict question is open and after the end. */
  bytesPerSecond?: number;
  /** Absolute paths on the source side as requested; moved top-level files leave the list. Absent for auto-upload. */
  sources?: string[];
  /** Target-side paths of half-written .part files: set while files are copied, kept after a cancel or failure, gone after the swap. */
  partials?: string[];
  /** Bytes taken over from leftover .part files when the copy continued (sum over the job). */
  resumedFrom?: number;
  /** A leftover .part did not match the source and was discarded; the copy started over. */
  restarted?: boolean;
  /** "Prüfen": sha256 of every copied file on both sides; `mismatched` names the files that differ. */
  verify?: 'running' | 'ok' | 'mismatch';
  mismatched?: string[];
  error?: CodedError;
}

export interface TransferConflict {
  conflictId: string;
  jobId: string;
  name: string;
  source: { size: number; modified: number };
  target: { size: number; modified: number };
}

/** A server file opened in a local editor; saving uploads it again. */
export interface EditedFile {
  id: string;
  name: string;
  remotePath: string;
  state: 'open' | 'uploading' | 'saved' | 'conflict' | 'error';
  /** Last successful upload, milliseconds since 1970. */
  savedAt?: number;
  error?: CodedError;
}

export type SftpEvent =
  /** `error` is translated by the renderer; `code` classifies the connection card (only with status 'error', or 'closed-by-server' with 'closed'). */
  | { type: 'status'; sessionId: string; status: SftpStatus; error?: CodedError; code?: ConnectionErrorCode }
  | { type: 'edit'; sessionId: string; edit: EditedFile; closed?: boolean }
  | { type: 'transfer'; sessionId: string; job: TransferJob }
  | { type: 'conflict'; sessionId: string; conflict: TransferConflict }
  | { type: 'sync'; sessionId: string; sync: AutoUploadStatus; closed?: boolean };

export type AutoUploadState = 'syncing' | 'watching' | 'error';
export interface AutoUploadStatus {
  bindingId: string;
  /** As stored in the binding (display only). */
  localPath: string;
  remotePath: string;
  /** `syncing` only during a full comparison (start, storm, overflow); single uploads keep `watching`. */
  state: AutoUploadState;
  /** Files uploaded since the binding started. */
  synced: number;
  /** Relative POSIX paths skipped because the server copy is newer or was changed by someone else; max 100. */
  skipped: string[];
  /** Skipped beyond the first 100. */
  skippedMore: number;
  /** Relative POSIX paths whose upload failed; max 100; removed again after a later successful upload. */
  failed: string[];
  last?: { name: string; at: number };
  /** With state 'error': why the binding stopped. Otherwise: cause of the latest entry in `failed`. */
  error?: CodedError;
}

export interface SftpOpenRequest { connectionId: string }
export interface SftpSessionRequest { sessionId: string }
export interface SftpPathRequest extends SftpSessionRequest { path: string }
export interface SftpRenameRequest extends SftpSessionRequest { from: string; to: string }
export interface SftpDeleteRequest extends SftpSessionRequest { paths: string[] }
export interface SftpTransferRequest extends SftpSessionRequest {
  direction: TransferDirection;
  /** Absolute paths on the source side. */
  sources: string[];
  targetDir: string;
  move: boolean;
}
export interface SftpJobRequest extends SftpSessionRequest { jobId: string }
export interface SftpConflictAnswer extends SftpSessionRequest { conflictId: string; choice: ConflictChoice; applyToAll: boolean }
/** Running and finished jobs plus an open question; used when a tab is opened in another window. */
export interface SftpSessionState { status: SftpStatus; jobs: TransferJob[]; conflict?: TransferConflict; edits: EditedFile[]; syncs?: AutoUploadStatus[] }
/** `default`: the program Windows associates with the file; `notepad`: always the built-in Notepad. */
export type EditorChoice = 'default' | 'notepad';
export interface SftpEditRequest extends SftpSessionRequest { editId: string }
export interface SftpSyncRequest extends SftpSessionRequest { bindingId: string }
export interface SftpEditFileRequest extends SftpPathRequest { editor: EditorChoice }
export interface LocalOpenRequest extends LocalPathRequest { editor: EditorChoice }
export interface SftpChmodRequest extends SftpSessionRequest { paths: string[]; mode: number; recursive: boolean }

export interface LocalPathRequest { path: string }
export interface LocalRenameRequest { from: string; to: string }
export interface LocalDeleteRequest { paths: string[] }
export interface LocalPlaces { home: string; drives: string[] }
