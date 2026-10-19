/** Shared types of the file browser (SFTP now, FTP later). */
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
  | { type: 'status'; sessionId: string; status: SftpStatus; error?: CodedError }
  | { type: 'edit'; sessionId: string; edit: EditedFile; closed?: boolean }
  | { type: 'transfer'; sessionId: string; job: TransferJob }
  | { type: 'conflict'; sessionId: string; conflict: TransferConflict };

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
export interface SftpSessionState { status: SftpStatus; jobs: TransferJob[]; conflict?: TransferConflict; edits: EditedFile[] }
/** `default`: the program Windows associates with the file; `notepad`: always the built-in Notepad. */
export type EditorChoice = 'default' | 'notepad';
export interface SftpEditRequest extends SftpSessionRequest { editId: string }
export interface SftpEditFileRequest extends SftpPathRequest { editor: EditorChoice }
export interface LocalOpenRequest extends LocalPathRequest { editor: EditorChoice }
export interface SftpChmodRequest extends SftpSessionRequest { paths: string[]; mode: number; recursive: boolean }

export interface LocalPathRequest { path: string }
export interface LocalRenameRequest { from: string; to: string }
export interface LocalDeleteRequest { paths: string[] }
export interface LocalPlaces { home: string; drives: string[] }
