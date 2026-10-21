import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AdoptedSession, TerminalConnection } from '../terminal-tabs';
import type { SshStatus } from '../../../shared/ssh';
import { decodeError, truncateDetail } from '../../../shared/errors';
import type { CodedError } from '../../../shared/errors';
import type { ConnectionErrorCode } from '../../../shared/connection-errors';
import { LOCAL_CONTAINER_HOST } from '../../../shared/containers';
import type { AutoUploadStatus, ConflictChoice, EditedFile, FileEntry, SftpStatus, TransferConflict, TransferJob, TransferState } from '../../../shared/sftp';
import type { FileSide } from '../file-browser';
import { errorText, IPC_PREFIX } from '../error-text';
import { formatDate, formatSize, isFinished, jobPercent, joinPath } from '../file-browser';
import { formatDateTime } from '../../../shared/format';
import type { AutoUploadBinding } from '../../../shared/vault/types';
import { bindingName, newAutoUpload, syncTouchesFolder } from '../auto-upload-form';
import { notify } from '../notice-store';
import { useT } from '../i18n';
import { liveSessions } from '../session-registry';
import { useNativeSurfaceBlock } from '../native-surface';
import { statusWord } from '../status-words';
import { ConnectionErrorCard } from './ConnectionErrorCard';
import { DisconnectedBar } from './DisconnectedBar';
import { ConfirmDialog } from './ConfirmDialog';
import { PermissionsDialog } from './PermissionsDialog';
import { AutoUploadDialog } from './AutoUploadDialog';
import { AutoUploadList } from './AutoUploadList';
import { FilePane } from './FilePane';
import type { FileListing } from './FilePane';
import '../files-ui.css';

interface FilesPanelProps {
  connection: TerminalConnection;
  tabId: string;
  visible: boolean;
  focused?: boolean;
  style?: CSSProperties;
  onFocus?: () => void;
  onStatusChange: (id: string, status: SshStatus) => void;
  /** Session moved here from another window; no new connection is opened. */
  adopt?: AdoptedSession;
  initialStatus?: SshStatus;
  /** Auto-upload bindings of this connection (from the vault). */
  bindings?: AutoUploadBinding[];
  /** Persists the list; omitted in secondary windows. Resolves false when the vault was not saved. */
  onSaveAutoUpload?: (bindings: AutoUploadBinding[]) => Promise<boolean>;
}
const NO_BINDINGS: AutoUploadBinding[] = [];

/** Folders of both sides; travels with the tab to another window. */
interface FilesSnapshot { local?: string; remote?: string }

const emptyListing: FileListing = { path: null, entries: [], loading: false, error: null };
const QUEUE_STATE_KEYS = {
  queued: 'files:queue.state.queued', running: 'files:queue.state.running', done: 'files:queue.state.done',
  error: 'files:queue.state.error', canceled: 'files:queue.state.canceled',
} as const satisfies Record<TransferState, string>;
const EDIT_STATE_KEYS = {
  open: 'files:edit.state.open', uploading: 'files:edit.state.uploading', saved: 'files:edit.state.saved',
  conflict: 'files:edit.state.conflict', error: 'files:edit.state.error',
} as const satisfies Record<EditedFile['state'], string>;

const SYNC_REFRESH_MS = 1000;

/** A rejected open as coded error; foreign text stays raw detail for the card. */
function codedFailure(error: Error): CodedError {
  return decodeError(error.message) ?? { code: 'core.unknown', detail: truncateDetail(error.message.replace(IPC_PREFIX, '')) };
}

function readSnapshot(adopt?: AdoptedSession): FilesSnapshot {
  try { return adopt?.snapshot ? JSON.parse(adopt.snapshot) as FilesSnapshot : {}; } catch { return {}; }
}

/** WinSCP-style commander: this computer on the left, the server on the right, transfers below. */
export function FilesPanel({ connection, tabId, visible, focused = true, style, onFocus, onStatusChange, adopt, initialStatus, bindings = NO_BINDINGS, onSaveAutoUpload }: FilesPanelProps) {
  const { t } = useT();
  // load() must keep a stable identity or the connection effect would reconnect on a language change.
  const tRef = useRef(t);
  tRef.current = t;
  const fail = (error: unknown) => errorText(error, tRef.current('files:actionFailed'));
  const [status, setStatus] = useState<SftpStatus>(initialStatus ?? 'connecting');
  const [failure, setFailure] = useState<{ code?: ConnectionErrorCode; error?: CodedError }>({});
  const [endedAt, setEndedAt] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [listings, setListings] = useState<Record<FileSide, FileListing>>({ local: emptyListing, remote: emptyListing });
  const [homes, setHomes] = useState<Record<FileSide, string | null>>({ local: null, remote: null });
  const [drives, setDrives] = useState<string[]>([]);
  const [activeSide, setActiveSide] = useState<FileSide>('remote');
  const [jobs, setJobs] = useState<TransferJob[]>([]);
  const [edits, setEdits] = useState<EditedFile[]>([]);
  const [syncs, setSyncs] = useState<AutoUploadStatus[]>([]);
  const [syncDialog, setSyncDialog] = useState<{ binding: AutoUploadBinding; isNew: boolean } | null>(null);
  const [savingSync, setSavingSync] = useState(false);
  // Last seen state per binding, for toasts on transitions only (not on adoption).
  const syncSeen = useRef(new Map<string, { error: boolean; skipped: number; synced: number }>());
  const [pendingPermissions, setPendingPermissions] = useState<{ paths: string[]; entries: FileEntry[] } | null>(null);
  const [conflict, setConflict] = useState<TransferConflict | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ side: FileSide; paths: string[]; names: string[] } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const adoptRef = useRef(adopt);
  const paths = useRef<FilesSnapshot>(readSnapshot(adopt));
  const requests = useRef<Record<FileSide, number>>({ local: 0, remote: 0 });
  const sessionRef = useRef<string | null>(null);

  const load = useCallback(async (side: FileSide, path: string): Promise<void> => {
    const id = sessionRef.current;
    if (side === 'remote' && !id) return;
    const request = ++requests.current[side];
    setListings(current => ({ ...current, [side]: { ...current[side], loading: true } }));
    try {
      const listing = side === 'local' ? await window.desktopApi.localList({ path }) : await window.desktopApi.sftpList({ sessionId: id!, path });
      if (request !== requests.current[side]) return;
      paths.current[side] = listing.path;
      setListings(current => ({ ...current, [side]: { path: listing.path, entries: listing.entries, loading: false, error: null } }));
    } catch (error) {
      if (request !== requests.current[side]) return;
      // The previous folder stays visible; only the message is new.
      setListings(current => ({ ...current, [side]: { ...current[side], loading: false, error: errorText(error, tRef.current('files:panel.openFolderFailed')) } }));
    }
  }, []);
  const refresh = useCallback((side: FileSide): void => { const path = paths.current[side]; if (path) void load(side, path); }, [load]);

  // This computer: home folder and drives, independent of the server connection.
  useEffect(() => {
    let disposed = false;
    void window.desktopApi.localPlaces().then(places => {
      if (disposed) return;
      setDrives(places.drives);
      setHomes(current => ({ ...current, local: places.home }));
      void load('local', paths.current.local ?? places.home);
    }).catch(error => setListings(current => ({ ...current, local: { ...current.local, error: fail(error) } })));
    return () => { disposed = true; };
  }, [load]);

  useEffect(() => {
    let disposed = false;
    let id: string | null = null;
    let syncRefresh: ReturnType<typeof setTimeout> | undefined;
    const report = (next: SftpStatus, error?: CodedError, code?: ConnectionErrorCode): void => {
      if (disposed) return;
      if (next === 'closed' || next === 'error') setEndedAt(Date.now());
      setStatus(next); setFailure({ code, error }); onStatusChange(tabId, next);
    };
    const connected = (): void => {
      report('connected');
      void window.desktopApi.sftpHome({ sessionId: id! }).then(home => {
        if (disposed) return;
        setHomes(current => ({ ...current, remote: home }));
        void load('remote', paths.current.remote ?? home);
      }).catch(error => { if (!disposed) setListings(current => ({ ...current, remote: { ...current.remote, error: fail(error) } })); });
    };
    const unsubscribe = window.desktopApi.onSftpEvent(event => {
      if (event.sessionId !== id || disposed) return;
      if (event.type === 'status') { if (event.status === 'connected') connected(); else report(event.status, event.error, event.code); }
      else if (event.type === 'conflict') setConflict(event.conflict);
      else if (event.type === 'edit') {
        const { edit, closed } = event;
        setEdits(current => closed ? current.filter(item => item.id !== edit.id)
          : current.some(item => item.id === edit.id) ? current.map(item => item.id === edit.id ? edit : item) : [...current, edit]);
        if (edit.state === 'saved') refresh('remote');
      }
      else if (event.type === 'sync') {
        const { sync, closed } = event;
        const seen = syncSeen.current.get(sync.bindingId);
        if (closed) syncSeen.current.delete(sync.bindingId);
        else {
          syncSeen.current.set(sync.bindingId, { error: sync.state === 'error', skipped: sync.skipped.length, synced: sync.synced });
          // Throttled: one listing per second at most, after the uploads it covers.
          if (!syncRefresh && syncTouchesFolder(paths.current.remote, sync, seen?.synced))
            syncRefresh = setTimeout(() => { syncRefresh = undefined; refresh('remote'); }, SYNC_REFRESH_MS);
          if (sync.state === 'error' && !seen?.error)
            notify.error(tRef.current('files:sync.failedTitle', { name: bindingName(sync) }), { body: sync.error ? errorText(sync.error) : undefined });
          if (sync.skipped.length > 0 && !seen?.skipped)
            notify.info(tRef.current('files:sync.skippedTitle', { count: sync.skipped.length + sync.skippedMore }), {
              body: tRef.current('files:sync.skippedBody', { names: sync.skipped.slice(0, 5).join(', ') }),
              action: { label: tRef.current('files:sync.force'), run: () => void window.desktopApi.sftpSyncForce({ sessionId: id!, bindingId: sync.bindingId }).catch(error => setActionError(errorText(error, tRef.current('files:actionFailed')))) },
            });
        }
        setSyncs(current => closed ? current.filter(item => item.bindingId !== sync.bindingId)
          : current.some(item => item.bindingId === sync.bindingId) ? current.map(item => item.bindingId === sync.bindingId ? sync : item) : [...current, sync]);
      }
      else if (event.type === 'transfer') {
        setJobs(current => current.some(job => job.id === event.job.id)
          ? current.map(job => job.id === event.job.id ? event.job : job) : [...current, event.job]);
        if (isFinished(event.job)) {
          setConflict(current => current?.jobId === event.job.id ? null : current);
          refresh('local'); refresh('remote');
        }
      }
    });
    const attach = (sessionId: string): void => {
      id = sessionId;
      sessionRef.current = id;
      setSessionId(id);
      liveSessions.set(tabId, { kind: 'sftp', sessionId: id, snapshot: () => JSON.stringify(paths.current) });
    };
    // StrictMode mounts twice in development; only the surviving mount opens or adopts a session.
    const timer = setTimeout(() => {
      const adopted = adoptRef.current;
      adoptRef.current = undefined;
      if (adopted?.session) {
        const { sessionId: adoptedId } = adopted.session;
        attach(adoptedId);
        void window.desktopApi.sftpState({ sessionId: adoptedId }).then(state => {
          if (disposed) return;
          setJobs(state.jobs);
          setEdits(state.edits);
          const adoptedSyncs = state.syncs ?? [];
          syncSeen.current = new Map(adoptedSyncs.map(sync => [sync.bindingId, { error: sync.state === 'error', skipped: sync.skipped.length, synced: sync.synced }]));
          setSyncs(adoptedSyncs);
          setConflict(state.conflict ?? null);
          if (state.status === 'connected') connected(); else report(state.status);
        }).catch((error: Error) => report('error', codedFailure(error)));
        return;
      }
      // A closed tab moved from another window stays closed until "Neu verbinden".
      if (adopted) return;
      report('connecting');
      window.desktopApi.sftpOpen({ connectionId: connection.id }).then(result => {
        if (disposed) { void window.desktopApi.sftpClose(result).catch(() => {}); return; }
        attach(result.sessionId);
      }).catch((error: Error) => report('error', codedFailure(error)));
    }, 0);
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearTimeout(syncRefresh);
      unsubscribe();
      sessionRef.current = null;
      liveSessions.delete(tabId);
      if (id && !liveSessions.takeTransferred(id)) void window.desktopApi.sftpClose({ sessionId: id }).catch(() => {});
    };
  }, [connection.id, tabId, onStatusChange, load, refresh, attempt]);

  const run = async (action: () => Promise<unknown>, side?: FileSide): Promise<boolean> => {
    setBusy(true); setActionError(null);
    try { await action(); return true; }
    catch (error) { setActionError(fail(error)); return false; }
    finally { setBusy(false); if (side) refresh(side); }
  };
  const transfer = (from: FileSide, sources: string[], move: boolean, targetDir?: string): void => {
    const target = targetDir ?? paths.current[from === 'local' ? 'remote' : 'local'];
    if (!sessionId || !target || !sources.length) return;
    void run(() => window.desktopApi.sftpTransfer({ sessionId, direction: from === 'local' ? 'upload' : 'download', sources, targetDir: target, move }));
  };
  const answer = (choice: ConflictChoice, applyToAll: boolean): void => {
    if (!conflict || !sessionId) return;
    setConflict(null);
    void window.desktopApi.sftpResolve({ sessionId, conflictId: conflict.conflictId, choice, applyToAll }).catch(error => setActionError(fail(error)));
  };
  const remoteReady = status === 'connected' && !!sessionId;
  const remoteNotice = status === 'connected' ? undefined
    : { text: statusWord(status, 'long', { name: connection.name }) };
  const reconnect = (): void => { setJobs([]); setSyncs([]); syncSeen.current.clear(); setConflict(null); adoptRef.current = undefined; setAttempt(value => value + 1); };
  // Vault first, then the session; the dialog stays open when the vault was not saved.
  const saveSync = async (next: AutoUploadBinding[], apply: () => Promise<unknown>): Promise<boolean> => {
    if (!onSaveAutoUpload) return false;
    setSavingSync(true); setActionError(null);
    try {
      if (!await onSaveAutoUpload(next)) return false;
      if (remoteReady) await apply();
      return true;
    } catch (error) { setActionError(fail(error)); return true; }
    finally { setSavingSync(false); }
  };
  const syncRequest = (binding: AutoUploadBinding) => ({ sessionId: sessionId!, bindingId: binding.id });
  const saveBinding = (binding: AutoUploadBinding, isNew: boolean): void => {
    void saveSync(isNew ? [...bindings, binding] : bindings.map(item => item.id === binding.id ? binding : item), async () => {
      if (!isNew) await window.desktopApi.sftpSyncStop(syncRequest(binding));
      if (isNew || binding.enabled) await window.desktopApi.sftpSyncStart(syncRequest(binding));
    }).then(saved => { if (saved) setSyncDialog(null); });
  };
  const toggleBinding = (binding: AutoUploadBinding): void => {
    const next = { ...binding, enabled: !binding.enabled };
    void saveSync(bindings.map(item => item.id === binding.id ? next : item),
      () => next.enabled ? window.desktopApi.sftpSyncStart(syncRequest(next)) : window.desktopApi.sftpSyncStop(syncRequest(next)));
  };
  const removeBinding = (binding: AutoUploadBinding): void => {
    void saveSync(bindings.filter(item => item.id !== binding.id), () => window.desktopApi.sftpSyncStop(syncRequest(binding)));
  };
  const cardActive = focused && visible;
  const remote = connection.id !== LOCAL_CONTAINER_HOST;
  const active = jobs.filter(job => !isFinished(job));

  const pane = (side: FileSide) => <FilePane tabId={tabId} side={side} title={side === 'local' ? t('common:thisComputer') : `${connection.name} (${connection.address})`}
    listing={listings[side]} active={activeSide === side} disabled={busy || (side === 'remote' && !remoteReady)}
    notice={side === 'remote' ? remoteNotice : undefined} home={homes[side]} drives={side === 'local' ? drives : undefined}
    onActivate={() => setActiveSide(side)} onNavigate={path => void load(side, path)} onRefresh={() => refresh(side)}
    onMkdir={path => run(() => side === 'local' ? window.desktopApi.localMkdir({ path }) : window.desktopApi.sftpMkdir({ sessionId: sessionId!, path }), side)}
    onRename={(from, to) => run(() => side === 'local' ? window.desktopApi.localRename({ from, to }) : window.desktopApi.sftpRename({ sessionId: sessionId!, from, to }), side)}
    onDelete={(paths, names) => setPendingDelete({ side, paths, names })}
    onEdit={(path, editor) => void run(() => side === 'local' ? window.desktopApi.localOpen({ path, editor })
      : window.desktopApi.sftpEdit({ sessionId: sessionId!, path, editor }))}
    onCreateFile={path => run(async () => {
      if (side === 'local') { await window.desktopApi.localCreateFile({ path }); await window.desktopApi.localOpen({ path, editor: 'default' }); return; }
      await window.desktopApi.sftpCreateFile({ sessionId: sessionId!, path });
      await window.desktopApi.sftpEdit({ sessionId: sessionId!, path, editor: 'default' });
    }, side)}
    onPermissions={side === 'remote' ? (paths, entries) => setPendingPermissions({ paths, entries }) : undefined}
    onAutoUpload={side === 'local' && remote ? localDir => setSyncDialog({ binding: newAutoUpload(localDir, paths.current.remote ?? ''), isNew: true }) : undefined}
    autoUploadHint={!onSaveAutoUpload ? t('files:sync.mainWindowOnly') : !remoteReady ? t('files:sync.notConnected') : undefined}
    onCopy={(sources, move) => { if (remoteReady) transfer(side, sources, move); }}
    onDrop={(drag, targetDir, move) => {
      if (!remoteReady) return;
      if ('external' in drag) transfer('local', drag.external, false, targetDir);
      else transfer(drag.side, drag.names.map(name => joinPath(drag.side, drag.dir, name)), move, targetDir);
    }} />;

  return (
    <section className={`terminal-panel files-panel${focused ? ' focused-pane' : ''}`} style={style} onPointerDown={onFocus}
      id={`terminal-${tabId}`} role="tabpanel" aria-labelledby={`tab-${tabId}`} hidden={!visible}>
      <span className="terminal-live-status" role="status">{statusWord(status, 'long', { protocol: 'SFTP' })}</span>
      {actionError && <p className="file-error file-action-error" role="alert">{actionError}<button type="button" aria-label={t('files:panel.dismiss')} onClick={() => setActionError(null)}>×</button></p>}
      <div className="files-commander">{pane('local')}{pane('remote')}
      {status === 'error' && (
        <ConnectionErrorCard connectionId={connection.id} code={failure.code ?? 'unknown'} name={connection.name} address={connection.address}
          remote={remote} error={failure.error} active={cardActive} onRetry={reconnect} />
      )}
      </div>
      {status === 'closed' && (
        <DisconnectedBar reason={failure.code === 'closed-by-server' ? 'server' : failure.code === 'idle' ? 'idle' : 'session'} endedAt={endedAt} active={cardActive} ticking={visible} onReconnect={reconnect} />
      )}
      {edits.length > 0 && sessionId && <EditList edits={edits}
        onOpen={editId => void window.desktopApi.sftpEditOpen({ sessionId, editId }).catch(error => setActionError(fail(error)))}
        onUpload={editId => void window.desktopApi.sftpEditUpload({ sessionId, editId }).catch(error => setActionError(fail(error)))}
        onClose={editId => void window.desktopApi.sftpEditClose({ sessionId, editId }).catch(error => setActionError(fail(error)))} />}
      <AutoUploadList bindings={bindings} syncs={syncs} status={status} canEdit={!!onSaveAutoUpload}
        onEdit={binding => setSyncDialog({ binding, isNew: false })} onToggle={toggleBinding} onRemove={removeBinding}
        onForce={bindingId => sessionId && void window.desktopApi.sftpSyncForce({ sessionId, bindingId }).catch(error => setActionError(fail(error)))} />
      {syncDialog && visible && <AutoUploadDialog binding={syncDialog.binding} others={bindings.filter(item => item.id !== syncDialog.binding.id)}
        isNew={syncDialog.isNew} busy={savingSync} onCancel={() => setSyncDialog(null)} onSave={binding => saveBinding(binding, syncDialog.isNew)} />}
      {pendingPermissions && <PermissionsDialog entries={pendingPermissions.entries} busy={busy} onCancel={() => setPendingPermissions(null)}
        onApply={(mode, recursive) => void run(() => window.desktopApi.sftpChmod({ sessionId: sessionId!, paths: pendingPermissions.paths, mode, recursive }), 'remote')
          .then(done => { if (done) setPendingPermissions(null); })} />}
      {jobs.length > 0 && <TransferQueue jobs={jobs} activeCount={active.length}
        onCancel={jobId => sessionId && void window.desktopApi.sftpCancel({ sessionId, jobId }).catch(() => {})}
        onClear={() => { setJobs(current => current.filter(job => !isFinished(job))); if (sessionId) void window.desktopApi.sftpClearFinished({ sessionId }).catch(() => {}); }} />}
      {conflict && visible && <ConflictDialog conflict={conflict} onAnswer={answer} />}
      {pendingDelete && <ConfirmDialog busy={busy} instant
        title={pendingDelete.names.length === 1 ? t('files:panel.deleteOne', { name: pendingDelete.names[0] }) : t('files:panel.deleteMany', { count: pendingDelete.names.length })}
        description={pendingDelete.side === 'local' ? t('files:panel.deleteLocal') : t('files:panel.deleteRemote')}
        confirmLabel={pendingDelete.side === 'local' ? t('files:panel.toTrash') : t('files:panel.deleteForever')}
        onCancel={() => setPendingDelete(null)} onConfirm={() => {
          const { side, paths: targets } = pendingDelete;
          void run(() => side === 'local' ? window.desktopApi.localDelete({ paths: targets }) : window.desktopApi.sftpDelete({ sessionId: sessionId!, paths: targets }), side)
            .then(() => setPendingDelete(null));
        }} />}
    </section>
  );
}

function TransferQueue({ jobs, activeCount, onCancel, onClear }: { jobs: TransferJob[]; activeCount: number; onCancel: (jobId: string) => void; onClear: () => void }) {
  const { t } = useT();
  const jobLabel = (job: TransferJob): string => job.entryCount > 1 ? t('files:transfer.entries', { count: job.entryCount }) : job.label;
  return (
    <section className="transfer-queue" aria-label={t('files:queue.title')}>
      <header><strong>{t('files:queue.title')}</strong><span>{activeCount ? t('files:queue.active', { count: activeCount }) : t('files:queue.allDone')}</span>
        <button type="button" className="secondary-button" disabled={activeCount === jobs.length} onClick={onClear}>{t('files:queue.clear')}</button></header>
      <ul>
        {[...jobs].reverse().map(job => <li key={job.id} className={`transfer-job is-${job.state}`}>
          <span className="transfer-direction" title={job.direction === 'upload' ? t('files:pane.upload') : t('files:pane.download')}>{job.direction === 'upload' ? '↑' : '↓'}</span>
          <div className="transfer-main">
            <div className="transfer-title"><strong>{jobLabel(job)}</strong>{job.move && <small>{t('files:queue.move')}</small>}<span className="transfer-target" title={job.targetDir}>→ {job.targetDir}</span></div>
            <progress max={100} value={jobPercent(job)} aria-label={t('files:queue.progress', { label: jobLabel(job) })} />
            <small>{t(QUEUE_STATE_KEYS[job.state])}
              {job.totalFiles > 0 && ` · ${t('files:queue.files', { done: job.doneFiles, count: job.totalFiles })}`}
              {job.totalBytes > 0 && ` · ${t('files:queue.bytes', { done: formatSize(job.doneBytes), total: formatSize(job.totalBytes) })}`}
              {job.skippedFiles > 0 && ` · ${t('files:queue.skipped', { count: job.skippedFiles })}`}
              {job.current && ` · ${job.current}`}
              {job.error && ` · ${errorText(job.error)}`}</small>
          </div>
          {!isFinished(job) && <button type="button" className="secondary-button" onClick={() => onCancel(job.id)}>{t('common:actions.cancel')}</button>}
        </li>)}
      </ul>
    </section>
  );
}

function EditList({ edits, onOpen, onUpload, onClose }: { edits: EditedFile[]; onOpen: (id: string) => void; onUpload: (id: string) => void; onClose: (id: string) => void }) {
  const { t } = useT();
  return (
    <section className="transfer-queue edit-list" aria-label={t('files:edit.title')}>
      <header><strong>{t('files:edit.title')}</strong><span>{t('files:edit.hint')}</span></header>
      <ul>
        {edits.map(edit => <li key={edit.id} className={`transfer-job is-edit-${edit.state}`}>
          <span className="transfer-direction" aria-hidden="true">✎</span>
          <div className="transfer-main">
            <div className="transfer-title"><strong>{edit.name}</strong><span className="transfer-target" title={edit.remotePath}>{edit.remotePath}</span></div>
            <small role="status">{t(EDIT_STATE_KEYS[edit.state])}{edit.state === 'saved' && edit.savedAt ? ` ${t('files:edit.savedAt', { time: formatDateTime(edit.savedAt, 'time') })}` : ''}
              {edit.error && ` · ${errorText(edit.error)}`}</small>
          </div>
          {edit.state === 'conflict' && <button type="button" className="secondary-button" title={t('files:edit.forceTitle')} onClick={() => onUpload(edit.id)}>{t('files:edit.force')}</button>}
          {edit.state === 'error' && <button type="button" className="secondary-button" onClick={() => onUpload(edit.id)}>{t('files:edit.retry')}</button>}
          <button type="button" className="secondary-button" onClick={() => onOpen(edit.id)}>{t('files:edit.openEditor')}</button>
          <button type="button" className="secondary-button" title={t('files:edit.closeTitle')} onClick={() => onClose(edit.id)}>{t('common:actions.close')}</button>
        </li>)}
      </ul>
    </section>
  );
}

function ConflictDialog({ conflict, onAnswer }: { conflict: TransferConflict; onAnswer: (choice: ConflictChoice, applyToAll: boolean) => void }) {
  const { t } = useT();
  const id = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [applyToAll, setApplyToAll] = useState(false);
  useNativeSurfaceBlock(true);
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  const newer = conflict.source.modified > conflict.target.modified + 1000;
  return (
    <dialog ref={dialogRef} className="confirm-dialog conflict-dialog" aria-labelledby={`${id}-title`}
      onCancel={event => { event.preventDefault(); onAnswer('cancel', false); }}>
      <h2 id={`${id}-title`}>{t('files:conflict.title', { name: conflict.name })}</h2>
      <dl>
        <dt>{t('files:conflict.newFile')}</dt><dd>{formatSize(conflict.source.size)} · {formatDate(conflict.source.modified)}{newer && <strong> {t('files:conflict.newer')}</strong>}</dd>
        <dt>{t('files:conflict.existing')}</dt><dd>{formatSize(conflict.target.size)} · {formatDate(conflict.target.modified)}{!newer && <strong> {t('files:conflict.sameOrNewer')}</strong>}</dd>
      </dl>
      <label className="editor-checkbox"><input type="checkbox" checked={applyToAll} onChange={event => setApplyToAll(event.target.checked)} />{t('files:conflict.applyAll')}</label>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={() => onAnswer('cancel', false)}>{t('files:conflict.cancel')}</button>
        <button type="button" className="secondary-button" onClick={() => onAnswer('skip', applyToAll)}>{t('files:conflict.skip')}</button>
        <button type="button" className="secondary-button" onClick={() => onAnswer('newer', applyToAll)}>{t('files:conflict.onlyNewer')}</button>
        <button type="button" className="primary-button" autoFocus onClick={() => onAnswer('overwrite', applyToAll)}>{t('files:conflict.overwrite')}</button>
      </div>
    </dialog>
  );
}
