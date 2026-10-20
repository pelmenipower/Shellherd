import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, unwatchFile, watchFile } from 'node:fs';
import type { Stats } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { EditedFile, EditorChoice } from '../../shared/sftp';
import { FileError, fileError, unsafeLocalName } from './file-system';
import type { RemoteFileSystem } from './sftp-file-system';

const MAX_EDIT_SIZE = 50 * 1024 * 1024;
/** Editors often save in several steps; upload once the file is quiet. */
const SETTLE_DELAY = 500;

export interface EditDependencies {
  /** Opens the local copy in an editor. */
  openFile: (path: string, editor: EditorChoice) => Promise<void>;
  emit: (edit: EditedFile, closed?: boolean) => void;
  pollInterval?: number;
}

interface Edit {
  info: EditedFile;
  dir: string;
  localPath: string;
  editor: EditorChoice;
  /** Server time of the version the local copy is based on. */
  remoteModified: number;
  uploading: boolean;
  pending: boolean;
  timer?: ReturnType<typeof setTimeout>;
  listener: (current: Stats, previous: Stats) => void;
}

/** Server files opened in local editors: each lives in its own temporary folder and is uploaded on save. */
export class RemoteEdits {
  private edits = new Map<string, Edit>();
  constructor(private readonly fs: RemoteFileSystem, private readonly dependencies: EditDependencies) {}

  list(): EditedFile[] { return [...this.edits.values()].map(edit => ({ ...edit.info })); }

  async open(remotePath: string, editor: EditorChoice = 'default'): Promise<{ editId: string }> {
    const existing = [...this.edits.values()].find(edit => edit.info.remotePath === remotePath);
    if (existing) {
      existing.editor = editor;
      await this.dependencies.openFile(existing.localPath, editor);
      return { editId: existing.info.id };
    }
    const entry = await this.fs.stat(remotePath);
    if (!entry) throw new FileError('files.fileNotFound');
    if (entry.type === 'directory') throw new FileError('files.directoryNotEditable');
    if (entry.size > MAX_EDIT_SIZE) throw new FileError('files.tooLargeToEdit');
    const name = posix.basename(remotePath);
    if (unsafeLocalName(name)) throw new FileError('files.unsafeName', { name });
    const dir = await mkdtemp(join(tmpdir(), 'shellherd-edit-'));
    const localPath = join(dir, name);
    try {
      await pipeline(this.fs.read(remotePath), createWriteStream(localPath));
    } catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
    const edit: Edit = { info: { id: randomUUID(), name, remotePath, state: 'open' }, dir, localPath, editor, remoteModified: entry.modified,
      uploading: false, pending: false, listener: (current, previous) => {
        // A missing file (mid-save rename) reports time 0; the next change uploads.
        if (current.mtimeMs === 0 || (current.mtimeMs === previous.mtimeMs && current.size === previous.size)) return;
        clearTimeout(edit.timer);
        edit.timer = setTimeout(() => void this.upload(edit.info.id, false), SETTLE_DELAY);
      } };
    this.edits.set(edit.info.id, edit);
    watchFile(localPath, { interval: this.dependencies.pollInterval ?? 1000, persistent: false }, edit.listener);
    this.emit(edit);
    await this.dependencies.openFile(localPath, editor);
    return { editId: edit.info.id };
  }

  async reopen(id: string): Promise<void> { const edit = this.get(id); await this.dependencies.openFile(edit.localPath, edit.editor); }

  /** Uploads the local copy; without `force` a newer server version stops the upload. */
  async upload(id: string, force: boolean): Promise<void> {
    const edit = this.edits.get(id);
    if (!edit) return;
    if (edit.uploading) { edit.pending = true; return; }
    edit.uploading = true;
    this.update(edit, { state: 'uploading', error: undefined });
    try {
      const remote = await this.fs.stat(edit.info.remotePath);
      if (!force && remote && Math.abs(remote.modified - edit.remoteModified) > 1000) {
        this.update(edit, { state: 'conflict', error: { code: 'files.changedOnServer' } });
        return;
      }
      await pipeline(createReadStream(edit.localPath), this.fs.write(edit.info.remotePath, remote?.mode));
      edit.remoteModified = (await this.fs.stat(edit.info.remotePath))?.modified ?? Date.now();
      this.update(edit, { state: 'saved', savedAt: Date.now() });
    } catch (error) {
      this.update(edit, { state: 'error', error: fileError(error) });
    } finally {
      edit.uploading = false;
      if (edit.pending && this.edits.has(id)) { edit.pending = false; void this.upload(id, false); }
    }
  }

  async close(id: string): Promise<void> {
    const edit = this.edits.get(id);
    if (!edit) return;
    this.edits.delete(id);
    clearTimeout(edit.timer);
    unwatchFile(edit.localPath, edit.listener);
    this.dependencies.emit({ ...edit.info }, true);
    await rm(edit.dir, { recursive: true, force: true }).catch(() => {});
  }

  closeAll(): void { for (const id of [...this.edits.keys()]) void this.close(id); }

  private get(id: string): Edit {
    const edit = this.edits.get(id);
    if (!edit) throw new FileError('files.editNotOpen');
    return edit;
  }
  private update(edit: Edit, change: Partial<EditedFile>): void {
    edit.info = { ...edit.info, ...change };
    this.emit(edit);
  }
  private emit(edit: Edit): void { if (this.edits.has(edit.info.id)) this.dependencies.emit({ ...edit.info }); }
}
